import { eq, and, notInArray, lt, sql } from "drizzle-orm";
import type { Lead } from "@/domain/entities/lead";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import { db } from "@/infrastructure/db/client";
import {
  agentRecommendations,
  appointments,
  followUps,
  humanReviewRequests,
  leads,
  conversations,
  messages,
  slotReservations,
} from "@/infrastructure/db/schema";

export class DrizzleLeadRepository implements LeadRepository {
  async findById(id: string): Promise<Lead | null> {
    const row = await db.query.leads.findFirst({ where: eq(leads.id, id) });
    return row ? mapRow(row) : null;
  }

  async findByPhone(clinicId: string, phone: string): Promise<Lead | null> {
    const row = await db.query.leads.findFirst({
      where: and(eq(leads.clinicId, clinicId), eq(leads.phone, phone)),
    });
    return row ? mapRow(row) : null;
  }

  async findByWhatsAppLid(clinicId: string, whatsappLid: string): Promise<Lead | null> {
    const row = await db.query.leads.findFirst({
      where: and(eq(leads.clinicId, clinicId), eq(leads.whatsappLid, whatsappLid)),
    });
    return row ? mapRow(row) : null;
  }

  async findInactiveLeads(params: {
    clinicId: string;
    lastActivityBefore: Date;
  }): Promise<Lead[]> {
    const rows = await db
      .select({ lead: leads })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(
        and(
          eq(leads.clinicId, params.clinicId),
          eq(conversations.category, "sales"),
          notInArray(leads.status, ["lost", "won", "appointment_scheduled"]),
          lt(
            sql`COALESCE(${conversations.lastMessageAt}, ${conversations.updatedAt})`,
            params.lastActivityBefore,
          ),
        ),
      );
    return rows.map((r) => mapRow(r.lead));
  }

  async save(lead: Lead): Promise<void> {
    const values = {
      id: lead.id,
      clinicId: lead.clinicId,
      name: lead.name,
      phone: lead.phone,
      whatsappLid: lead.whatsappLid,
      email: lead.email,
      channel: lead.channel,
      campaignId: lead.campaignId,
      treatmentInterest: lead.treatmentInterest,
      profilePicUrl: lead.profilePicUrl,
      status: lead.status,
      temperature: lead.temperature,
      assignedToUserId: lead.assignedToUserId,
      nextActionAt: lead.nextActionAt,
      lostReason: lead.lostReason,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
    const set = {
      name: lead.name,
      phone: lead.phone,
      whatsappLid: lead.whatsappLid,
      email: lead.email,
      status: lead.status,
      temperature: lead.temperature,
      treatmentInterest: lead.treatmentInterest,
      profilePicUrl: lead.profilePicUrl,
      assignedToUserId: lead.assignedToUserId,
      nextActionAt: lead.nextActionAt,
      lostReason: lead.lostReason,
      updatedAt: lead.updatedAt,
    };

    // A tabela tem DOIS índices únicos — (clinicId, phone) e (clinicId,
    // whatsappLid). Um único ON CONFLICT só cobre um deles, então quando um lead
    // já existe por uma identidade e a mensagem seguinte traz a outra, o insert
    // colide no índice NÃO nomeado (ou no próprio id) e o job morre — mensagem do
    // lead engolida em silêncio (caso Paciente Exemplo, Horizonte 22/07: pergunta quente sem
    // resposta). A correção: resolver o lead existente por QUALQUER identidade e
    // atualizar por id, que é a chave que nunca colide. Só inserir quando é novo.
    const byPhone = lead.phone ? await this.findByPhone(lead.clinicId, lead.phone) : null;
    const byLid = lead.whatsappLid ? await this.findByWhatsAppLid(lead.clinicId, lead.whatsappLid) : null;

    // Telefone e @lid apontando para leads distintos: funde antes (telefone é o
    // canônico) para não deixar dois cadastros do mesmo paciente.
    if (byPhone && byLid && byPhone.id !== byLid.id) {
      await this.mergeDuplicateLeads({
        canonicalLeadId: byPhone.id,
        duplicateLeadId: byLid.id,
      });
    }

    const existingId = byPhone?.id ?? byLid?.id ?? null;
    if (existingId) {
      // Enriquece o lead existente (ex.: preenche o phone que faltava, ou
      // acrescenta o @lid) sem arriscar colisão — update por id.
      await db.update(leads).set(set).where(eq(leads.id, existingId));
      return;
    }

    // Lead novo. ON CONFLICT no id torna o retry idempotente; uma corrida (outra
    // requisição inseriu o mesmo phone/lid entre o find e o insert) é recuperada
    // no catch, relendo a identidade e atualizando.
    try {
      await db.insert(leads).values(values).onConflictDoUpdate({
        target: leads.id,
        set,
      });
    } catch (error) {
      const raced =
        (lead.phone ? await this.findByPhone(lead.clinicId, lead.phone) : null) ??
        (lead.whatsappLid ? await this.findByWhatsAppLid(lead.clinicId, lead.whatsappLid) : null);
      if (!raced) throw error;
      await db.update(leads).set(set).where(eq(leads.id, raced.id));
    }
  }

  async mergeDuplicateLeads(params: {
    canonicalLeadId: string;
    duplicateLeadId: string;
  }): Promise<Lead> {
    const canonical = await this.findById(params.canonicalLeadId);
    const duplicate = await this.findById(params.duplicateLeadId);

    if (!canonical || !duplicate) {
      throw new Error("mergeDuplicateLeads: lead não encontrado");
    }
    if (canonical.clinicId !== duplicate.clinicId) {
      throw new Error("mergeDuplicateLeads: clínicas diferentes");
    }

    const [canonicalConv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.leadId, params.canonicalLeadId))
      .limit(1);

    const [duplicateConv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.leadId, params.duplicateLeadId))
      .limit(1);

