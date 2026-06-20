import { eq, and, notInArray, lt, sql } from "drizzle-orm";
import type { Lead } from "@/domain/entities/lead";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import { db } from "@/infrastructure/db/client";
import { leads, conversations, messages } from "@/infrastructure/db/schema";

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

    if (lead.phone) {
      await db.insert(leads).values(values).onConflictDoUpdate({
        target: [leads.clinicId, leads.phone],
        set,
      });
      return;
    }

    if (lead.whatsappLid) {
      await db.insert(leads).values(values).onConflictDoUpdate({
        target: [leads.clinicId, leads.whatsappLid],
        set,
      });
      return;
    }

    await db.insert(leads).values(values).onConflictDoUpdate({
      target: leads.id,
      set,
    });
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
