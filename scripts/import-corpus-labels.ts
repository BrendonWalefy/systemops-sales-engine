import { readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { compareReviews, parseReviewSheet } from "@/application/corpus/review-sheet";

/**
 * Lê a folha revisada pelo segundo revisor e reporta concordância por campo.
 *
 * Não reescreve rótulo. Divergência é decisão humana: o relatório aponta onde os
 * dois revisores discordam, e a correção é reescrever a pergunta que gerou a
 * divergência — nunca abrir exceção para o caso.
 */
function main(): void {
  const argv = process.argv.slice(2);
  const sheetPath = required(argv, "--sheet");
  const outPath = value(argv, "--out");

  const corpus = loadCorpus("evals/corpus");
  const answers = parseReviewSheet(readFileSync(sheetPath, "utf8"));
  const report = compareReviews({ cases: corpus.cases, answers });

  const worst = Object.entries(report.byField)
    .filter(([, stats]) => stats.compared > 0)
    .sort((a, b) => a[1].rate - b[1].rate)[0];

  const summary = {
    ...report,
    verdict:
      report.reviewedCases === 0
        ? "nenhum caso revisado na folha"
        : worst && worst[1].rate < 0.8
          ? `pergunta "${worst[0]}" abaixo de 80% — reescrever antes de continuar`
          : "concordância dentro do limite em todos os campos",
  };

  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  if (outPath) writeFileSync(outPath, serialized, "utf8");
  console.log(serialized);
}

function required(argv: string[], flag: string): string {
  const found = value(argv, flag);
  if (!found) throw new Error(`${flag} is required`);
  return found;
}

function value(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? (argv[index + 1] ?? null) : null;
}

main();
