import type { IntentType } from "@/core/intelligence/IntentClassifier";
import type { CaseOutcome, EvalStratum, SeverityLevel } from "./types";

export type StratumStats = {
  total: number;
  correctMean: number;
  accuracyMean: number;
  // Amplitude entre a melhor e a pior rodada. Com temperature 0 a OpenAI ainda
  // não é determinística; é este número que diz qual limiar não vai flakear.
  accuracySpread: number;
  severityCounts: Record<SeverityLevel, number>;
  confusions: { expected: IntentType; got: IntentType; count: number }[];
};

export type EvalReport = {
  runs: number;
  strata: Record<EvalStratum, StratumStats>;
  executionErrors: number;
};

const STRATA: EvalStratum[] = ["incident", "prompt_rule"];

function emptyStats(): StratumStats {
  return {
    total: 0,
    correctMean: 0,
    accuracyMean: 0,
    accuracySpread: 0,
    severityCounts: { none: 0, low: 0, medium: 0, high: 0, critical: 0 },
    confusions: [],
  };
}

/**
 * Agrega N rodadas. Casos com erro de execução saem da conta de acurácia por
 * completo: um 429 não é opinião do modelo sobre a mensagem.
 */
export function buildReport(outcomesPerRun: CaseOutcome[][]): EvalReport {
  const strata = Object.fromEntries(STRATA.map((s) => [s, emptyStats()])) as Record<EvalStratum, StratumStats>;
  let executionErrors = 0;

  for (const stratum of STRATA) {
    const perRunCorrect: number[] = [];
    const perRunTotal: number[] = [];
    const confusionCounts = new Map<string, number>();

    for (const run of outcomesPerRun) {
      const scored = run.filter((o) => o.stratum === stratum && o.executionError === null);
      const correct = scored.filter((o) => o.expected === o.got).length;
      perRunCorrect.push(correct);
      perRunTotal.push(scored.length);

      for (const o of scored) {
        if (o.expected === o.got || o.got === null) continue;
        const key = `${o.expected}>${o.got}`;
        confusionCounts.set(key, (confusionCounts.get(key) ?? 0) + 1);
      }
      for (const o of scored) {
        strata[stratum].severityCounts[o.severity] += 1;
      }
    }

    const runs = outcomesPerRun.length || 1;
    const accuracies = perRunTotal.map((total, i) => (total === 0 ? 0 : perRunCorrect[i] / total));

    strata[stratum].total = Math.max(...perRunTotal, 0);
    strata[stratum].correctMean = perRunCorrect.reduce((a, b) => a + b, 0) / runs;
    strata[stratum].accuracyMean = accuracies.reduce((a, b) => a + b, 0) / runs;
    strata[stratum].accuracySpread =
      accuracies.length > 1 ? Math.max(...accuracies) - Math.min(...accuracies) : 0;
    strata[stratum].confusions = [...confusionCounts.entries()]
      .map(([key, count]) => {
        const [expected, got] = key.split(">") as [IntentType, IntentType];
        return { expected, got, count };
      })
      .sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected));
  }

  for (const run of outcomesPerRun) {
    executionErrors += run.filter((o) => o.executionError !== null).length;
  }

  return { runs: outcomesPerRun.length, strata, executionErrors };
}
