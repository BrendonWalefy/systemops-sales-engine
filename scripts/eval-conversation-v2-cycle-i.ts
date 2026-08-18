import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { loadCycleFAcceptanceManifest } from "@/application/corpus/cycle-f-acceptance";
import {
  buildCycleIGateEvidence,
  parseProductiveCycleIComparisonRun,
  runCycleICorpusComparison,
  type CycleIComparisonRun,
} from "@/application/conversation-v2/corpus-comparison-runner";
import {
  buildCycleIGateReport,
  type CycleIGateReport,
} from "@/application/conversation-v2/gate-report";
import {
  buildBlindHumanReviewSheet,
  scoreHumanReview,
} from "@/application/conversation-v2/human-review";
import {
  pairApprovedEvalRecords,
  type HmacRef,
} from "@/application/conversation-v2/comparison-record";
import {
  parseAuthorizedCycleIRunManifest,
  parseCycleIRunManifestSnapshot,
  type CycleIRunManifestSnapshot,
} from "@/application/conversation-v2/run-manifest-authority";
import { createProductiveCycleIUnderstandingArms } from "@/application/conversation-v2/productive-understanding-arms";
import {
  loadAuthorizedCycleIFullTurnEvidence,
  loadAuthorizedCycleIGateArtifacts,
} from "@/application/conversation-v2/approved-cycle-i-artifacts";
import {
  isRegisteredCycleIBuildAttestation,
  type CycleIBuildAttestation,
} from "@/infrastructure/conversation-v2/git-cycle-i-build-attestation";
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

function loadRunManifest(path: string): CycleIRunManifestSnapshot {
  return parseCycleIRunManifestSnapshot(JSON.parse(readFileSync(path, "utf8")));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixedClocks(manifest: CycleIRunManifestSnapshot): Readonly<Record<string, string>> {
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

function reportWithoutRun(manifest: CycleIRunManifestSnapshot) {
  const populationDigest = manifest.populationDigest;
  const datasetDigest = manifest.corpusDigest;
  return buildCycleIGateReport({
    reportDigest: digest("cycle-i-no-measurement", "cycle-i-gate-report.v1"),
    populationDigest,
    datasetDigest,
    configDigest: manifest.configDigest,
    measurements: {},
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
  preflightBuildAttestation?: CycleIBuildAttestation,
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
    if (!isRegisteredCycleIBuildAttestation(preflightBuildAttestation)) {
      throw new Error(
        "Cycle I productive measurement requires the registered trusted bootstrap preflight",
      );
    }
    const configuredV1Model = env.OPENAI_CLASSIFIER_MODEL?.trim() || "gpt-4o-mini";
    if (configuredV1Model !== manifest.v1.modelId) {
      throw new Error("V1 model differs from the frozen Cycle I run manifest");
    }
    const authority = parseAuthorizedCycleIRunManifest(
      JSON.parse(readFileSync(runManifestPath, "utf8")),
    );
    const arms = createProductiveCycleIUnderstandingArms({ manifest: authority, apiKey });
    const result = await runCycleICorpusComparison({
      corpusRoot: authority.corpusRoot,
      manifestPath: authority.manifestPath,
      d0Path: authority.d0Path,
      decisionFixtureManifestPath: authority.decisionManifest?.path ?? null,
      v1Understanding: arms.v1,
      v2Understanding: arms.v2,
      runs: authority.runs,
      fixedClockByCase: fixedClocks(authority),
      comparabilityPath: authority.comparabilityPath,
      authority,
      buildAttestation: preflightBuildAttestation,
    });
    writeJson(outputPath, result);
    return result.status === "complete" ? 0 : 2;
  }

  if (mode === "build-human-sheet") {
    const runPath = argument(argv, "--run");
    if (!runPath || !existsSync(runPath)) {
      throw new Error("a complete Cycle I run is required to build the human sheet");
    }
    const authority = parseAuthorizedCycleIRunManifest(JSON.parse(readFileSync(runManifestPath, "utf8")));
    const run = parseProductiveCycleIComparisonRun(JSON.parse(readFileSync(runPath, "utf8")), authority);
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
      const authority = parseAuthorizedCycleIRunManifest(JSON.parse(readFileSync(runManifestPath, "utf8")));
      const run: CycleIComparisonRun = parseProductiveCycleIComparisonRun(JSON.parse(readFileSync(runPath, "utf8")), authority);
      const humanPaths = ["--human-sheet", "--calibration", "--reviewer-a", "--reviewer-b"].map((name) => argument(argv, name));
      if (humanPaths.some(Boolean) && !humanPaths.every(Boolean)) throw new Error("human review requires sheet, calibration, and two reviewer files");
      const pairs = pairApprovedEvalRecords(run.prose.approvedEvalRecords);
      const humanReview = humanPaths.every(Boolean) ? scoreHumanReview({
        sheet: JSON.parse(readFileSync(humanPaths[0]!, "utf8")), pairs, runDigest: run.runDigest, authority,
        calibrationManifest: JSON.parse(readFileSync(humanPaths[1]!, "utf8")),
        reviewerA: JSON.parse(readFileSync(humanPaths[2]!, "utf8")),
        reviewerB: JSON.parse(readFileSync(humanPaths[3]!, "utf8")),
      }) : null;
      const fullTurn = authority.fullTurnEvidence === null ? null : loadAuthorizedCycleIFullTurnEvidence({ authority });
      const gateArtifacts = loadAuthorizedCycleIGateArtifacts(authority);
      report = buildCycleIGateEvidence({
        reportDigest: digest(run.runDigest, "cycle-i-gate-report.v1"),
        populationDigest: run.protocol.populationDigest,
        datasetDigest: run.protocol.corpusDigest,
        configDigest: authority.configDigest as HmacRef,
        run,
        gateArtifacts,
        humanReview,
        approvedFullTurnReplay: fullTurn,
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
