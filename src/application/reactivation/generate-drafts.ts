/**
 * Motor de Reativação (ADR-009), Fase 2 — geração dos rascunhos.
 *
 * Uma mensagem por pessoa, escrita com o contexto real da conversa dela. Cada
 * rascunho passa por `validateDraft` antes de ser gravado: rascunho que cita
 * preço não autorizado ou inventa urgência é descartado, não mostrado como
 * pronto. Se aparecesse na tela verde como os outros, o operador aprovaria no
 * automático — a validação existe justamente porque revisão humana em lote
 * cansa e vira carimbo.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  priceCampaigns,
  reactivationCampaigns,
  reactivationCampaignTargets,
  treatments,
} from "@/infrastructure/db/schema";
import {
  buildReactivationMessagePrompt,
  validateDraft,
  DRAFT_REJECTION_LABELS,
  type ReactivationOffer,
} from "@/core/intelligence/ReactivationMessageComposer";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { callAdvisorLLMWithUsage, REACTIVATION_MODEL } from "@/infrastructure/llm/advisor-llm";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { estimateAiCostUsdMicros } from "@/application/services/cost-estimator";
import {
  evaluateBudget,
  resolveCampaignDraftBudgetUsdMicros,
} from "@/application/reactivation/cost-guard";
import { trackUsageSafely } from "@/application/reactivation/track-usage-safely";
import { randomUUID } from "crypto";
import { extractFirstName } from "@/core/intelligence/lead-display-name";

const MAX_OUTPUT_TOKENS = 400;
const HISTORY_LIMIT = 8;

export type GenerateDraftsResult = {
  campaignId: string;
  generated: number;
  rejected: number;
  failed: number;
  budgetExhausted: boolean;
  rejectionSummary: Record<string, number>;
};

type TargetRow = {
  target_id: string;
  lead_id: string;
  conversation_id: string;
  name: string | null;
  treatment_interest: string | null;
  outcome_reason: string | null;
  evidence_excerpt: string | null;
};

/** Preço da oferta, formatado pelo sistema — a LLM nunca formata dinheiro. */
function formatPriceLabel(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Prazo em texto, no fuso da clínica. Formatado pelo sistema justamente para a
 * LLM não ter que calcular data — "até sexta" tem que ser a sexta certa.
 */
function formatDeadlineLabel(deadline: Date, timezone: string): string {
  return deadline.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
  });
}

async function loadOffer(priceCampaignId: string): Promise<ReactivationOffer | null> {
  const [row] = await db
    .select({
      campaignName: priceCampaigns.name,
      priceCents: priceCampaigns.priceCents,
      minPriceCents: priceCampaigns.minPriceCents,
      treatmentName: treatments.name,
    })
    .from(priceCampaigns)
    .innerJoin(treatments, eq(treatments.id, priceCampaigns.treatmentId))
    .where(eq(priceCampaigns.id, priceCampaignId))
    .limit(1);

  if (!row) return null;

  // Faixa de preço vira "a partir de X" — o piso é o único número seguro de
  // prometer, e é ele que o guard vai exigir no texto.
  const cents = row.priceCents ?? row.minPriceCents;
  if (cents === null) return null;

  return {
    treatmentName: row.treatmentName,
    priceLabel: formatPriceLabel(cents),
    campaignName: row.campaignName,
  };
}

