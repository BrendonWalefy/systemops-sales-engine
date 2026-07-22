/**
 * Motor de Reativação (ADR-009), Fase 2 — revisão dos rascunhos.
 *
 * Aprovar/rejeitar em lote é o que torna a revisão humana viável: ninguém abre
 * 200 mensagens uma a uma, e uma revisão inviável vira carimbo — que é o mesmo
 * que não ter revisão.
 *
 * Toda operação é escopada por clínica **e** por campanha. Um id de alvo vindo
 * do formulário nunca é usado sozinho: o `WHERE` sempre inclui `campaign_id` e
 * `organization_id`, então um id de outro tenant simplesmente não casa nenhuma
 * linha em vez de afetar a campanha de outra clínica.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  reactivationCampaigns,
  reactivationCampaignTargets,
} from "@/infrastructure/db/schema";

export type ReviewResult = { updated: number; error?: string };

/** Estados a partir dos quais uma decisão de revisão ainda faz sentido. */
const REVIEWABLE_STATUSES = ["pending", "approved", "rejected"] as const;

async function assertCampaignIsReviewable(
  clinicId: string,
  campaignId: string,
): Promise<string | null> {
  const [campaign] = await db
    .select({ status: reactivationCampaigns.status })
    .from(reactivationCampaigns)
    .where(
      and(
        eq(reactivationCampaigns.id, campaignId),
        eq(reactivationCampaigns.clinicId, clinicId),
      ),
    )
    .limit(1);

  if (!campaign) return "Campanha não encontrada.";
  // Depois de aprovada e rodando, mexer nos alvos criaria divergência entre o
  // que foi aprovado e o que sai. Pausar primeiro é explícito de propósito.
  if (!["draft", "reviewing", "paused"].includes(campaign.status)) {
    return `A campanha está em "${campaign.status}". Pause antes de editar as mensagens.`;
  }
  return null;
}

export async function approveTargets(input: {
  clinicId: string;
  campaignId: string;
  targetIds: string[];
}): Promise<ReviewResult> {
  if (input.targetIds.length === 0) return { updated: 0 };

  const blocked = await assertCampaignIsReviewable(input.clinicId, input.campaignId);
  if (blocked) return { updated: 0, error: blocked };

  const rows = await db
    .update(reactivationCampaignTargets)
    .set({ status: "approved", rejectionReason: null, updatedAt: new Date() })
    .where(
      and(
        eq(reactivationCampaignTargets.campaignId, input.campaignId),
        eq(reactivationCampaignTargets.clinicId, input.clinicId),
        inArray(reactivationCampaignTargets.id, input.targetIds),
        inArray(reactivationCampaignTargets.status, [...REVIEWABLE_STATUSES]),
        // Sem texto não há o que aprovar. Sem esta linha, um alvo cujo rascunho
        // a IA não conseguiu gerar entraria aprovado e vazio na fila.
        sql`COALESCE(${reactivationCampaignTargets.editedMessage}, ${reactivationCampaignTargets.draftMessage}) IS NOT NULL`,
      ),
    )
    .returning({ id: reactivationCampaignTargets.id });

  return { updated: rows.length };
}

export async function rejectTargets(input: {
  clinicId: string;
  campaignId: string;
  targetIds: string[];
  reason?: string;
}): Promise<ReviewResult> {
  if (input.targetIds.length === 0) return { updated: 0 };

  const blocked = await assertCampaignIsReviewable(input.clinicId, input.campaignId);
  if (blocked) return { updated: 0, error: blocked };

  const rows = await db
    .update(reactivationCampaignTargets)
    .set({
      status: "rejected",
      rejectionReason: input.reason?.trim() || "Rejeitado na revisão",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reactivationCampaignTargets.campaignId, input.campaignId),
        eq(reactivationCampaignTargets.clinicId, input.clinicId),
        inArray(reactivationCampaignTargets.id, input.targetIds),
        inArray(reactivationCampaignTargets.status, [...REVIEWABLE_STATUSES]),
      ),
    )
    .returning({ id: reactivationCampaignTargets.id });

  return { updated: rows.length };
}

/**
 * Edição manual de uma mensagem. Grava em `editedMessage` em vez de sobrescrever
 * o rascunho: preserva o que a IA escreveu, o que permite comparar depois se o
 * modelo está melhorando ou se a clínica reescreve tudo.
 *
 * Texto editado por humano NÃO passa pelos guards de preço e urgência — quem
 * escreveu foi a clínica, e ela pode prometer o que quiser em nome dela.
 */
export async function editTargetMessage(input: {
  clinicId: string;
  campaignId: string;
  targetId: string;
  text: string;
}): Promise<ReviewResult> {
  const blocked = await assertCampaignIsReviewable(input.clinicId, input.campaignId);
  if (blocked) return { updated: 0, error: blocked };

  const text = input.text.trim();
  if (!text) return { updated: 0, error: "A mensagem não pode ficar vazia." };
  if (text.length > 1000) return { updated: 0, error: "Mensagem longa demais para WhatsApp." };

  const rows = await db
    .update(reactivationCampaignTargets)
    .set({ editedMessage: text, updatedAt: new Date() })
    .where(
      and(
        eq(reactivationCampaignTargets.id, input.targetId),
        eq(reactivationCampaignTargets.campaignId, input.campaignId),
        eq(reactivationCampaignTargets.clinicId, input.clinicId),
        inArray(reactivationCampaignTargets.status, [...REVIEWABLE_STATUSES]),
      ),
    )
    .returning({ id: reactivationCampaignTargets.id });

  return { updated: rows.length };
}

export type CampaignReviewSummary = {
  pending: number;
  approved: number;
  rejected: number;
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
  replied: number;
  converted: number;
};

export async function getReviewSummary(input: {
  clinicId: string;
  campaignId: string;
}): Promise<CampaignReviewSummary> {
  const rows = await db
    .select({
      status: reactivationCampaignTargets.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(reactivationCampaignTargets)
    .where(
      and(
        eq(reactivationCampaignTargets.campaignId, input.campaignId),
        eq(reactivationCampaignTargets.clinicId, input.clinicId),
      ),
    )
    .groupBy(reactivationCampaignTargets.status);

  const summary: CampaignReviewSummary = {
    pending: 0,
    approved: 0,
    rejected: 0,
    queued: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    replied: 0,
    converted: 0,
  };
  for (const row of rows) {
    summary[row.status as keyof CampaignReviewSummary] = Number(row.count);
  }
  return summary;
}
