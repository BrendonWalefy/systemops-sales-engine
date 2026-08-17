import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { loadCycleFAcceptanceManifest } from "@/application/corpus/cycle-f-acceptance";
import {
  digestCycleIDecisionSnapshot,
  loadCycleIDecisionFixtureManifest,
} from "@/application/conversation-v2/decision-fixture-manifest";
import {
  runCycleICorpusComparison,
  parseCycleIComparisonRun,
  type CycleIUnderstandingArm,
} from "@/application/conversation-v2/corpus-comparison-runner";
import type { CapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import { runCycleICli } from "../../scripts/eval-conversation-v2-cycle-i";

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

function reads(): CapturedV2TurnReads {
  return {
    version: "captured-v2-turn-reads.v1",
    now: "2026-08-16T12:00:00.000Z",
    gateInput: {
      status: "captured",
      value: { automationEnabled: true, duplicate: false, humanControlled: false, optedOut: false },
    },
    state: { phase: "active", pendingStepId: "pending:scheduling-0003", completedStepIds: [] },
    leadMessage: "O segundo horário",
    history: [],
    policy: {
      priceDisclosureEnabled: true,
      humanEscalationRequired: false,
      schedulingMinimumLeadTimeHours: 2,
      schedulingRequiresEvaluationFirst: false,
    },
    catalog: { status: "captured", value: [] },
    serviceResolutions: [],
    slotSearches: [],
    offeredSlotResolutions: [],
    pendingAppointmentResolutions: [],
  };
}

function approvedWriteReads(): CapturedV2TurnReads {
  return {
    ...reads(),
    now: "2026-08-15T00:00:00.000Z",
    leadMessage: "Quarta às 15h fica ótimo!",
    history: [{
      author: "agent",
      body: "Tenho terça às 10h30, quarta às 15h ou sexta às 11h com a doutora. Qual fica melhor para você?",
    }],
    offeredSlotResolutions: [{
      pendingStepId: "pending:scheduling-0003",
      ordinal: 2,
      date: "quarta",
      time: "15h",
      result: {
        id: "slot-2",
        label: "quarta às 15h",
        evidenceRef: "fixture:scheduling-0003:slot-2",
      },
    }],
  };
}

function approvedReadReads(): CapturedV2TurnReads {
  const corpusCase = loadCorpus(corpusRoot).cases.find(
    (entry) => entry.caseId === "availability-0001",
  )!;
  return {
    version: "captured-v2-turn-reads.v1",
    now: corpusCase.source.capturedAt,
    gateInput: {
      status: "captured",
      value: {
        automationEnabled: true,
        duplicate: false,
        humanControlled: false,
        optedOut: false,
      },
    },
    state: { phase: "active", pendingStepId: null, completedStepIds: [] },
    leadMessage: corpusCase.input.leadMessage,
    history: corpusCase.input.history.map((entry) => ({
      author: entry.author === "lead" ? "lead" : "agent",
      body: entry.body,
    })),
    policy: {
      priceDisclosureEnabled: true,
      humanEscalationRequired: false,
      schedulingMinimumLeadTimeHours: 2,
      schedulingRequiresEvaluationFirst: false,
    },
    catalog: { status: "captured", value: [] },
    serviceResolutions: [],
    slotSearches: [{
      input: {
        service: null,
        date: "amanhã",
        period: "manhã",
        minimumLeadTimeHours: 2,
        now: corpusCase.source.capturedAt,
      },
      result: {
        service: { id: "evaluation", name: "Avaliação" },
        slots: [{
          id: "slot-availability-0001",
          label: "amanhã de manhã",
          evidenceRef: "fixture:availability-0001:slot",
        }],
      },
    }],
    offeredSlotResolutions: [],
    pendingAppointmentResolutions: [],
  };
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
    expect(v1Calls).toHaveLength(102);
    expect(v2Calls).toHaveLength(102);
    expect(v2Calls).toEqual(v1Calls);
    for (let index = 0; index < result.observations.length; index += 2) {
      const v1 = result.observations[index]!;
      const v2 = result.observations[index + 1]!;
      expect(v1).toMatchObject({ arm: "v1", status: "observed" });
      expect(v2).toMatchObject({ arm: "v2", status: "observed", run: v1.run, caseId: v1.caseId });
      expect(v2.inputDigest).toBe(v1.inputDigest);
    }
    expect(result.analysis.stablePrimary.caseCount).toBe(17);
    expect(result.analysis.stablePrimary.observationCount).toBe(204);
    expect(result.analysis.d0Sensitivity).toMatchObject({ caseCount: 0, observationCount: 0 });
    expect(result.decision).toMatchObject({ status: "not_measurable", approvedEvalRecords: [] });
    expect(result.prose).toEqual({ status: "not_measurable", approvedEvalRecords: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.observations)).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(loadCorpus(corpusRoot).cases[0]!.input.leadMessage);
    expect(serialized).not.toContain(loadCorpus(corpusRoot).cases[0]!.input.history[0]!.body);
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
    const runManifestPath = join(directory, "run-manifest.json");
    writeFileSync(runManifestPath, `${JSON.stringify({
      version: "conversation-v2-cycle-i-run-manifest.v1",
      implementationBaseCommit: "9899fb8b91af17eda23ed65a50db5811ed402d85",
      corpusRoot,
      manifestPath,
      d0Path,
      decisionFixtureManifestPath: null,
      runs: 6,
      v1ModelId: "gpt-4o-mini",
      v2ModelId: "gpt-4o-mini",
      configDigest: `hmac:${"4".repeat(64)}`,
      judge: "experimental_non_gating",
      evidence: {
        hEntailment: `hmac:${"5".repeat(64)}`,
        shadowNoEffects: `hmac:${"6".repeat(64)}`,
        cycleFAxes: `hmac:${"7".repeat(64)}`,
        rollback: `hmac:${"8".repeat(64)}`,
        observability: `hmac:${"9".repeat(64)}`,
      },
      fullTurnEvidence: null,
    })}\n`, "utf8");

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
    ], {})).rejects.toThrow(/approved.*unavailable|no human sheet/i);
    expect(existsSync(humanSheetPath)).toBe(false);
  });

  it("rejects altered snapshot digests and approval-free decision fixtures", () => {
    const snapshot = reads();
    const valid = {
      version: "conversation-v2-decision-fixtures.v1",
      fixtures: [{
        caseId: "scheduling-0003",
        snapshotDigest: digestCycleIDecisionSnapshot(snapshot),
        reads: snapshot,
        executionReceipt: null,
        approval: { source: "committed_fixture", digest: `hmac:${"a".repeat(64)}` },
      }],
    };

    expect(() => loadCycleIDecisionFixtureManifest(fixtureFile({
      ...valid,
      fixtures: [{ ...valid.fixtures[0], snapshotDigest: `hmac:${"b".repeat(64)}` }],
    }))).toThrow(/snapshot.*digest/i);
    expect(() => loadCycleIDecisionFixtureManifest(fixtureFile({
      ...valid,
      fixtures: [{ ...valid.fixtures[0], approval: undefined }],
    }))).toThrow(/approval|fixture/i);
  });

  it("keeps Decision not measurable when a write case has no execution receipt", async () => {
    const snapshot = approvedWriteReads();
    const path = fixtureFile({
      version: "conversation-v2-decision-fixtures.v1",
      fixtures: [{
        caseId: "scheduling-0003",
        snapshotDigest: digestCycleIDecisionSnapshot(snapshot),
        reads: snapshot,
        executionReceipt: null,
        approval: { source: "committed_fixture", digest: `hmac:${"a".repeat(64)}` },
      }],
    });
    const result = await baseRun(arm([]), arm([]), path);

    expect(result.decision.status).toBe("not_measurable");
    if (result.decision.status !== "not_measurable") throw new Error("unexpected measured Decision");
    expect(result.decision.reasons).toContain("missing_execution_receipt:scheduling-0003");
    expect(result.decision.approvedEvalRecords).toEqual([]);
  });

  it("measures a read-only Decision from the real pipeline and captured read result", async () => {
    const snapshot = approvedReadReads();
    const path = fixtureFile({
      version: "conversation-v2-decision-fixtures.v1",
      fixtures: [{
        caseId: "availability-0001",
        snapshotDigest: digestCycleIDecisionSnapshot(snapshot),
        reads: snapshot,
        executionReceipt: null,
        approval: { source: "committed_fixture", digest: `hmac:${"a".repeat(64)}` },
      }],
    });
    const result = await baseRun(arm([]), arm([]), path);

    expect(result.decision).toMatchObject({
      status: "measured",
      caseCount: 1,
      matches: 1,
      criticalRegressionCount: 0,
    });
    expect(result.decision.approvedEvalRecords).toEqual([]);
  });

  it("rejects a receipt outcome that does not match the real intended write effect", async () => {
    const snapshot = approvedWriteReads();
    const path = fixtureFile({
      version: "conversation-v2-decision-fixtures.v1",
      fixtures: [{
        caseId: "scheduling-0003",
        snapshotDigest: digestCycleIDecisionSnapshot(snapshot),
        reads: snapshot,
        executionReceipt: {
          outcomeType: "appointment_confirmed",
          evidenceDigest: `hmac:${"c".repeat(64)}`,
        },
        approval: { source: "committed_fixture", digest: `hmac:${"a".repeat(64)}` },
      }],
    });
    const result = await baseRun(arm([]), arm([]), path);

    expect(result.decision).toMatchObject({
      status: "not_measurable",
      reasons: ["receipt_outcome_mismatch:scheduling-0003"],
    });
    expect(result.decision.approvedEvalRecords).toEqual([]);
  });
});
