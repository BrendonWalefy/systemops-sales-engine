import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isRegisteredInternalV2ActivationApproval,
  parseInternalV2ActivationApproval,
} from "@/application/conversation-v2/activation-approval";
import {
  buildCycleIGateReport,
  parseCycleIGateReport,
  serializeCycleIGateReportAuthorityPayload,
  type CycleIGateReport,
} from "@/application/conversation-v2/gate-report";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";
import {
  CONVERSATION_ENGINES,
  resolveConversationEngine,
} from "@/application/conversation-v2/engine-selection";
import { HmacCycleIAuthorityVerifier } from "@/infrastructure/conversation-v2/hmac-cycle-i-authority-verifier";

const ref = (tail: string): HmacRef => `hmac:${"a".repeat(63)}${tail}`;
const authorityKey = "cycle-i-authority-key-with-at-least-32-characters";
const attackerKey = "attacker-controlled-key-with-at-least-32-characters";
const verifier = new HmacCycleIAuthorityVerifier(authorityKey);
const digests = {
  reportDigest: ref("1"), populationDigest: ref("2"),
  datasetDigest: ref("3"), configDigest: ref("4"),
};
const evidence = (denominator: number) => ({
  evidenceDigest: ref("5"), populationDigest: digests.populationDigest,
  datasetDigest: digests.datasetDigest, configDigest: digests.configDigest, denominator,
});

function hmac(payload: string, key = authorityKey): HmacRef {
  return `hmac:${createHmac("sha256", key).update(payload).digest("hex")}`;
}

