/**
 * Motor de Reativação (ADR-009) — tetos de gasto de IA.
 *
 * O motor usa um modelo bom de propósito (ver REACTIVATION_MODEL): a diferença
 * entre "achou caro" e "não era o tratamento certo" decide qual oferta o
 * paciente recebe, e errar isso é pior que não enviar. Barato, porém, não é o
 * mesmo que ilimitado — um bug de laço ou uma clínica com histórico enorme não
 * podem virar uma fatura surpresa.
 *
 * **São dois orçamentos, não um.** Misturar os dois foi um erro que só apareceu
 * fazendo a conta: o teto de fundo é de US$ 0,20/dia, mas redigir uma campanha
 * de 300 pessoas custa ~US$ 1,50. Com orçamento único, a clínica clicaria
 * "gerar rascunhos" e receberia 40 de 300, sem entender por quê.
 *
 *  - **Diário, por clínica** — para a classificação, que roda sozinha em cron.
 *    Trabalho de fundo precisa de rédea curta: ninguém está olhando.
 *  - **Por campanha** — para os rascunhos, que são uma ação deliberada da
 *    clínica sobre um conjunto fechado de pessoas. O custo é conhecido de
 *    antemão e limitado pelo tamanho máximo da audiência.
 *
 * Em ambos os casos, estourar significa **adiar**, não perder: a elegibilidade
 * é recalculada do banco na execução seguinte.
 */

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { aiUsageCosts } from "@/infrastructure/db/schema";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

/** Operação de fundo: classificação automática do motivo de não-fechamento. */
const BACKGROUND_OPERATIONS = ["lead_outcome_classification"] as const;

/**
 * Teto diário por clínica para o trabalho de fundo, em micros de USD.
 * 200_000 = US$ 0,20/dia ≈ 40 classificações — bem acima do fluxo real, já que
 * só conversas que mudaram são reclassificadas. A primeira carga de uma clínica
 * com histórico grande leva alguns dias, e tudo bem: é backfill, não operação.
 */
export const DEFAULT_DAILY_AI_BUDGET_USD_MICROS = 200_000;

/**
 * Teto por campanha para redigir rascunhos. 3_000_000 = US$ 3,00.
 * Dimensionado para cobrir a audiência máxima (500 pessoas × ~US$ 0,005) com
 * folga — uma campanha nunca deve terminar pela metade por orçamento.
 */
export const DEFAULT_CAMPAIGN_DRAFT_BUDGET_USD_MICROS = 3_000_000;

export function resolveDailyBudgetUsdMicros(): number {
  return resolveEnvBudget(
    process.env.REACTIVATION_DAILY_BUDGET_USD_MICROS,
    DEFAULT_DAILY_AI_BUDGET_USD_MICROS,
  );
}

export function resolveCampaignDraftBudgetUsdMicros(): number {
  return resolveEnvBudget(
    process.env.REACTIVATION_CAMPAIGN_BUDGET_USD_MICROS,
    DEFAULT_CAMPAIGN_DRAFT_BUDGET_USD_MICROS,
  );
}

function resolveEnvBudget(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export type BudgetDecision = {
  allowed: boolean;
  spentUsdMicros: number;
  budgetUsdMicros: number;
};

/**
 * Decide se ainda há orçamento. Função pura para ser testável — a leitura do
 * banco fica nas funções abaixo.
 */
export function evaluateBudget(
  spentUsdMicros: number,
  budgetUsdMicros: number,
): BudgetDecision {
  return {
    allowed: spentUsdMicros < budgetUsdMicros,
    spentUsdMicros,
    budgetUsdMicros,
  };
}

/** Gasto de classificação hoje, na janela do dia local da clínica. */
export async function getReactivationSpendToday(
  clinicId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<number> {
  const startOfDay = new ClinicTimezone(timezone).startOfLocalDay(now);

  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${aiUsageCosts.estimatedCostUsdMicros}), 0)`,
    })
    .from(aiUsageCosts)
    .where(
      and(
        eq(aiUsageCosts.clinicId, clinicId),
        gte(aiUsageCosts.createdAt, startOfDay),
        inArray(aiUsageCosts.operation, [...BACKGROUND_OPERATIONS]),
      ),
    );

  return Number(row?.total ?? 0);
}
