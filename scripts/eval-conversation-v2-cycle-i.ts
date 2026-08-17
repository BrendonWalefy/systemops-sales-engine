import OpenAI from "openai";
import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { loadCycleFAcceptanceManifest } from "@/application/corpus/cycle-f-acceptance";
import {
  buildCycleIGateEvidence,
  parseCycleIComparisonRun,
  runCycleICorpusComparison,
  type CycleIComparisonRun,
  type CycleIUnderstandingArm,
} from "@/application/conversation-v2/corpus-comparison-runner";
import {
  buildCycleIGateReport,
  type CycleIGateReport,
} from "@/application/conversation-v2/gate-report";
import {
  buildBlindHumanReviewSheet,
} from "@/application/conversation-v2/human-review";
import {
  pairApprovedEvalRecords,
  type HmacRef,
  type ModelCallSummary,
} from "@/application/conversation-v2/comparison-record";
import { IntentClassifier } from "@/core/intelligence/IntentClassifier";
import type { Message } from "@/domain/entities/conversation";
import { DentalUnderstandingProvider } from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";
import { OpenAIDentalUnderstandingModel } from "@/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel";

const RUN_MANIFEST_VERSION = "conversation-v2-cycle-i-run-manifest.v1" as const;
const hmac = z.string().regex(/^hmac:[a-f0-9]{64}$/);
const runManifestSchema = z.object({
  version: z.literal(RUN_MANIFEST_VERSION),
  implementationBaseCommit: z.string().regex(/^[a-f0-9]{7,64}$/),
  corpusRoot: z.string().min(1),
  manifestPath: z.string().min(1),
  d0Path: z.string().min(1),
  decisionFixtureManifestPath: z.string().min(1).nullable(),
  runs: z.literal(6),
  v1ModelId: z.string().min(1).max(128),
  v2ModelId: z.string().min(1).max(128),
  configDigest: hmac,
  judge: z.literal("experimental_non_gating"),
  evidence: z.object({
    hEntailment: hmac,
    shadowNoEffects: hmac,
    cycleFAxes: hmac,
    rollback: hmac,
    observability: hmac,
  }).strict(),
  fullTurnEvidence: z.null(),
}).strict();
type RunManifest = z.infer<typeof runManifestSchema>;
type CliEnvironment = Readonly<Record<string, string | undefined>>;

function freeze<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return Object.freeze(value);
}

function digest(value: unknown, domain: string): HmacRef {
  return `hmac:${createHmac("sha256", domain)
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")}`;
}

