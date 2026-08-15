import { writeFileSync } from "node:fs";
import { loadCorpus } from "@/application/corpus/corpus-index";
import {
  renderReviewSheet,
  selectCalibrationSample,
  type CalibrationQuota,
} from "@/application/corpus/review-sheet";

/**
 * Gera a folha de revisão em Markdown. Não toca banco e não altera o corpus.
 *
 * `--stratified` emite a amostra de calibração: 20 casos escolhidos por cota de
 * jornada e com rodízio de origem, em vez dos 20 primeiros na ordem alfabética
 * dos shards — que deixava `price` e `objection` de fora, justamente as duas
 * jornadas de julgamento mais difícil.
 */

/**
 * Cota de calibração, calibrada pelo risco real do produto e não pelo volume:
 * preço e objeção pesam mais do que aparecem, porque é onde um julgamento errado
 * custa dinheiro ou reclamação.
 */
const CALIBRATION_QUOTA: CalibrationQuota = [
  { journeys: ["price"], count: 4 },
  { journeys: ["objection"], count: 3 },
  { journeys: ["availability", "scheduling"], count: 3 },
  { journeys: ["other"], count: 2 },
  { journeys: ["burst"], count: 2 },
  { journeys: ["ambiguity", "comparison"], count: 2 },
  { journeys: ["media"], count: 1 },
  { journeys: ["first-contact"], count: 1 },
  { journeys: ["handoff"], count: 1 },
  { journeys: ["injection"], count: 1 },
];
function main(): void {
  const argv = process.argv.slice(2);
  const out = value(argv, "--out") ?? "corpus-review.md";
  const limit = Number(value(argv, "--limit") ?? "20");
  const journey = value(argv, "--journey");

  const corpus = loadCorpus("evals/corpus");
  const selected = argv.includes("--stratified")
    ? selectCalibrationSample(corpus.cases, CALIBRATION_QUOTA)
    : corpus.cases
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