function passingReport(key = authorityKey): CycleIGateReport {
  const report = buildCycleIGateReport({ ...digests, measurements: {
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
  return Object.freeze({
    ...report,
    reportDigest: hmac(serializeCycleIGateReportAuthorityPayload(report), key),
  });
}

function approvalAuthority(report: CycleIGateReport, key = authorityKey) {
  const expected = {
    commit: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
    reportDigest: report.reportDigest,
    populationDigest: report.populationDigest,
    datasetDigest: report.datasetDigest,
    configDigest: report.configDigest,
  } as const;
  const unsigned = {
    version: "conversation-v2-internal-activation-approval.v1",
    decision: "approved",
    approvedBy: "systemops_owner",
    approvedAt: "2026-08-16T12:00:00.000Z",
    ...expected,
  } as const;
  const payload = JSON.stringify(Object.fromEntries(
    Object.entries(unsigned).sort(([left], [right]) => left.localeCompare(right)),
  ));
  return { expected, approvalRecord: { ...unsigned, signature: hmac(payload, key) } } as const;
}

function parsePassingReport() {
  return parseCycleIGateReport(JSON.parse(JSON.stringify(passingReport())), verifier);
}

describe("Cycle I internal activation approval", () => {
  it("rejects an all-pass report self-declared under an untrusted authority", () => {
    const selfDeclared = passingReport(attackerKey);
    expect(() => parseCycleIGateReport(JSON.parse(JSON.stringify(selfDeclared)), verifier))
      .toThrow(/authority|digest|authentic/i);
  });

  it("accepts only a content-bound report and independently authenticated approval record", () => {
    const built = passingReport();
    const authority = approvalAuthority(built);
    expect(() => parseInternalV2ActivationApproval(
      built, authority.expected, authority.approvalRecord, verifier,
    )).toThrow(/registered/i);

    const parsed = parseCycleIGateReport(JSON.parse(JSON.stringify(built)), verifier);
    const parsedAuthority = approvalAuthority(parsed);
    const approval = parseInternalV2ActivationApproval(
      parsed, parsedAuthority.expected, parsedAuthority.approvalRecord, verifier,
    );
    expect(isRegisteredInternalV2ActivationApproval(approval)).toBe(true);
    expect(Object.isFrozen(approval)).toBe(true);
    expect(resolveConversationEngine({
      automationMode: "live",
      policy: { clinicId: "clinic-1", engine: "v2_internal", isTest: true },
      approval,
    })).toEqual({ route: "v1", shadow: false, reason: "v2_internal_runtime_unavailable" });
  });

  it("uses the registered approval in the full automation×engine×isTest matrix", () => {
    const parsed = parsePassingReport();
    const authority = approvalAuthority(parsed);
    const approval = parseInternalV2ActivationApproval(
      parsed, authority.expected, authority.approvalRecord, verifier,
    );

    for (const automationMode of ["disabled", "observe", "live"] as const) {
      for (const engine of CONVERSATION_ENGINES) {
        for (const isTest of [false, true]) {
          const result = resolveConversationEngine({
            automationMode,
            policy: { clinicId: "clinic-1", engine, isTest },
            approval,
          });
          if (automationMode !== "live") {
            expect(result).toEqual({ route: "v1", shadow: false, reason: "automation_not_live" });
          } else if (engine === "v1") {
            expect(result).toEqual({ route: "v1", shadow: false, reason: "configured_v1" });
          } else if (engine === "v1_with_v2_shadow") {
            expect(result).toEqual({ route: "v1", shadow: true, reason: "configured_shadow" });
          } else {
            expect(result).toEqual({
              route: "v1",
              shadow: false,
              reason: isTest
                ? "v2_internal_runtime_unavailable"
                : "activation_gate_missing",
            });
          }
        }
      }
    }
  });

  it.each(["commit", "reportDigest", "datasetDigest", "configDigest", "populationDigest"] as const)(
    "rejects trusted runtime %s authority that differs from the signed artifacts",
    (field) => {
      const parsed = parsePassingReport();
      const authority = approvalAuthority(parsed);
      const wrongExpected = { ...authority.expected, [field]: field === "commit" ? "deadbee" : ref("9") };
      expect(() => parseInternalV2ActivationApproval(
        parsed, wrongExpected as never, authority.approvalRecord, verifier,
      )).toThrow(/mismatch/i);
    },
  );

  it("rejects unknown fields, altered signatures, and records signed by an attacker", () => {
    for (const alter of [
      (record: Record<string, unknown>) => ({ ...record, note: "trust me" }),
      (record: Record<string, unknown>) => ({ ...record, signature: ref("9") }),
    ]) {
      const parsed = parsePassingReport();
      const authority = approvalAuthority(parsed);
      expect(() => parseInternalV2ActivationApproval(
        parsed, authority.expected, alter(authority.approvalRecord), verifier,
      )).toThrow();
    }
    const parsed = parsePassingReport();
    const attacker = approvalAuthority(parsed, attackerKey);
    expect(() => parseInternalV2ActivationApproval(
      parsed, attacker.expected, attacker.approvalRecord, verifier,
    )).toThrow(/signature|authentic/i);
  });

  it("rejects casts, rebuilt approvals and mutation after parsing", () => {
    const parsed = parsePassingReport();
    const authority = approvalAuthority(parsed);
    const approval = parseInternalV2ActivationApproval(
      parsed, authority.expected, authority.approvalRecord, verifier,
    );
    expect(isRegisteredInternalV2ActivationApproval({ ...approval } as never)).toBe(false);
    expect(isRegisteredInternalV2ActivationApproval({} as never)).toBe(false);
    expect(() => Object.assign(approval, { commit: "deadbee" })).toThrow();
  });

  it("rejects proxy/accessor expected authority without executing getters", () => {
    const parsed = parsePassingReport();
    const authority = approvalAuthority(parsed);
    let reads = 0;
    const proxied = new Proxy({ ...authority.expected }, {
      get(target, key, receiver) { reads += 1; return Reflect.get(target, key, receiver); },
    });
    expect(() => parseInternalV2ActivationApproval(
      parsed, proxied, authority.approvalRecord, verifier,
    )).toThrow(/approval|expected|invalid/i);
    expect(reads).toBe(0);
    const accessor = { ...authority.expected } as Record<string, unknown>;
    Object.defineProperty(accessor, "commit", {
      enumerable: true,
      get() { reads += 1; return authority.expected.commit; },
    });
    expect(() => parseInternalV2ActivationApproval(
      parsed, accessor as never, authority.approvalRecord, verifier,
    )).toThrow(/approval|expected|invalid/i);
    expect(reads).toBe(0);
  });

  it("rejects a registered report whose blocking evidence is not all pass", () => {
    const report = buildCycleIGateReport(digests);
    const signed = { ...report, reportDigest: hmac(serializeCycleIGateReportAuthorityPayload(report)) };
    const parsed = parseCycleIGateReport(JSON.parse(JSON.stringify(signed)), verifier);
    const authority = approvalAuthority(parsed);
    expect(() => parseInternalV2ActivationApproval(
      parsed, authority.expected, authority.approvalRecord, verifier,
    )).toThrow(/gate|NO_GO|pass/i);
  });
});
