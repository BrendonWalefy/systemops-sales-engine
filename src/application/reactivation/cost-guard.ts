/**
 * Motor de Reativação (ADR-009) — teto de gasto de IA por clínica/dia.
 *
 * O motor usa um modelo bom de propósito (ver REACTIVATION_MODEL): a diferença
 * entre "achou caro" e "não era o tratamento certo" decide qual oferta o
 * paciente recebe, e errar isso é pior que não enviar. Barato, porém, não é o
 * mesmo que ilimitado — um bug de laço ou uma clínica com histórico enorme não
 * podem virar uma fatura surpresa.
 *
 * Política: acumulado do dia (janela local da clínica) contra um teto; estourou,
 * a operação **adia** em vez de gastar. Nada é perdido — a próxima execução do
 * cron retoma de onde parou, porque a elegibilidade é recalculada por conversa
 * alterada, não por fila em memória.
 */

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { aiUsageCosts } from "@/infrastructure/db/schema";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

/** Operações que consomem o orçamento do motor. */
const REACTIVATION_OPERATIONS = ["lead_outcome_classification"] as const;

/**
 * Teto diário por clínica, em micros de USD. 200_000 = US$ 0,20/dia.
 *
 * Dimensionamento: uma classificação custa ~US$ 0,005, então o teto cobre ~40
 * leads/dia por clínica em regime permanente — bem acima do fluxo real (só
 * conversas que mudaram são reclassificadas). A primeira carga de uma clínica
 * com histórico grande leva alguns dias para completar, e isso é aceitável:
 * é backfill, não operação.
 */
export const DEFAULT_DAILY_AI_BUDGET_USD_MICROS = 200_000;

export function resolveDailyBudgetUsdMicros(): number {
  const raw = Number(process.env.REACTIVATION_DAILY_BUDGET_USD_MICROS);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_DAILY_AI_BUDGET_USD_MICROS;
}

export type BudgetDecision =
  | { allowed: true; spentUsdMicros: number; budgetUsdMicros: number }
  | { allowed: false; spentUsdMicros: number; budgetUsdMicros: number };

/**
 * Decide se a clínica ainda tem orçamento hoje. Função pura para ser testável —
 * a leitura do banco fica em `getReactivationSpendToday`.
 */
export function evaluateBudget(
  spentUsdMicros: number,
  budgetUsdMicros: number,
): BudgetDecision {
  return spentUsdMicros >= budgetUsdMicros
    ? { allowed: false, spentUsdMicros, budgetUsdMicros }
    : { allowed: true, spentUsdMicros, budgetUsdMicros };
}

/** Gasto do motor hoje, na janela do dia local da clínica. */
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
        inArray(aiUsageCosts.operation, [...REACTIVATION_OPERATIONS]),
      ),
    );

  return Number(row?.total ?? 0);
}
