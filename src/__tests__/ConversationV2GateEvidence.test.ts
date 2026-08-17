import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRegisteredCycleIGateReport } from "@/application/conversation-v2/gate-report";
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
  it("passes only evidenced deterministic gates and leaves human/full-turn evidence blocking", async () => {
    const run = await completeRun();
    const report = buildCycleIGateEvidence({
      reportDigest: ref("1"),
      populationDigest: run.protocol.populationDigest,
      datasetDigest: run.protocol.corpusDigest,
      configDigest: ref("4"),
      run,
      evidence: {
        hEntailment: ref("5"),
        shadowNoEffects: ref("6"),
        cycleFAxes: ref("7"),
        rollback: ref("8"),
        observability: ref("9"),
      },
      humanReview: null,
      approvedFullTurnReplay: null,
      verification: null,
      adversarialReview: null,
    });

    expect(report.criteria.h_entailment.status).toBe("pass");
    expect(report.criteria.shadow_no_effects.status).toBe("pass");
    expect(report.criteria.protocol_integrity.status).toBe("pass");
    expect(report.criteria.critical_regressions.status).toBe("pass");
    expect(report.criteria.qualitative.status).toBe("pending_human_review");
    expect(report.criteria.full_turn_cost.status).toBe("not_measurable");
    expect(report.criteria.full_turn_p95.status).toBe("not_measurable");
    expect(report.judge).toBe("experimental_non_gating");
    expect(report.decision).toBe("NO_GO");
    expect(isRegisteredCycleIGateReport(report)).toBe(false);
  });

  it("does not promote an infrastructure-error run or absent Decision fixtures to PASS", async () => {
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
    const report = buildCycleIGateEvidence({
      reportDigest: ref("1"), populationDigest: run.protocol.populationDigest,
      datasetDigest: run.protocol.corpusDigest, configDigest: ref("4"), run,
      evidence: {}, humanReview: null, approvedFullTurnReplay: null,
      verification: null, adversarialReview: null,
    });

    expect(report.criteria.protocol_integrity.status).toBe("not_measurable");
    expect(report.criteria.supported_understanding.status).toBe("not_measurable");
    expect(report.criteria.supported_decision.status).toBe("not_measurable");
    expect(report.decision).toBe("NO_GO");
  });

  it("passes supported Decision only when every approved fixture matches without a critical regression", async () => {
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
    const report = buildCycleIGateEvidence({
      reportDigest: ref("1"), populationDigest: run.protocol.populationDigest,
      datasetDigest: run.protocol.corpusDigest, configDigest: ref("4"),
      run: measuredRun, evidence: {}, humanReview: null,
      approvedFullTurnReplay: null, verification: null, adversarialReview: null,
    });

    expect(report.criteria.supported_decision.status).toBe("pass");
  });

  it("keeps the offline runner free of DB, repository, calendar, and booking imports", () => {
    const source = [
      "scripts/eval-conversation-v2-cycle-i.ts",
      "src/application/conversation-v2/corpus-comparison-runner.ts",
      "src/application/conversation-v2/decision-fixture-manifest.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(source).toMatch(/IntentClassifier/);
    expect(source).toMatch(/DentalUnderstandingProvider/);
    expect(source).not.toMatch(/infrastructure\/db|repositories|BookingService|GoogleCalendar/i);
  });
});
