// Runner do eval de intenção. Único ponto do harness que chama a API real.
// Não altera nada de produção: importa o classificador e apenas o observa.
//
// Uso:
//   npm run eval:intent
//   npm run eval:intent -- --repeat 3
//   npm run eval:intent -- --model gpt-4.1-mini
//   npm run eval:intent -- --no-treatments     (experimento de interferência, §11)
//   npm run eval:intent -- --json
//   npm run eval:intent -- --write-baseline
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEvalCases } from "../evals/intent/load-cases";
import { classifyConfusion } from "../evals/intent/severity";
import { buildReport, type EvalReport } from "../evals/intent/report";
import { compareToBaseline, type Baseline, type BaselineDiff } from "../evals/intent/baseline";
import type { CaseOutcome, EvalCase, EvalStratum } from "../evals/intent/types";
import type { IntentType } from "../src/core/intelligence/IntentClassifier";
import type { Message } from "../src/domain/entities/conversation";

const CASES_PATH = resolve("evals/intent/cases.jsonl");
const BASELINE_PATH = resolve("evals/intent/baseline.json");
const EXECUTION_ERROR_ABORT_RATIO = 0.05;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function toMessages(caseItem: EvalCase): Message[] {
  return caseItem.history.map((entry, index) => ({
    id: `${caseItem.id}-h${index}`,
    conversationId: caseItem.id,
    author: entry.author,
    body: entry.body,
    sentAt: new Date("2026-01-01T12:00:00.000Z"),
    externalId: null,
  }));
}

async function main(): Promise<void> {
  const repeat = Number(option("repeat") ?? "1");
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat precisa ser inteiro >= 1");

  const modelOverride = option("model");
  // MODEL é const de módulo em IntentClassifier, avaliado na importação. A env
  // precisa estar posta ANTES do import dinâmico, senão o override é ignorado.
  if (modelOverride) process.env.OPENAI_CLASSIFIER_MODEL = modelOverride;
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ausente — rode via npm run eval:intent");

  const { IntentClassifier } = await import("../src/core/intelligence/IntentClassifier");
  const model = process.env.OPENAI_CLASSIFIER_MODEL?.trim() || "gpt-4o-mini";
  const classifier = new IntentClassifier();
  const cases = loadEvalCases(CASES_PATH);
  const stripTreatments = flag("no-treatments");

  const runs: CaseOutcome[][] = [];
  for (let run = 0; run < repeat; run += 1) {
    const outcomes: CaseOutcome[] = [];
    for (const caseItem of cases) {
      const treatments = stripTreatments
        ? []
        : caseItem.context.treatments.map((name) => ({ name }));
      try {
        const result = await classifier.classify(
          caseItem.message,
          toMessages(caseItem),
          caseItem.context.hasPendingSlotOffer,
          treatments,
          {
            agentRole: "recepcionista virtual",
            serviceNoun: "tratamento",
            bookingNoun: "consulta",
            contactNoun: "paciente",
            businessDescriptor: "clínica",
            isClinicSegment: caseItem.context.isClinicSegment,
          },
          null,
        );
        const got = result.intent as IntentType;
        outcomes.push({
          caseId: caseItem.id,
          stratum: caseItem.stratum,
          expected: caseItem.expected,
          got,
          severity: classifyConfusion(caseItem.expected, got),
          executionError: null,
        });
      } catch (error) {
        outcomes.push({
          caseId: caseItem.id,
          stratum: caseItem.stratum,
          expected: caseItem.expected,
          got: null,
          severity: "none",
          executionError: error instanceof Error ? error.message : String(error),
        });
      }
    }
    runs.push(outcomes);
    process.stderr.write(`rodada ${run + 1}/${repeat} concluída\n`);
  }

  const report = buildReport(runs);
  const attempted = cases.length * repeat;
  if (attempted > 0 && report.executionErrors / attempted > EXECUTION_ERROR_ABORT_RATIO) {
    throw new Error(
      `${report.executionErrors} de ${attempted} chamadas falharam (> ${EXECUTION_ERROR_ABORT_RATIO * 100}%) — número sujo, abortando`,
    );
  }

  let baseline: Baseline | null = null;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    baseline = null;
  }
  if (baseline && baseline.model !== model) {
    process.stderr.write(`aviso: baseline é de modelo diferente (${baseline.model} vs ${model})\n`);
  }
  const diff = compareToBaseline(report, baseline);

  if (flag("json")) {
    process.stdout.write(`${JSON.stringify({ model, report, diff }, null, 2)}\n`);
  } else {
    printReport(model, repeat, report, diff, stripTreatments);
  }

  if (flag("write-baseline")) {
    const next: Baseline = {
      model,
      recordedAt: new Date().toISOString(),
      runs: report.runs,
      strata: {
        incident: pickBaselineStratum(report, "incident"),
        prompt_rule: pickBaselineStratum(report, "prompt_rule"),
      },
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    process.stderr.write(`baseline escrita em ${BASELINE_PATH}\n`);
  }

  process.exitCode = diff.failed ? 1 : 0;
}

function pickBaselineStratum(report: EvalReport, stratum: EvalStratum) {
  const s = report.strata[stratum];
  return {
    total: s.total,
    accuracyMean: s.accuracyMean,
    accuracySpread: s.accuracySpread,
    severityCounts: s.severityCounts,
  };
}

function printReport(
  model: string,
  repeat: number,
  report: EvalReport,
  diff: BaselineDiff,
  stripTreatments: boolean,
): void {
  const labels: Record<EvalStratum, string> = {
    incident: "Estrato A — incidentes reais",
    prompt_rule: "Estrato B — aderência às regras do prompt",
  };
  process.stdout.write(`\nModelo: ${model}   Rodadas: ${repeat}`);
  if (stripTreatments) process.stdout.write("   [sem lista de tratamentos]");
  process.stdout.write("\n");

  for (const stratum of ["incident", "prompt_rule"] as EvalStratum[]) {
    const s = report.strata[stratum];
    if (s.total === 0) continue;
    process.stdout.write(`\n${labels[stratum]} (${s.total} casos)\n`);
    process.stdout.write(
      `  Acertos: ${s.correctMean.toFixed(1)}/${s.total} (${(s.accuracyMean * 100).toFixed(1)}%, amplitude ${(s.accuracySpread * 100).toFixed(1)} pp)\n`,
    );
    const c = s.severityCounts;
    process.stdout.write(
      `  Falhas:  crítica ${c.critical}   alta ${c.high}   média ${c.medium}   baixa ${c.low}\n`,
    );
    for (const confusion of s.confusions.slice(0, 5)) {
      process.stdout.write(
        `    ${confusion.expected} <- ${confusion.got}   ${confusion.count}x\n`,
      );
    }
  }

  process.stdout.write(`\nErros de execução: ${report.executionErrors}\n`);
  process.stdout.write(`${diff.failed ? "REPROVOU" : "Diff vs baseline"}: ${diff.reasons.join("; ")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