function argument(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function loadRunManifest(path: string): RunManifest {
  return freeze(runManifestSchema.parse(JSON.parse(readFileSync(path, "utf8"))));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixedClocks(manifest: RunManifest): Readonly<Record<string, string>> {
  const corpus = loadCorpus(manifest.corpusRoot);
  const population = loadCycleFAcceptanceManifest(
    manifest.manifestPath,
    manifest.corpusRoot,
  );
  const byId = new Map(corpus.cases.map((entry) => [entry.caseId, entry]));
  return freeze(Object.fromEntries(population.cases.map(({ caseId }) => [
    caseId,
    byId.get(caseId)!.source.capturedAt,
  ])));
}

function tenantConfig(path: string): Readonly<{
  services: readonly Readonly<{ name: string }>[];
}> {
  return z.object({
    services: z.array(z.object({ name: z.string().min(1) }).passthrough()),
  }).passthrough().parse(JSON.parse(readFileSync(path, "utf8")));
}

function messages(
  caseId: string,
  fixedNow: string,
  history: readonly Readonly<{
    author: "lead" | "agent" | "operator";
    body: string;
  }>[],
): Message[] {
  return history.map((entry, index) => ({
    id: `${caseId}-history-${index}`,
    conversationId: caseId,
    author: entry.author === "lead" ? "lead" : "clinic_user",
    body: entry.body,
    sentAt: new Date(fixedNow),
    externalId: null,
  })) as Message[];
}

function modelSummary(modelId: string, latencyMs: number): ModelCallSummary {
  return freeze({
    modelId,
    calls: 1,
    inputTokens: null,
    outputTokens: null,
    latencyMs: Math.max(0, Math.round(latencyMs)),
    estimatedCostMinor: null,
  });
}

function createUnderstandingArms(
  manifest: RunManifest,
  apiKey: string,
): Readonly<{
  v1: CycleIUnderstandingArm;
  v2: CycleIUnderstandingArm;
}> {
  const corpus = loadCorpus(manifest.corpusRoot);
  const byId = new Map(corpus.cases.map((entry) => [entry.caseId, entry]));
  const classifier = new IntentClassifier();
  const v2Provider = new DentalUnderstandingProvider(
    new OpenAIDentalUnderstandingModel(new OpenAI({ apiKey }), manifest.v2ModelId),
  );
  return freeze({
    v1: freeze({
      async runCase(input) {
        const corpusCase = byId.get(input.caseId);
        if (!corpusCase) throw new Error("case absent from frozen corpus");
        const config = tenantConfig(
          `${manifest.corpusRoot}/tenant-configs/${corpusCase.input.tenantConfigRef}.json`,
        );
        const startedAt = performance.now();
        const result = await classifier.classify(
          input.leadMessage,
          messages(input.caseId, input.fixedNow, input.history),
          false,
          config.services.map((service) => ({ name: service.name, aliases: [] })),
        );
        return freeze({
          request: result.intent,
          model: modelSummary(manifest.v1ModelId, performance.now() - startedAt),
        });
      },
    }),
    v2: freeze({
      async runCase(input) {
        const corpusCase = byId.get(input.caseId);
        if (!corpusCase) throw new Error("case absent from frozen corpus");
        const config = tenantConfig(
          `${manifest.corpusRoot}/tenant-configs/${corpusCase.input.tenantConfigRef}.json`,
        );
        const startedAt = performance.now();
        const result = await v2Provider.understand({
          leadMessage: input.leadMessage,
          history: input.history.map((entry) => ({
            author: entry.author === "lead" ? "lead" as const : "agent" as const,
            body: entry.body,
          })),
          state: null,
          catalog: config.services.map((service, index) => ({
            id: `fixture-service-${index}`,
            displayName: service.name,
            aliases: [],
          })),
        });
        return freeze({
          request: result.request,
          model: modelSummary(manifest.v2ModelId, performance.now() - startedAt),
        });
      },
    }),
  });
}

function reportWithoutRun(manifest: RunManifest) {
  const corpus = loadCorpus(manifest.corpusRoot);
  const population = loadCycleFAcceptanceManifest(
    manifest.manifestPath,
    manifest.corpusRoot,
  );
  const populationDigest = digest(population, "cycle-i-population.v1");
  const datasetDigest = digest(corpus.cases, "cycle-i-corpus.v1");
  const evidence = (evidenceDigest: HmacRef, denominator: number) => ({
    evidenceDigest,
    populationDigest,
    datasetDigest,
    configDigest: manifest.configDigest as HmacRef,
    denominator,
  });
  return buildCycleIGateReport({
    reportDigest: digest("cycle-i-no-measurement", "cycle-i-gate-report.v1"),
    populationDigest,
    datasetDigest,
    configDigest: manifest.configDigest,
    measurements: {
      h_entailment: { ...evidence(manifest.evidence.hEntailment as HmacRef, 1), passed: true },
      shadow_no_effects: {
        ...evidence(manifest.evidence.shadowNoEffects as HmacRef, 1),
        sideEffects: 0,
        contamination: 0,
      },
      rollback: { ...evidence(manifest.evidence.rollback as HmacRef, 1), passed: true },
      observability: {
        ...evidence(manifest.evidence.observability as HmacRef, 1),
        passed: true,
      },
    },
  });
}

function finalizeReport(report: CycleIGateReport): CycleIGateReport {
  const reportDigest = digest({
    ...report,
    reportDigest: null,
    authoritySignature: null,
  }, "cycle-i-gate-report.v1");
  return buildCycleIGateReport({
    reportDigest,
    populationDigest: report.populationDigest,
    datasetDigest: report.datasetDigest,
    configDigest: report.configDigest,
    measurements: report.measurements,
  });
}

export async function runCycleICli(
  argv: readonly string[] = process.argv.slice(2),
  env: CliEnvironment = process.env,
): Promise<number> {
  const mode = argument(argv, "--mode");
  const outputPath = argument(argv, "--out");
  const runManifestPath = argument(argv, "--run-manifest")
    ?? "evals/cycle-i/run-manifest.json";
  if (!mode || !outputPath) throw new Error("--mode and --out are required");
  const manifest = loadRunManifest(runManifestPath);

  if (mode === "measure") {
    const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY absent; no Cycle I observations were created");
    }
    const configuredV1Model = env.OPENAI_CLASSIFIER_MODEL?.trim() || "gpt-4o-mini";
    if (configuredV1Model !== manifest.v1ModelId) {
      throw new Error("V1 model differs from the frozen Cycle I run manifest");
    }
    const arms = createUnderstandingArms(manifest, apiKey);
    const result = await runCycleICorpusComparison({
      corpusRoot: manifest.corpusRoot,
      manifestPath: manifest.manifestPath,
      d0Path: manifest.d0Path,
      decisionFixtureManifestPath: manifest.decisionFixtureManifestPath,
      v1Understanding: arms.v1,
      v2Understanding: arms.v2,
      runs: manifest.runs,
      fixedClockByCase: fixedClocks(manifest),
    });
    writeJson(outputPath, result);
    return result.status === "complete" ? 0 : 2;
  }

  if (mode === "build-human-sheet") {
    const runPath = argument(argv, "--run");
    if (!runPath || !existsSync(runPath)) {
      throw new Error("a complete Cycle I run is required to build the human sheet");
    }
    const run = parseCycleIComparisonRun(JSON.parse(readFileSync(runPath, "utf8")));
    if (run.status !== "complete" || run.prose.approvedEvalRecords.length === 0) {
      throw new Error("approved V1/V2 prose pairs are unavailable; no human sheet was created");
    }
    const pairs = pairApprovedEvalRecords(run.prose.approvedEvalRecords);
    writeJson(outputPath, buildBlindHumanReviewSheet({ runDigest: run.runDigest, pairs }));
    return 0;
  }

  if (mode === "evaluate-gates") {
    const runPath = argument(argv, "--run");
    let report;
    if (!runPath || !existsSync(runPath)) {
      report = reportWithoutRun(manifest);
    } else {
      const run: CycleIComparisonRun = parseCycleIComparisonRun(
        JSON.parse(readFileSync(runPath, "utf8")),
      );
      report = buildCycleIGateEvidence({
        reportDigest: digest(run.runDigest, "cycle-i-gate-report.v1"),
        populationDigest: run.protocol.populationDigest,
        datasetDigest: run.protocol.corpusDigest,
        configDigest: manifest.configDigest as HmacRef,
        run,
        evidence: manifest.evidence as Record<string, HmacRef>,
        humanReview: null,
        approvedFullTurnReplay: null,
        verification: null,
        adversarialReview: null,
      });
    }
    writeJson(outputPath, finalizeReport(report));
    return 0;
  }

  throw new Error(`unsupported Cycle I eval mode: ${mode}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  runCycleICli().then(
    (exitCode) => { process.exitCode = exitCode; },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : "Cycle I eval failed");
      process.exitCode = 1;
    },
  );
}
