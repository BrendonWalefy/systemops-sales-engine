import { describe, expect, it } from "vitest";
import {
  isRegisteredInternalV2ActivationApproval,
  parseInternalV2ActivationApproval,
} from "@/application/conversation-v2/activation-approval";
import {
  buildCycleIGateReport,
  parseCycleIGateReport,
} from "@/application/conversation-v2/gate-report";
import { resolveConversationEngine } from "@/application/conversation-v2/engine-selection";

const ref = (tail: string): `hmac:${string}` => `hmac:${"a".repeat(63)}${tail}`;
const digests = {
  reportDigest: ref("1"),
  populationDigest: ref("2"),
  datasetDigest: ref("3"),
  configDigest: ref("4"),
};
const evidence = (denominator: number) => ({
  evidenceDigest: ref("5"),
  populationDigest: digests.populationDigest,
  datasetDigest: digests.datasetDigest,
  configDigest: digests.configDigest,
  denominator,
});

function passingReport() {
  return buildCycleIGateReport({ ...digests, measurements: {
    h_entailment: { ...evidence(1), passed: true },
    shadow_no_effects: { ...evidence(1), sideEffects: 0, contamination: 0 },
    protocol_integrity: { ...evidence(204), completedObservations: 204 },
    supported_understanding: { ...evidence(102), v1Correct: 10, v2Correct: 10, cycleFAxesPassed: true, criticalRegressionCount: 0 },
    supported_decision: { ...evidence(1), matches: 1 },
    critical_regressions: { ...evidence(204), count: 0 },
    qualitative: { ...evidence(1), completed: true, factuallyCorrect: { v1: 1, v2: 1 }, addressedWhatTheLeadRaised: { v1: 1, v2: 1 }, advancedTheJourney: { v1: 1, v2: 1 }, wouldRepeatToday: { v1: 1, v2: 1 }, criticalFactuallyIncorrectCount: 0 },
    full_turn_cost: { ...evidence(1), v1MeanMinor: 1, v2MeanMinor: 1 },
    full_turn_p95: { ...evidence(1), v1P95Ms: 1, v2P95Ms: 1 },
    rollback: { ...evidence(1), passed: true },
    observability: { ...evidence(1), passed: true },
    verification: { ...evidence(1), passed: true },
    adversarial_review: { ...evidence(1), passed: true },
  } });
}

const expected = {
  commit: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
  ...digests,
  approvalRecord: {
    version: "conversation-v2-internal-activation-approval.v1",
    decision: "approved",
    approvedBy: "systemops_owner",
    approvedAt: "2026-08-16T12:00:00.000Z",
    commit: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
    ...digests,
  },
} as const;

describe("Cycle I internal activation approval", () => {
  it("accepts only a report produced by the canonical runtime parser and exact approval record", () => {
    const built = passingReport();
    expect(built.decision).toBe("GO");
    expect(() => parseInternalV2ActivationApproval(built, expected)).toThrow(/registered/i);

    const parsed = parseCycleIGateReport(JSON.parse(JSON.stringify(built)));
    const approval = parseInternalV2ActivationApproval(parsed, expected);
    expect(isRegisteredInternalV2ActivationApproval(approval)).toBe(true);
    expect(Object.isFrozen(approval)).toBe(true);
    expect(resolveConversationEngine({
      automationMode: "live",
      policy: { clinicId: "clinic-1", engine: "v2_internal", isTest: true },
      approval,
    })).toEqual({
      route: "v1",
      shadow: false,
      reason: "v2_internal_runtime_unavailable",
    });
  });

  it.each([
    ["build", { ...expected, commit: "deadbee" }],
    ["report digest", { ...expected, reportDigest: ref("9") }],
    ["dataset digest", { ...expected, datasetDigest: ref("9") }],
    ["config digest", { ...expected, configDigest: ref("9") }],
    ["population digest", { ...expected, populationDigest: ref("9") }],
    ["approval unknown key", { ...expected, approvalRecord: { ...expected.approvalRecord, note: "trust me" } }],
    ["approval rebuild", { ...expected, approvalRecord: { ...expected.approvalRecord, commit: "deadbee" } }],
  ])("rejects mismatched or open %s authority", (_label, wrong) => {
    const parsed = parseCycleIGateReport(JSON.parse(JSON.stringify(passingReport())));
    expect(() => parseInternalV2ActivationApproval(parsed, wrong as never)).toThrow();
  });

  it("rejects casts, rebuilt approvals and mutation after parsing", () => {
    const parsed = parseCycleIGateReport(JSON.parse(JSON.stringify(passingReport())));
    const approval = parseInternalV2ActivationApproval(parsed, expected);
    expect(isRegisteredInternalV2ActivationApproval({ ...approval } as never)).toBe(false);
    expect(isRegisteredInternalV2ActivationApproval({} as never)).toBe(false);
    expect(() => Object.assign(approval, { commit: "deadbee" })).toThrow();
  });

  it("rejects proxy/accessor expected authority without executing getters", () => {
    const parsed = parseCycleIGateReport(JSON.parse(JSON.stringify(passingReport())));
    let reads = 0;
    const proxied = new Proxy({ ...expected }, {
      get(target, key, receiver) {
        reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(() => parseInternalV2ActivationApproval(parsed, proxied)).toThrow(/approval|expected|invalid/i);
    expect(reads).toBe(0);

    const accessor = { ...expected } as Record<string, unknown>;
    Object.defineProperty(accessor, "commit", {
      enumerable: true,
      get() {
        reads += 1;
        return expected.commit;
      },
    });
    expect(() => parseInternalV2ActivationApproval(parsed, accessor as never)).toThrow(/approval|expected|invalid/i);
    expect(reads).toBe(0);
  });

  it("rejects a registered report whose blocking evidence is not all pass", () => {
    const parsed = parseCycleIGateReport(JSON.parse(JSON.stringify(buildCycleIGateReport(digests))));
    expect(() => parseInternalV2ActivationApproval(parsed, expected)).toThrow(/gate|NO_GO|pass/i);
  });
});
