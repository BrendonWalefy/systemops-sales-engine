import { readFileSync } from "node:fs";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { loadCycleFAcceptanceManifest } from "@/application/corpus/cycle-f-acceptance";
import { summarizeCycleFUnderstanding } from "@/application/corpus/eval-understanding-gate";

const observationsPath = process.argv[2];
if (!observationsPath) {
  throw new Error("usage: tsx scripts/eval-understanding-v2.ts <observations.json>");
}

const manifest = loadCycleFAcceptanceManifest("evals/understanding/cycle-f-dental.json");
const corpus = loadCorpus("evals/corpus");
const expected = Object.fromEntries(corpus.cases.map((corpusCase) => [
  corpusCase.caseId,
  corpusCase.labels.understanding,
]));
const input = JSON.parse(readFileSync(observationsPath, "utf8"));
const report = summarizeCycleFUnderstanding({ manifest, expected, ...input });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
