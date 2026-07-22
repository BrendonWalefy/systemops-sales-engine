/**
 * Motor de Reativação (ADR-009) — registro de custo tolerante a falha.
 *
 * A chamada de LLM já aconteceu e já foi cobrada quando chegamos aqui. Se o
 * INSERT em `ai_usage_costs` falhar (enum novo ainda não migrado, indisponibilidade
 * momentânea do banco), o custo real não desaparece — só o registro dele. Deixar
 * essa falha subir descartaria a classificação ou o rascunho pelo qual acabamos
 * de pagar, que é o pior dos dois mundos.
 *
 * Encontrado rodando o fluxo ponta a ponta contra uma branch do banco: seis
 * chamadas bem-sucedidas ao modelo foram perdidas porque a linha de contabilidade
 * não entrou.
 *
 * O acumulado do orçamento é atualizado pelo caller ANTES desta chamada, então o
 * teto continua valendo mesmo quando o registro falha.
 */

import type { UsageCostTracker, TrackAiUsageInput } from "@/application/ports/usage-cost-tracker";

export async function trackUsageSafely(
  tracker: UsageCostTracker,
  usage: TrackAiUsageInput,
): Promise<void> {
  try {
    await tracker.trackAiUsage(usage);
  } catch (err: unknown) {
    console.error(
      `[Reativacao] custo não registrado (operação=${usage.operation}, clinic=${usage.clinicId}):`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