    const now = new Date();

    // neon-http não suporta transações — operações sequenciais na ordem segura.
    if (canonicalConv && duplicateConv) {
      await db
        .update(messages)
        .set({ conversationId: canonicalConv.id })
        .where(eq(messages.conversationId, duplicateConv.id));

      const lastMessageAt =
        [canonicalConv.lastMessageAt, duplicateConv.lastMessageAt]
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? now;

      const takeoverExpiresAt =
        [canonicalConv.takeoverExpiresAt, duplicateConv.takeoverExpiresAt]
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

      await db
        .update(conversations)
        .set({
          category: canonicalConv.category,
          lastMessageAt,
          aiPaused: canonicalConv.aiPaused || duplicateConv.aiPaused,
          takeoverExpiresAt,
          needsAttention: canonicalConv.needsAttention || duplicateConv.needsAttention,
          attentionReason: canonicalConv.attentionReason ?? duplicateConv.attentionReason,
          consecutiveUnclearCount: Math.max(
            canonicalConv.consecutiveUnclearCount,
            duplicateConv.consecutiveUnclearCount,
          ),
          updatedAt: now,
        })
        .where(eq(conversations.id, canonicalConv.id));

      await db.delete(conversations).where(eq(conversations.id, duplicateConv.id));
    } else if (duplicateConv && !canonicalConv) {
      await db
        .update(conversations)
        .set({ leadId: params.canonicalLeadId, updatedAt: now })
        .where(eq(conversations.id, duplicateConv.id));
    }

    await db
      .update(appointments)
      .set({ leadId: params.canonicalLeadId, updatedAt: now })
      .where(eq(appointments.leadId, params.duplicateLeadId));

    await db
      .update(followUps)
      .set({ leadId: params.canonicalLeadId, updatedAt: now })
      .where(eq(followUps.leadId, params.duplicateLeadId));

    await db
      .update(agentRecommendations)
      .set({ leadId: params.canonicalLeadId })
      .where(eq(agentRecommendations.leadId, params.duplicateLeadId));

    await db
      .update(slotReservations)
      .set({ leadId: params.canonicalLeadId })
      .where(eq(slotReservations.leadId, params.duplicateLeadId));

    await db
      .update(humanReviewRequests)
      .set({ leadId: params.canonicalLeadId, updatedAt: now })
      .where(eq(humanReviewRequests.leadId, params.duplicateLeadId));

    await db
      .update(leads)
      .set({
        phone: null,
        whatsappLid: null,
        updatedAt: now,
      })
      .where(eq(leads.id, params.duplicateLeadId));

    await db
      .update(leads)
      .set({
        phone: canonical.phone ?? duplicate.phone,
        whatsappLid: canonical.whatsappLid ?? duplicate.whatsappLid,
        name: canonical.name ?? duplicate.name,
        updatedAt: now,
      })
      .where(eq(leads.id, params.canonicalLeadId));

    await db.delete(leads).where(eq(leads.id, params.duplicateLeadId));

    const merged = await this.findById(params.canonicalLeadId);
    if (!merged) {
      throw new Error("mergeDuplicateLeads: lead canônico sumiu após merge");
    }
    return merged;
  }
}

function mapRow(row: typeof leads.$inferSelect): Lead {
  return {
    id: row.id,
    clinicId: row.clinicId,
    name: row.name,
    phone: row.phone,
    whatsappLid: row.whatsappLid,
    email: row.email,
    channel: row.channel,
    campaignId: row.campaignId,
    treatmentInterest: row.treatmentInterest,
    profilePicUrl: row.profilePicUrl,
    status: row.status,
    temperature: row.temperature,
    assignedToUserId: row.assignedToUserId,
    nextActionAt: row.nextActionAt,
    lostReason: row.lostReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
