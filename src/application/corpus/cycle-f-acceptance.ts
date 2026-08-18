import { readFileSync } from "node:fs";
import { z } from "zod";
import { loadCorpus } from "@/application/corpus/corpus-index";

const DENTAL_FIXTURES = new Set(["dental-a", "dental-b", "demo-dental"]);
const SUPPORTED_REQUESTS = new Set([
  "price-of-service",
  "service-availability",
  "book-appointment",
  "confirm-slot",
  "confirm-appointment",
]);

const manifestSchema = z.object({
  version: z.literal("cycle-f-dental.v1"),
  population: z.literal("cycle-f-supported-dental-corpus"),
  cases: z.array(z.object({
    caseId: z.string().min(1),
    requiredAxes: z.array(z.enum(["request", "dialogueMove", "entities.service"])).min(1),
    critical: z.boolean(),
  }).strict()).min(1),
  exclusions: z.array(z.object({
    requests: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
  }).strict()).min(1),
}).strict();

export type CycleFAcceptanceManifest = z.infer<typeof manifestSchema>;

export function loadCycleFAcceptanceManifest(
  manifestPath: string,
  corpusRoot = "evals/corpus",
): CycleFAcceptanceManifest {
  const parsed = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const corpus = loadCorpus(corpusRoot);
  const byId = new Map(corpus.cases.map((corpusCase) => [corpusCase.caseId, corpusCase]));
  const seen = new Set<string>();

  for (const entry of parsed.cases) {
    if (seen.has(entry.caseId)) throw new Error(`duplicate Cycle F caseId ${entry.caseId}`);
    seen.add(entry.caseId);
    const corpusCase = byId.get(entry.caseId);
    if (!corpusCase) throw new Error(`Cycle F case ${entry.caseId} is absent from corpus`);
    if (!DENTAL_FIXTURES.has(corpusCase.input.tenantConfigRef)) {
      throw new Error(`Cycle F case ${entry.caseId} is outside dental fixtures`);
    }
    if (!SUPPORTED_REQUESTS.has(corpusCase.labels.understanding.request)) {
      throw new Error(`Cycle F case ${entry.caseId} has unsupported request`);
    }
  }

  const expectedIds = corpus.cases
    .filter((corpusCase) => DENTAL_FIXTURES.has(corpusCase.input.tenantConfigRef))
    .filter((corpusCase) => SUPPORTED_REQUESTS.has(corpusCase.labels.understanding.request))
    .map((corpusCase) => corpusCase.caseId);
  const missing = expectedIds.filter((caseId) => !seen.has(caseId));
  if (missing.length > 0) throw new Error(`Cycle F manifest omits supported cases: ${missing.join(", ")}`);

  return parsed;
}
