/**
 * Motor de Reativação (ADR-009), Fase 2 — criação de campanha.
 *
 * A audiência é **congelada** aqui: os alvos são materializados no momento da
 * criação, a partir do mesmo segmento que gerou o preview. Isso fecha a brecha
 * de "a clínica aprovou 40 e o sistema mandou para 300" — depois da criação, a
 * lista não muda sozinha.
 *
 * As exclusões de SEGURANÇA continuam sendo reavaliadas no disparo (opt-out,
 * agendou no meio do caminho). Congelar quem entrou não é o mesmo que ignorar
 * o que mudou desde então.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  reactivationCampaigns,
  reactivationCampaignTargets,
  leads,
  priceCampaigns,
} from "@/infrastructure/db/schema";
import {
  parseSegment,
  type AudienceSegment,
  type SegmentValidationError,
} from "@/application/reactivation/audience-segment";
import { resolveAudience } from "@/application/reactivation/audience-resolver";

export type CreateCampaignInput = {
  clinicId: string;
  name: string;
  segment: unknown;
  priceCampaignId?: string | null;
  deadlineAt?: Date | null;
  dailySendCap?: number;
  testLeadId?: string | null;
  createdByEmail?: string | null;
};

export type CreateCampaignResult =
  | { ok: true; campaignId: string; targetCount: number }
  | { ok: false; errors: SegmentValidationError[] };

export const MIN_DAILY_SEND_CAP = 5;
export const MAX_DAILY_SEND_CAP = 100;
export const DEFAULT_DAILY_SEND_CAP = 30;

export async function createReactivationCampaign(
  input: CreateCampaignInput,
): Promise<CreateCampaignResult> {
  const errors: SegmentValidationError[] = [];

  const name = input.name?.trim();
  if (!name) {
    errors.push({ field: "name", message: "Dê um nome para a campanha." });
  }

  const { segment, errors: segmentErrors } = parseSegment(input.segment);
  errors.push(...segmentErrors);

  const dailySendCap = clampDailyCap(input.dailySendCap);
  if (dailySendCap === null) {
    errors.push({
      field: "dailySendCap",
      message: `O limite diário precisa ficar entre ${MIN_DAILY_SEND_CAP} e ${MAX_DAILY_SEND_CAP}.`,
    });
  }

  if (input.deadlineAt && input.deadlineAt.getTime() < Date.now()) {
    errors.push({ field: "deadlineAt", message: "O prazo já passou." });
  }

  // Prazo sem oferta não tem o que expirar, e a IA preenche o vazio sozinha:
  // rodando o fluxo de ponta a ponta, campanhas com prazo e sem oferta geraram
  // "consigo te encaixar até sábado" — promessa de agenda que a clínica não fez.
  // O prazo é a validade da CONDIÇÃO, não um limite para agendar.
  if (input.deadlineAt && !input.priceCampaignId) {
    errors.push({
      field: "deadlineAt",
      message:
        "Prazo só faz sentido junto de uma oferta — é a validade dela. Escolha uma oferta ou remova o prazo.",
    });
  }

  // Oferta e lead de teste precisam pertencer à MESMA clínica. Sem esta
  // checagem, um id de outro tenant vindo do formulário passaria — a FK só
  // garante que a linha existe, não de quem ela é.
  if (input.priceCampaignId) {
    const owned = await db
      .select({ id: priceCampaigns.id })
      .from(priceCampaigns)
      .where(
        and(
          eq(priceCampaigns.id, input.priceCampaignId),
          eq(priceCampaigns.clinicId, input.clinicId),
        ),
      )
      .limit(1);
    if (owned.length === 0) {
      errors.push({ field: "priceCampaignId", message: "Oferta não encontrada nesta clínica." });
    }
  }

  if (input.testLeadId) {
    const owned = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, input.testLeadId), eq(leads.clinicId, input.clinicId)))
      .limit(1);
    if (owned.length === 0) {
      errors.push({ field: "testLeadId", message: "Contato de teste não encontrado nesta clínica." });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const audience = await resolveAudience(input.clinicId, segment);
  if (audience.length === 0) {
    return {
      ok: false,
      errors: [
        {
          field: "segment",
          message: "Nenhum contato entra nesse filtro. Amplie a janela ou remova um critério.",
        },
      ],
    };
  }

  const [campaign] = await db
    .insert(reactivationCampaigns)
    .values({
      clinicId: input.clinicId,
      name: name!,
      segment: segment as unknown as AudienceSegment,
      priceCampaignId: input.priceCampaignId ?? null,
      deadlineAt: input.deadlineAt ?? null,
      status: "draft",
      messageMode: "ai_per_lead",
      dailySendCap: dailySendCap!,
      testLeadId: input.testLeadId ?? null,
      createdByEmail: input.createdByEmail ?? null,
    })
    .returning({ id: reactivationCampaigns.id });

  await db.insert(reactivationCampaignTargets).values(
    audience.map((lead) => ({
      campaignId: campaign.id,
      clinicId: input.clinicId,
      leadId: lead.lead_id,
      conversationId: lead.conversation_id,
      status: "pending" as const,
    })),
  );

  return { ok: true, campaignId: campaign.id, targetCount: audience.length };
}

function clampDailyCap(value: number | undefined): number | null {
  if (value === undefined) return DEFAULT_DAILY_SEND_CAP;
  if (!Number.isInteger(value)) return null;
  if (value < MIN_DAILY_SEND_CAP || value > MAX_DAILY_SEND_CAP) return null;
  return value;
}

/**
 * Aprovação humana. Sem `approvedAt` nada é enfileirado — a checagem vive no
 * dispatcher, mas a transição de estado é aqui.
 *
 * Só sai de `reviewing`: aprovar uma campanha em `draft` significaria liberar
 * envio antes de qualquer rascunho existir.
 */
export async function approveCampaign(input: {
  clinicId: string;
  campaignId: string;
  approvedByEmail: string;
}): Promise<{ ok: boolean; approvedTargets: number; error?: string }> {
  const [campaign] = await db
    .select({
      id: reactivationCampaigns.id,
      status: reactivationCampaigns.status,
    })
    .from(reactivationCampaigns)
    .where(
      and(
        eq(reactivationCampaigns.id, input.campaignId),
        eq(reactivationCampaigns.clinicId, input.clinicId),
      ),
    )
    .limit(1);

  if (!campaign) return { ok: false, approvedTargets: 0, error: "Campanha não encontrada." };
  if (campaign.status !== "reviewing") {
    return {
      ok: false,
      approvedTargets: 0,
      error: `Só dá para aprovar uma campanha em revisão (esta está em "${campaign.status}").`,
    };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(reactivationCampaignTargets)
    .where(
      and(
        eq(reactivationCampaignTargets.campaignId, input.campaignId),
        eq(reactivationCampaignTargets.status, "approved"),
      ),
    );

  if (Number(count) === 0) {
    return {
      ok: false,
      approvedTargets: 0,
      error: "Nenhuma mensagem foi aprovada. Revise os rascunhos antes de liberar o envio.",
    };
  }

  await db
    .update(reactivationCampaigns)
    .set({
      status: "approved",
      approvedByEmail: input.approvedByEmail,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reactivationCampaigns.id, input.campaignId));

  return { ok: true, approvedTargets: Number(count) };
}