export async function generateDraftsForCampaign(input: {
  clinicId: string;
  campaignId: string;
}): Promise<GenerateDraftsResult> {
  const empty: GenerateDraftsResult = {
    campaignId: input.campaignId,
    generated: 0,
    rejected: 0,
    failed: 0,
    budgetExhausted: false,
    rejectionSummary: {},
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
  if (!campaign) return empty;

  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.clinicId),
  });
  if (!clinic) return empty;

  const offer = campaign.priceCampaignId ? await loadOffer(campaign.priceCampaignId) : null;
  const deadlineLabel = campaign.deadlineAt
    ? formatDeadlineLabel(campaign.deadlineAt, clinic.timezone)
    : null;

  const receptionistName =
    inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? "a recepção";

  // Orçamento DA CAMPANHA, não o teto diário de fundo: redigir é ação
  // deliberada sobre um conjunto fechado, e o custo é conhecido de antemão.
  const budget = resolveCampaignDraftBudgetUsdMicros();
  let spent = 0;

  const pending = await db.execute(sql`
    SELECT
      t.id              AS target_id,
      t.lead_id,
      t.conversation_id,
      l.name,
      l.treatment_interest,
      lo.reason         AS outcome_reason,
      lo.evidence_excerpt
    FROM reactivation_campaign_targets t
    JOIN leads l ON l.id = t.lead_id
    LEFT JOIN lead_outcomes lo
      ON lo.lead_id = t.lead_id AND lo.organization_id = ${input.clinicId}
    WHERE t.campaign_id = ${input.campaignId}
      AND t.organization_id = ${input.clinicId}
      AND t.status = 'pending'
      AND t.draft_message IS NULL
  `);

  const targets = pending.rows as TargetRow[];
  const costTracker = new DefaultUsageCostTracker({
    usageCostRepository: new DrizzleUsageCostRepository(),
    idGenerator: () => randomUUID(),
    now: () => new Date(),
  });

  let generated = 0;
  let rejected = 0;
  let failed = 0;
  const rejectionSummary: Record<string, number> = {};

  for (const target of targets) {
    if (!evaluateBudget(spent, budget).allowed) {
      return {
        campaignId: input.campaignId,
        generated,
        rejected,
        failed,
        budgetExhausted: true,
        rejectionSummary,
      };
    }

    try {
      const history = await db.execute(sql`
        SELECT author, body
        FROM messages
        WHERE conversation_id = ${target.conversation_id}
          AND author IN ('lead', 'agent', 'clinic_user')
        ORDER BY sent_at DESC
        LIMIT ${HISTORY_LIMIT}
      `);

      const prompt = buildReactivationMessagePrompt({
        clinicName: clinic.name,
        receptionistName,
        specialty: clinic.specialty ?? "odontologia estética",
        leadName: extractFirstName(target.name),
        treatmentInterest: target.treatment_interest,
        outcomeReason: target.outcome_reason,
        evidenceExcerpt: target.evidence_excerpt,
        offer,
        deadlineLabel,
        recentMessages: (
          history.rows as Array<{ author: string; body: string | null }>
        ).reverse(),
      });

      const llm = await callAdvisorLLMWithUsage(prompt, {
        model: REACTIVATION_MODEL,
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      const usage = {
        clinicId: input.clinicId,
        provider: llm.provider,
        model: llm.model,
        operation: "reactivation_draft" as const,
        inputTokens: llm.inputTokens,
        outputTokens: llm.outputTokens,
      };
      // O gasto entra no acumulado mesmo se o registro falhar — o teto precisa
      // valer, e a chamada já foi paga.
      spent += estimateAiCostUsdMicros(usage);
      // Contabilidade não pode destruir produto: a chamada de LLM já aconteceu
      // e foi cobrada. Se o registro de custo falhar, perdemos a linha do
      // relatório, não o rascunho pelo qual pagamos.
      await trackUsageSafely(costTracker, usage);

      const validation = validateDraft(llm.text, { offer, deadlineLabel });

      if (!validation.ok) {
        rejectionSummary[validation.reason] = (rejectionSummary[validation.reason] ?? 0) + 1;
        await db
          .update(reactivationCampaignTargets)
          .set({
            status: "rejected",
            rejectionReason: DRAFT_REJECTION_LABELS[validation.reason],
            updatedAt: new Date(),
          })
          .where(eq(reactivationCampaignTargets.id, target.target_id));
        rejected++;
        continue;
      }

      await db
        .update(reactivationCampaignTargets)
        .set({ draftMessage: validation.text, updatedAt: new Date() })
        .where(eq(reactivationCampaignTargets.id, target.target_id));
      generated++;
    } catch (err: unknown) {
      console.error(
        `[Reativacao] falha ao redigir target=${target.target_id}:`,
        err instanceof Error ? err.message : String(err),
      );
      failed++;
    }
  }

  // Só entra em revisão quando existe algo para revisar.
  if (generated > 0) {
    await db
      .update(reactivationCampaigns)
      .set({ status: "reviewing", updatedAt: new Date() })
      .where(eq(reactivationCampaigns.id, input.campaignId));
  }

  return {
    campaignId: input.campaignId,
    generated,
    rejected,
    failed,
    budgetExhausted: false,
    rejectionSummary,
  };
}
