/**
 * Motor de Reativação (ADR-009), Fase 3 — disparo.
 *
 * Enfileira na outbox existente, categoria `campaign`. Nenhum caminho de envio
 * novo: o Safety Gate (opt-out, caps da clínica, quiet hours, warmup, modo
 * cooling/frozen) e a checagem de obsolescência rodam depois, no sender worker.
 *
 * Quatro freios independentes antes de qualquer mensagem sair:
 *  1. Aprovação humana (`approvedAt`) — sem isso não passa daqui.
 *  2. Alvo aprovado individualmente (`status = 'approved'`).
 *  3. Cap diário DA CAMPANHA (ramp próprio, além dos caps da clínica).
 *  4. Pausa de reengajamento / automação da clínica (kill switch já existente).
 *
 * ## Modo ensaio
 *
 * Com `testLeadId`, tudo é entregue na conversa do lead de teste, com cabeçalho
 * identificando o destinatário real. Duas decisões que parecem detalhe e não são:
 *
 *  - **Redireciona `conversationId`, não só o `to`.** O sender valida
 *    `automationDestinationMatchesLead(payload.to, context.lead)` e cancelaria
 *    como `invalid_automation_context` se o destino não batesse com o lead da
 *    conversa.
 *  - **Não marca os alvos como enviados.** Marcar consumiria o cap de vida e
 *    registraria como "contatadas" pessoas que não receberam nada — o ensaio
 *    queimaria a campanha real antes dela existir.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  conversations,
  leads,
  messages,
  organizations,
  reactivationCampaigns,
  reactivationCampaignTargets,
} from "@/infrastructure/db/schema";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";
import { isReengagementPaused } from "@/application/channel-safety/reengagement-policy";
import { randomUUID } from "crypto";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";

/**
 * Teto de mensagens por ensaio. O número de teste receberia a campanha inteira
 * sem isto — e cinco mensagens já bastam para julgar tom e formato.
 */
export const MAX_REHEARSAL_MESSAGES = 5;

export type DispatchResult = {
  campaignId: string;
  queued: number;
  skipped: number;
  failed: number;
  rehearsal: boolean;
  blockedReason?: string;
};

type ApprovedTarget = {
  target_id: string;
  lead_id: string;
  conversation_id: string;
  lead_name: string | null;
  phone: string | null;
  whatsapp_lid: string | null;
  message: string;
};

/** Quantas já saíram hoje nesta campanha — base do ramp. */
async function countSentToday(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(reactivationCampaignTargets)
    .where(
      and(
        eq(reactivationCampaignTargets.campaignId, campaignId),
        sql`${reactivationCampaignTargets.queuedAt} > NOW() - make_interval(hours => 24)`,
      ),
    );
  return Number(row?.count ?? 0);
}

function rehearsalPrefix(leadName: string | null): string {
  return `🧪 ENSAIO — destinatário real: ${leadName ?? "(sem nome)"}\n\n`;
}

