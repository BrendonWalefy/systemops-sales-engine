import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCycleIGateEvidence,
  runCycleICorpusComparison,
  type CycleIUnderstandingArm,
} from "@/application/conversation-v2/corpus-comparison-runner";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { loadCycleFAcceptanceManifest } from "@/application/corpus/cycle-f-acceptance";

const ref = (value: string): `hmac:${string}` => `hmac:${value.repeat(64).slice(0, 64)}`;
const model = Object.freeze({ modelId: "deterministic-test", calls: 1, inputTokens: null, outputTokens: null, latencyMs: 0, estimatedCostMinor: null });
const arm: CycleIUnderstandingArm = Object.freeze({ async runCase() { return Object.freeze({ request: "price-of-service", model }); } });

async function completeRun() {
  const corpus = loadCorpus("evals/corpus");
  const manifest = loadCycleFAcceptanceManifest("evals/understanding/cycle-f-dental.json");
  const byId = new Map(corpus.cases.map((entry) => [entry.caseId, entry]));
  return runCycleICorpusComparison({
    corpusRoot: "evals/corpus",
    manifestPath: "evals/understanding/cycle-f-dental.json",
    d0Path: "evals/corpus/measurement-stability-d0.json",
    decisionFixtureManifestPath: null,
    v1Understanding: arm,
    v2Understanding: arm,
    runs: 6,
    fixedClockByCase: Object.freeze(Object.fromEntries(
      manifest.cases.map(({ caseId }) => [caseId, byId.get(caseId)!.source.capturedAt]),
    )),
  });
}

describe("Cycle I gate evidence", () => {
  it("rejects a structurally valid run produced with unregistered injected arms", async () => {
    const run = await completeRun();
    expect(() => buildCycleIGateEvidence({
      reportDigest: ref("1"),
      populationDigest: run.protocol.populationDigest,
      datasetDigest: run.protocol.corpusDigest,
      configDigest: ref("4"),
      run,
      gateArtifacts: {} as never,
      humanReview: null,
      approvedFullTurnReplay: null,
    })).toThrow(/registered|authorized|productive/i);
  });

  it("rejects an unregistered infrastructure-error run before evaluating absent evidence", async () => {
    const failingArm: CycleIUnderstandingArm = Object.freeze({ async runCase() { throw new Error("provider down"); } });
    const corpus = loadCorpus("evals/corpus");
    const manifest = loadCycleFAcceptanceManifest("evals/understanding/cycle-f-dental.json");
    const byId = new Map(corpus.cases.map((entry) => [entry.caseId, entry]));
    const run = await runCycleICorpusComparison({
      corpusRoot: "evals/corpus",
      manifestPath: "evals/understanding/cycle-f-dental.json",
      d0Path: "evals/corpus/measurement-stability-d0.json",
      decisionFixtureManifestPath: null,
      v1Understanding: arm,
      v2Understanding: failingArm,
      runs: 6,
      fixedClockByCase: Object.freeze(Object.fromEntries(
        manifest.cases.map(({ caseId }) => [caseId, byId.get(caseId)!.source.capturedAt]),
      )),
    });
    expect(() => buildCycleIGateEvidence({
      reportDigest: ref("1"), populationDigest: run.protocol.populationDigest,
      datasetDigest: run.protocol.corpusDigest, configDigest: ref("4"), run,
      gateArtifacts: {} as never, humanReview: null, approvedFullTurnReplay: null,
    })).toThrow(/registered|authorized|productive/i);
  });

  it("does not accept injected Decision measurements on an unregistered run", async () => {
    const run = await completeRun();
    const measuredRun = {
      ...run,
      decision: {
        status: "measured" as const,
        caseCount: 1,
        matches: 1,
        criticalRegressionCount: 0,
        evidenceDigest: ref("d"),
        approvedEvalRecords: [],
      },
    };
    expect(() => buildCycleIGateEvidence({
      reportDigest: ref("1"), populationDigest: run.protocol.populationDigest,
      datasetDigest: run.protocol.corpusDigest, configDigest: ref("4"),
      run: measuredRun, gateArtifacts: {} as never, humanReview: null,
      approvedFullTurnReplay: null,
    })).toThrow(/registered|authorized|productive/i);
  });

  it("keeps the offline runner free of DB, repository, calendar, and booking imports", () => {
    const source = [
      "scripts/eval-conversation-v2-cycle-i.ts",
      "src/application/conversation-v2/corpus-comparison-runner.ts",
      "src/application/conversation-v2/decision-fixture-manifest.ts",
      "src/application/conversation-v2/productive-understanding-arms.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(source).toMatch(/IntentClassifier/);
    expect(source).toMatch(/DentalUnderstandingProvider/);
    expect(source).not.toMatch(/infrastructure\/db|repositories|BookingService|GoogleCalendar/i);
  });
});
