import type { EvalStratum, SeverityLevel } from "./types";
import type { EvalReport } from "./report";

export type BaselineStratum = {
  total: number;
  accuracyMean: number;
  accuracySpread: number;
  severityCounts: Record<SeverityLevel, number>;
};

export type Baseline = {
  model: string;
  recordedAt: string;
  runs: number;
  strata: Record<EvalStratum, BaselineStratum>;
};

export type BaselineDiff = { failed: boolean; reasons: string[] };

const STRATA: EvalStratum[] = ["incident", "prompt_rule"];
const BLOCKING: SeverityLevel[] = ["critical", "high"];

/**
 * Reprova só quando falha Crítica ou Alta aumenta. Acurácia plana é informativa:
 * ela pode cair legitimamente enquanto o que importa sobe — por exemplo trocando
 * erro alto por erro baixo.
 *
 * Comparação por rodada, não por soma: com --repeat N a contagem absoluta cresce
 * com N e comparar total contra total daria falso positivo.
 *
 * Não recebe o modelo e por isso não opina sobre troca de modelo. O aviso de
 * baseline gravada com outro modelo é responsabilidade do runner.
 */
export function compareToBaseline(current: EvalReport, baseline: Baseline | null): BaselineDiff {
  if (!baseline) {
    return { failed: false, reasons: ["sem baseline commitada — esta rodada cria a referência"] };
  }

  const reasons: string[] = [];
  let failed = false;
  const runs = Math.max(current.runs, 1);
  const baseRuns = Math.max(baseline.runs, 1);

  for (const stratum of STRATA) {
    for (const level of BLOCKING) {
      const now = current.strata[stratum].severityCounts[level] / runs;
      const before = baseline.strata[stratum].severityCounts[level] / baseRuns;
      if (now > before) {
        failed = true;
        reasons.push(
          `${stratum}: falha ${level} subiu de ${before.toFixed(2)} para ${now.toFixed(2)} por rodada`,
        );
      }
    }

    const accNow = current.strata[stratum].accuracyMean;
    const accBefore = baseline.strata[stratum].accuracyMean;
    if (accNow < accBefore) {
      reasons.push(
        `${stratum}: acurácia caiu de ${(accBefore * 100).toFixed(1)}% para ${(accNow * 100).toFixed(1)}% — informativo, não reprova`,
      );
    }
  }

  if (reasons.length === 0) reasons.push("sem regressão");
  return { failed, reasons };
}