export async function dispatchCampaign(input: {
  clinicId: string;
  campaignId: string;
}): Promise<DispatchResult> {
  const base: DispatchResult = {
    campaignId: input.campaignId,
    queued: 0,
    skipped: 0,
    failed: 0,
    rehearsal: false,
  };

  const [campaign] = await db
    .select()
    .from(reactivationCampaigns)
    .where(
      and(
        eq(reactivationCampaigns.id, input.campaignId),
        eq(reactivationCampaigns.clinicId, input.clinicId),
      ),
    )
    .limit(1);
  if (!campaign) return { ...base, blockedReason: "campanha não encontrada" };

  const rehearsal = campaign.testLeadId !== null;

  // Freio 1: aprovação humana. Vale inclusive para o ensaio — ninguém dispara,
  // nem para si mesmo, sem alguém ter olhado.
  if (!campaign.approvedAt) {
    return { ...base, rehearsal, blockedReason: "campanha não aprovada" };
  }
  if (!["approved", "running"].includes(campaign.status)) {
    return { ...base, rehearsal, blockedReason: `status "${campaign.status}" não dispara` };
  }

  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.clinicId),
  });
  if (!clinic) return { ...base, rehearsal, blockedReason: "clínica não encontrada" };

  // Freio 4: kill switches já existentes da clínica.
  if (!shouldSendAutomatedClinicOutbound(clinic)) {
    return { ...base, rehearsal, blockedReason: "automação da clínica pausada" };
  }
  if (isReengagementPaused(clinic)) {
    return { ...base, rehearsal, blockedReason: "reengajamento pausado" };
  }

  // Destino do ensaio: precisa de lead E conversa, porque é a conversa dele que
  // vai receber (ver cabeçalho deste arquivo).
  let rehearsalTarget: { leadId: string; conversationId: string; address: string } | null = null;
  if (rehearsal) {
    const [testLead] = await db
      .select({
        id: leads.id,
        phone: leads.phone,
        whatsappLid: leads.whatsappLid,
        conversationId: conversations.id,
      })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(and(eq(leads.id, campaign.testLeadId!), eq(leads.clinicId, input.clinicId)))
      .limit(1);

    if (!testLead) {
      return {
        ...base,
        rehearsal,
        blockedReason:
          "o contato de teste precisa ter uma conversa nesta clínica — mande uma mensagem para o número antes de ensaiar",
      };
    }

    const address = resolveWhatsAppChannelAddress({
      phone: testLead.phone,
      whatsappLid: testLead.whatsappLid,
    });
    if (!address) {
      return { ...base, rehearsal, blockedReason: "contato de teste sem telefone" };
    }
    rehearsalTarget = {
      leadId: testLead.id,
      conversationId: testLead.conversationId,
      address,
    };
  }

  // Freio 3: ramp da campanha.
  const sentToday = rehearsal ? 0 : await countSentToday(input.campaignId);
  const remaining = rehearsal
    ? MAX_REHEARSAL_MESSAGES
    : Math.max(0, campaign.dailySendCap - sentToday);

  if (remaining === 0) {
    return { ...base, rehearsal, blockedReason: "limite diário da campanha atingido" };
  }

  // Freio 2: só alvos aprovados individualmente.
  const rows = await db.execute(sql`
    SELECT
      t.id            AS target_id,
      t.lead_id,
      t.conversation_id,
      l.name          AS lead_name,
      l.phone,
      l.whatsapp_lid,
      COALESCE(t.edited_message, t.draft_message) AS message
    FROM reactivation_campaign_targets t
    JOIN leads l ON l.id = t.lead_id
    WHERE t.campaign_id = ${input.campaignId}
      AND t.organization_id = ${input.clinicId}
      AND t.status = 'approved'
      AND COALESCE(t.edited_message, t.draft_message) IS NOT NULL
    ORDER BY t.created_at
    LIMIT ${remaining}
  `);

  const targets = rows.rows as ApprovedTarget[];
  const store = new DrizzleOutboundMessageStore();
  const queue = new DrizzleJobQueue();
  const now = new Date();

  let queued = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      const realAddress = resolveWhatsAppChannelAddress({
        phone: target.phone,
        whatsappLid: target.whatsapp_lid,
      });

      // No ensaio o endereço do lead real não importa; na campanha real, sim.
      if (!rehearsal && !realAddress) {
        await db
          .update(reactivationCampaignTargets)
          .set({ status: "skipped", skipReason: "sem telefone", updatedAt: now })
          .where(eq(reactivationCampaignTargets.id, target.target_id));
        skipped++;
        continue;
      }

      const destination = rehearsal
        ? rehearsalTarget!
        : { leadId: target.lead_id, conversationId: target.conversation_id, address: realAddress! };

      const text = rehearsal
        ? `${rehearsalPrefix(target.lead_name)}${target.message}`
        : target.message;

      // dedupeKey do ensaio inclui a hora para permitir repetir o teste depois
      // de ajustar o texto, sem duplicar dentro da mesma execução.
      const dedupeKey = rehearsal
        ? `campaign-rehearsal:${input.campaignId}:${target.target_id}:${now.toISOString().slice(0, 13)}`
        : `campaign:${input.campaignId}:${target.lead_id}`;

      const agentMessageId = randomUUID();

      await db
        .insert(messages)
        .values({
          id: agentMessageId,
          conversationId: destination.conversationId,
          author: "agent",
          body: text,
          sentAt: now,
          externalId: null,
          intent: "reengagement" as const,
          deliveryFormat: null,
        })
        .onConflictDoNothing();
      bumpInboxVersion(input.clinicId);

      const { outboundMessageId } = await enqueueOutboundMessage(
        {
          clinicId: input.clinicId,
          conversationId: destination.conversationId,
          channel: "whatsapp",
          deliveryKind: "text",
          category: "campaign",
          dedupeKey,
          payload: {
            version: 1 as const,
            kind: "automation" as const,
            to: destination.address,
            text,
            leadId: destination.leadId,
            conversationId: destination.conversationId,
            agentMessageId,
          },
        },
        { outboundMessageStore: store, jobQueue: queue },
      );

      // No ensaio o alvo NÃO muda de estado — ver cabeçalho deste arquivo.
      if (!rehearsal) {
        await db
          .update(reactivationCampaignTargets)
          .set({
            status: "queued",
            outboundMessageId,
            queuedAt: now,
            updatedAt: now,
          })
          .where(eq(reactivationCampaignTargets.id, target.target_id));
      }

      queued++;
    } catch (err: unknown) {
      console.error(
        `[Reativacao] falha ao enfileirar target=${target.target_id}:`,
        err instanceof Error ? err.message : String(err),
      );
      failed++;
    }
  }

  if (!rehearsal && queued > 0) {
    await db
      .update(reactivationCampaigns)
      .set({ status: "running", lastDispatchAt: now, updatedAt: now })
      .where(eq(reactivationCampaigns.id, input.campaignId));
  }

  return { campaignId: input.campaignId, queued, skipped, failed, rehearsal };
}
