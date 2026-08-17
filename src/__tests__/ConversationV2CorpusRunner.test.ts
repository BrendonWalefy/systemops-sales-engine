import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { loadCycleFAcceptanceManifest } from "@/application/corpus/cycle-f-acceptance";
import {
  runCycleICorpusComparison,
  parseCycleIComparisonRun,
  type CycleIUnderstandingArm,
} from "@/application/conversation-v2/corpus-comparison-runner";
import { runCycleICli } from "../../scripts/eval-conversation-v2-cycle-i";
import { digestCycleIRunManifest } from "@/application/conversation-v2/run-manifest-authority";

const corpusRoot = "evals/corpus";
const manifestPath = "evals/understanding/cycle-f-dental.json";
const d0Path = "evals/corpus/measurement-stability-d0.json";
const model = Object.freeze({
  modelId: "deterministic-test",
  calls: 1,
  inputTokens: null,
  outputTokens: null,
  latencyMs: 0,
  estimatedCostMinor: null,
});

function fixedClockByCase(): Readonly<Record<string, string>> {
  const corpus = loadCorpus(corpusRoot);
  const byId = new Map(corpus.cases.map((entry) => [entry.caseId, entry]));
  const manifest = loadCycleFAcceptanceManifest(manifestPath, corpusRoot);
  return Object.freeze(Object.fromEntries(
    manifest.cases.map(({ caseId }) => [caseId, byId.get(caseId)!.source.capturedAt]),
  ));
}

function arm(
  calls: Array<Readonly<{
    caseId: string;
    leadMessage: string;
    history: readonly Readonly<{ author: "lead" | "agent" | "operator"; body: string }>[];
    fixedNow: string;
    hasPendingSlotOffer: boolean;
  }>>,
  failCaseId?: string,
): CycleIUnderstandingArm {
  return Object.freeze({
    async runCase(input) {
      calls.push(input);
      if (input.caseId === failCaseId) throw new Error("provider unavailable: do not persist this text");
      return Object.freeze({ request: "price-of-service", model });
    },
  });
}

function baseRun(v1: CycleIUnderstandingArm, v2: CycleIUnderstandingArm, decisionFixtureManifestPath: string | null = null) {
  return runCycleICorpusComparison({
    corpusRoot,
    manifestPath,
    d0Path,
    decisionFixtureManifestPath,
    v1Understanding: v1,
    v2Understanding: v2,
    runs: 6,
    fixedClockByCase: fixedClockByCase(),
  });
}

function fixtureFile(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "cycle-i-decision-fixture-"));
  const path = join(directory, "manifest.json");
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

