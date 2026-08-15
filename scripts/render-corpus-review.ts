import { writeFileSync } from "node:fs";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { renderReviewSheet } from "@/application/corpus/review-sheet";

/**
 * Gera a folha de revisão em Markdown. Não toca banco e não altera o corpus.
 *
 * Por padrão emite os 20 primeiros casos, que são os de calibração: é neles que
 * a concordância entre revisores é medida antes de o resto ser revisado.
 */
function main(): void {
  const argv = process.argv.slice(2);
  const out = value(argv, "--out") ?? "corpus-review.md";
  const limit = Number(value(argv, "--limit") ?? "20");
  const journey = value(argv, "--journey");

  const corpus = loadCorpus("evals/corpus");
  const selected = corpus.cases
    .filter((entry) => (journey ? entry.journey === journey : true))
    .slice(0, limit);

  writeFileSync(
    out,
    renderReviewSheet({
      cases: selected,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    }),
    "utf8",
  );
  console.log(JSON.stringify({ out, cases: selected.length }));
}

function value(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? (argv[index + 1] ?? null) : null;
}

main();