describe("Cycle I corpus comparison runner", () => {
  it("runs the frozen 17×6×2 population in adjacent V1→V2 pairs over identical inputs", async () => {
    const v1Calls: Parameters<typeof arm>[0] = [];
    const v2Calls: Parameters<typeof arm>[0] = [];
    const result = await baseRun(arm(v1Calls), arm(v2Calls));

    expect(result.status).toBe("complete");
    expect(result.observations).toHaveLength(204);
    expect(v1Calls).toHaveLength(90);
    expect(v2Calls).toHaveLength(90);
    expect(v2Calls).toEqual(v1Calls);
    expect(v1Calls.every((call) => call.hasPendingSlotOffer === false)).toBe(true);
    expect(v1Calls.some((call) => ["scheduling-0003", "burst-0002"].includes(call.caseId))).toBe(false);
    for (let index = 0; index < result.observations.length; index += 2) {
      const v1 = result.observations[index]!;
      const v2 = result.observations[index + 1]!;
      const comparable = !["scheduling-0003", "burst-0002"].includes(v1.caseId);
      expect(v1).toMatchObject({
        arm: "v1",
        status: comparable ? "observed" : "not_measurable",
      });
      expect(v2).toMatchObject({
        arm: "v2",
        status: comparable ? "observed" : "not_measurable",
        run: v1.run,
        caseId: v1.caseId,
      });
      expect(v2.inputDigest).toBe(v1.inputDigest);
    }
    expect(result.analysis.stablePrimary.caseCount).toBe(17);
    expect(result.analysis.stablePrimary.observationCount).toBe(180);
    expect(result.analysis.d0Sensitivity).toMatchObject({ caseCount: 0, observationCount: 0 });
    expect(result.decision).toMatchObject({ status: "not_measurable", approvedEvalRecords: [] });
    expect(result.prose).toEqual({ status: "not_measurable", approvedEvalRecords: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.observations)).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(loadCorpus(corpusRoot).cases[0]!.input.leadMessage);
    expect(serialized).not.toContain(loadCorpus(corpusRoot).cases[0]!.input.history[0]!.body);
  });

  it("rejects getter/proxy fixed clocks before either arm is called", async () => {
    const v1Calls: Parameters<typeof arm>[0] = [];
    const v2Calls: Parameters<typeof arm>[0] = [];
    const values = fixedClockByCase();
    const withGetter = Object.defineProperty({}, "price-0001", {
      enumerable: true,
      get: () => values["price-0001"],
    });
    for (const [caseId, value] of Object.entries(values)) {
      if (caseId !== "price-0001") Object.defineProperty(withGetter, caseId, { enumerable: true, value });
    }

    await expect(runCycleICorpusComparison({
      corpusRoot, manifestPath, d0Path, decisionFixtureManifestPath: null,
      v1Understanding: arm(v1Calls), v2Understanding: arm(v2Calls), runs: 6,
      fixedClockByCase: withGetter as Readonly<Record<string, string>>,
    })).rejects.toThrow(/plain|clock|accessor/i);
    await expect(runCycleICorpusComparison({
      corpusRoot, manifestPath, d0Path, decisionFixtureManifestPath: null,
      v1Understanding: arm(v1Calls), v2Understanding: arm(v2Calls), runs: 6,
      fixedClockByCase: new Proxy(values, {}) as Readonly<Record<string, string>>,
    })).rejects.toThrow(/plain|clock|proxy/i);
    expect(v1Calls).toEqual([]);
    expect(v2Calls).toEqual([]);
  });

  it("rejects 17/0, 14/3, 16/1, or wrong-ID comparability before either arm is called", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cycle-i-comparability-"));
    const caseIds = loadCycleFAcceptanceManifest(manifestPath, corpusRoot).cases.map((entry) => entry.caseId);
    const variants = [
      new Set<string>(),
      new Set(["scheduling-0003", "burst-0002", "price-0001"]),
      new Set(["scheduling-0003"]),
      new Set(["scheduling-0003", "price-0001"]),
    ];
    for (const [index, nonComparable] of variants.entries()) {
      const comparabilityPath = join(directory, `comparability-${index}.json`);
      writeFileSync(comparabilityPath, `${JSON.stringify({
        version: "conversation-v2-understanding-comparability.v1",
        cases: caseIds.map((caseId) => nonComparable.has(caseId)
          ? { caseId, status: "not_comparable", reason: "structured_pending_state_absent" }
          : { caseId, status: "comparable", hasPendingSlotOffer: false }),
      })}\n`, "utf8");
      const v1Calls: Parameters<typeof arm>[0] = [], v2Calls: Parameters<typeof arm>[0] = [];
      await expect(runCycleICorpusComparison({
        corpusRoot, manifestPath, d0Path, decisionFixtureManifestPath: null,
        v1Understanding: arm(v1Calls), v2Understanding: arm(v2Calls), runs: 6,
        fixedClockByCase: fixedClockByCase(), comparabilityPath,
      })).rejects.toThrow(/15|comparab|scheduling-0003|burst-0002/i);
      expect(v1Calls).toEqual([]);
      expect(v2Calls).toEqual([]);
    }
  });

  it("preserves every scheduled infrastructure error without dropping or borrowing an arm", async () => {
    const result = await baseRun(arm([]), arm([], "injection-0001"));

    expect(result.status).toBe("infrastructure_error");
    expect(result.observations).toHaveLength(204);
    expect(result.observations.filter((entry) => entry.status === "infrastructure_error")).toHaveLength(6);
    expect(result.protocolIntegrity).toEqual({ status: "infrastructure_error", completedObservations: 198 });
    expect(result.observations.some((entry) => "error" in entry)).toBe(false);
  });

  it("is byte-deterministic when the injected arms are deterministic", async () => {
    const first = await baseRun(arm([]), arm([]));
    const second = await baseRun(arm([]), arm([]));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(first)).not.toContain("generatedAt");
    expect(parseCycleIComparisonRun(JSON.parse(JSON.stringify(first)))).toEqual(first);
    expect(() => parseCycleIComparisonRun({ ...first, runDigest: `hmac:${"f".repeat(64)}` }))
      .toThrow(/digest|integrity/i);
  });

  it("fails measure closed without a key and can still emit an unsigned NO-GO evidence report", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cycle-i-cli-"));
    const resultPath = join(directory, "result.json");
    const reportPath = join(directory, "gate-report.json");
    const runManifestPath = "evals/cycle-i/run-manifest.json";

    await expect(runCycleICli([
      "--mode", "measure", "--out", resultPath,
      "--run-manifest", runManifestPath,
    ], {})).rejects.toThrow(/OPENAI_API_KEY/i);
    expect(existsSync(resultPath)).toBe(false);

    await runCycleICli([
      "--mode", "evaluate-gates", "--run", resultPath,
      "--out", reportPath, "--run-manifest", runManifestPath,
    ], {});
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.decision).toBe("NO_GO");
    expect(report.criteria.protocol_integrity.status).toBe("not_measurable");
    expect(report.criteria.supported_understanding.status).toBe("not_measurable");
    expect(report.criteria.full_turn_cost.status).toBe("not_measurable");
    expect(report.criteria.full_turn_p95.status).toBe("not_measurable");
    expect(report.authoritySignature).toBeNull();

    const manifestWithFakeEvidence = JSON.parse(readFileSync(runManifestPath, "utf8"));
    manifestWithFakeEvidence.evidence = {
      hEntailment: `hmac:${"5".repeat(64)}`, shadowNoEffects: `hmac:${"6".repeat(64)}`,
      cycleFAxes: `hmac:${"7".repeat(64)}`, rollback: `hmac:${"8".repeat(64)}`,
      observability: `hmac:${"9".repeat(64)}`,
    };
    manifestWithFakeEvidence.manifestDigest = digestCycleIRunManifest(manifestWithFakeEvidence);
    const fakeEvidenceManifestPath = join(directory, "unsigned-fake-evidence-manifest.json");
    writeFileSync(fakeEvidenceManifestPath, `${JSON.stringify(manifestWithFakeEvidence)}\n`, "utf8");
    await expect(runCycleICli(["--mode", "evaluate-gates", "--out", reportPath, "--run-manifest", fakeEvidenceManifestPath], {}))
      .rejects.toThrow(/evidence|unrecognized|invalid/i);

    const completeRunPath = join(directory, "complete-without-prose.json");
    const humanSheetPath = join(directory, "human-review-sheet.json");
    writeFileSync(
      completeRunPath,
      `${JSON.stringify(await baseRun(arm([]), arm([])))}\n`,
      "utf8",
    );
    await expect(runCycleICli([
      "--mode", "build-human-sheet", "--run", completeRunPath,
      "--out", humanSheetPath, "--run-manifest", runManifestPath,
    ], {})).rejects.toThrow(/unsigned|authority/i);
    expect(existsSync(humanSheetPath)).toBe(false);
  });

  it("does not let a caller-provided HMAC-shaped Decision fixture create authority", async () => {
    const path = fixtureFile({
      version: "conversation-v2-decision-fixtures.v1",
      fixtures: [{ caseId: "availability-0001", snapshotDigest: `hmac:${"a".repeat(64)}` }],
    });
    const result = await baseRun(arm([]), arm([]), path);

    expect(result.decision).toEqual({
      status: "not_measurable",
      reasons: ["productive_decision_authority_absent"],
      approvedEvalRecords: [],
    });
  });
});
