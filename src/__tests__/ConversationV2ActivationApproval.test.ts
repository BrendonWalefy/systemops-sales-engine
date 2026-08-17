import { createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
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
import {
  CYCLE_I_ACTIVATION_APPROVAL_AUTHORITY_DOMAIN,
  CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN,
  createConfiguredCycleIRuntimeBuildIdentity,
} from "@/application/conversation-v2/configured-cycle-i-authority";

const ref = (tail: string): HmacRef => `hmac:${"a".repeat(63)}${tail}`;
const authorityKey = "cycle-i-authority-key-with-at-least-32-characters";
const attackerKey = "attacker-controlled-key-with-at-least-32-characters";
const gateAuthority = generateKeyPairSync("ed25519");
const approvalAuthorityKeyPair = generateKeyPairSync("ed25519");
const attackerGateAuthority = generateKeyPairSync("ed25519");
const attackerApprovalAuthority = generateKeyPairSync("ed25519");
process.env.CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY = gateAuthority.publicKey
  .export({ type: "spki", format: "pem" }).toString();
process.env.CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY = approvalAuthorityKeyPair.publicKey
  .export({ type: "spki", format: "pem" }).toString();
const digests = {
  reportDigest: ref("1"), populationDigest: ref("2"),
  datasetDigest: ref("3"), configDigest: ref("4"),
};
const buildCommit = "e86201adb3b7eb6665629f5e73cbb5964acdc745";

function configureRuntimeIdentity(
  overrides: Partial<typeof digests & { commit: string }> = {},
) {
  process.env.VERCEL_GIT_COMMIT_SHA = overrides.commit ?? buildCommit;
  process.env.CONVERSATION_V2_GATE_REPORT_DIGEST = overrides.reportDigest ?? digests.reportDigest;
  process.env.CONVERSATION_V2_POPULATION_DIGEST = overrides.populationDigest ?? digests.populationDigest;
  process.env.CONVERSATION_V2_DATASET_DIGEST = overrides.datasetDigest ?? digests.datasetDigest;
  process.env.CONVERSATION_V2_CONFIG_DIGEST = overrides.configDigest ?? digests.configDigest;
  return createConfiguredCycleIRuntimeBuildIdentity();
}
const evidence = (denominator: number) => ({
  evidenceDigest: ref("5"), populationDigest: digests.populationDigest,
  datasetDigest: digests.datasetDigest, configDigest: digests.configDigest, denominator,
});

function hmac(payload: string, key = authorityKey): HmacRef {
  return `hmac:${createHmac("sha256", key).update(payload).digest("hex")}`;
}

function authoritySignature(domain: string, payload: string, privateKey: KeyObject): `ed25519:${string}` {
  return `ed25519:${sign(null, Buffer.from(`${domain}\0${payload}`), privateKey).toString("hex")}`;
}

function passingReport(privateKey = gateAuthority.privateKey, digestKey = authorityKey): CycleIGateReport {
  const report = buildCycleIGateReport({ ...digests, measurements: {
    h_entailment: { ...evidence(1), passed: true },
    shadow_no_effects: { ...evidence(1), sideEffects: 0, contamination: 0 },
    protocol_integrity: { ...evidence(204), completedObservations: 204 },
    supported_understanding: { ...evidence(90), v1Correct: 10, v2Correct: 10, cycleFAxesPassed: true, criticalRegressionCount: 0 },
    supported_decision: { ...evidence(1), matches: 1 },
    critical_regressions: { ...evidence(180), count: 0 },
    qualitative: { ...evidence(1), completed: true, factuallyCorrect: { v1: 1, v2: 1 }, addressedWhatTheLeadRaised: { v1: 1, v2: 1 }, advancedTheJourney: { v1: 1, v2: 1 }, wouldRepeatToday: { v1: 1, v2: 1 }, criticalFactuallyIncorrectCount: 0 },
    full_turn_cost: { ...evidence(1), v1MeanMinor: 1, v2MeanMinor: 1 },
    full_turn_p95: { ...evidence(1), v1P95Ms: 1, v2P95Ms: 1 },
    rollback: { ...evidence(1), passed: true },
    observability: { ...evidence(1), passed: true },
    verification: { ...evidence(1), passed: true },
    adversarial_review: { ...evidence(1), passed: true },
  } });
  const withDigest = Object.freeze({
    ...report,
    reportDigest: hmac(serializeCycleIGateReportAuthorityPayload(report), digestKey),
  }) as CycleIGateReport;
  return Object.freeze({
    ...withDigest,
    authoritySignature: authoritySignature(
      CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN,
      serializeCycleIGateReportAuthorityPayload(withDigest),
      privateKey,
    ),
  });
}

function approvalAuthority(
  report: CycleIGateReport,
  privateKey = approvalAuthorityKeyPair.privateKey,
) {
  const expected = {
    commit: buildCommit,
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
  return {
    expected,
    approvalRecord: {
      ...unsigned,
      signature: authoritySignature(
        CYCLE_I_ACTIVATION_APPROVAL_AUTHORITY_DOMAIN,
        payload,
        privateKey,
      ),
    },
  } as const;
}

function parsePassingReport() {
  return parseCycleIGateReport(JSON.parse(JSON.stringify(passingReport())));
}

function runtimeIdentityFor(
  report: CycleIGateReport,
  overrides: Partial<typeof digests & { commit: string }> = {},
) {
  return configureRuntimeIdentity({ reportDigest: report.reportDigest, ...overrides });
}

describe("Cycle I internal activation approval", () => {
  it("does not accept a caller-supplied permissive structural verifier", () => {
    const selfDeclared = passingReport(attackerGateAuthority.privateKey, attackerKey);
    const permissive = {
      verifyGateReport: () => true,
      verifyApprovalRecord: () => true,
    };

    expect(() => (parseCycleIGateReport as unknown as (...args: unknown[]) => unknown)(
      JSON.parse(JSON.stringify(selfDeclared)),
      permissive,
    )).toThrow(/authority|trusted|signature|config/i);
  });

  it("rejects an all-pass report self-declared under an untrusted authority", () => {
    const selfDeclared = passingReport(attackerGateAuthority.privateKey, attackerKey);
    expect(() => parseCycleIGateReport(JSON.parse(JSON.stringify(selfDeclared))))
      .toThrow(/authority|digest|authentic/i);
  });

  it("accepts only a content-bound report and independently authenticated approval record", () => {
    const built = passingReport();
    const authority = approvalAuthority(built);
    const runtimeIdentity = runtimeIdentityFor(built);
    expect(() => parseInternalV2ActivationApproval(
      built, runtimeIdentity, authority.approvalRecord,
    )).toThrow(/registered/i);

    const parsed = parseCycleIGateReport(JSON.parse(JSON.stringify(built)));
    const parsedAuthority = approvalAuthority(parsed);
    const approval = parseInternalV2ActivationApproval(
      parsed, runtimeIdentity, parsedAuthority.approvalRecord,
    );
    expect(isRegisteredInternalV2ActivationApproval(approval, runtimeIdentity)).toBe(true);
    expect(Object.isFrozen(approval)).toBe(true);
    expect(resolveConversationEngine({
      automationMode: "live",
      policy: { clinicId: "clinic-1", engine: "v2_internal", isTest: true },
      approval,
      runtimeIdentity,
    })).toEqual({ route: "v1", shadow: false, reason: "v2_internal_runtime_unavailable" });
  });

  it("uses the registered approval in the full automation×engine×isTest matrix", () => {
    const parsed = parsePassingReport();
    const authority = approvalAuthority(parsed);
    const runtimeIdentity = runtimeIdentityFor(parsed);
    const approval = parseInternalV2ActivationApproval(
      parsed, runtimeIdentity, authority.approvalRecord,
    );

    for (const automationMode of ["disabled", "observe", "live"] as const) {
      for (const engine of CONVERSATION_ENGINES) {
        for (const isTest of [false, true]) {
          const result = resolveConversationEngine({
            automationMode,
            policy: { clinicId: "clinic-1", engine, isTest },
            approval,
            runtimeIdentity,
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

  it("binds an approval to the current registered runtime build identity", () => {
    const parsed = parsePassingReport();
    const authority = approvalAuthority(parsed);
    const runtimeA = runtimeIdentityFor(parsed);
    const approval = parseInternalV2ActivationApproval(parsed, runtimeA, authority.approvalRecord);
    const runtimeB = runtimeIdentityFor(parsed, { configDigest: ref("9") });

    expect(() => parseInternalV2ActivationApproval(
      parsed,
      runtimeB,
      authority.approvalRecord,
    )).toThrow(/configDigest|runtime|mismatch/i);
    expect(resolveConversationEngine({
      automationMode: "live",
      policy: { clinicId: "clinic-1", engine: "v2_internal", isTest: true },
      approval,
      runtimeIdentity: runtimeB,
    })).toEqual({ route: "v1", shadow: false, reason: "activation_gate_missing" });
    runtimeIdentityFor(parsed);
  });

  it.each(["commit", "reportDigest", "populationDigest", "datasetDigest", "configDigest"] as const)(
    "rejects a signed artifact whose %s differs from the registered runtime identity",
    (field) => {
      const parsed = parsePassingReport();
      const authority = approvalAuthority(parsed);
      const runtimeIdentity = runtimeIdentityFor(parsed, {
        [field]: field === "commit" ? "deadbee" : ref("9"),
      });

      expect(() => parseInternalV2ActivationApproval(
        parsed,
        runtimeIdentity,
        authority.approvalRecord,
      )).toThrow(new RegExp(`${field}|mismatch`, "i"));
      runtimeIdentityFor(parsed);
    },
  );

  it("rejects unknown fields, altered signatures, and records signed by an attacker", () => {
    for (const alter of [
      (record: Record<string, unknown>) => ({ ...record, note: "trust me" }),
      (record: Record<string, unknown>) => ({ ...record, signature: ref("9") }),
    ]) {
      const parsed = parsePassingReport();
      const authority = approvalAuthority(parsed);
      const runtimeIdentity = runtimeIdentityFor(parsed);
      expect(() => parseInternalV2ActivationApproval(
        parsed, runtimeIdentity, alter(authority.approvalRecord),
      )).toThrow();
    }
    const parsed = parsePassingReport();
    const attacker = approvalAuthority(parsed, attackerApprovalAuthority.privateKey);
    const runtimeIdentity = runtimeIdentityFor(parsed);
    expect(() => parseInternalV2ActivationApproval(
      parsed, runtimeIdentity, attacker.approvalRecord,
    )).toThrow(/signature|authentic/i);
  });

  it("rejects casts, rebuilt approvals and mutation after parsing", () => {
    const parsed = parsePassingReport();
    const authority = approvalAuthority(parsed);
    const runtimeIdentity = runtimeIdentityFor(parsed);
    const approval = parseInternalV2ActivationApproval(
      parsed, runtimeIdentity, authority.approvalRecord,
    );
    expect(isRegisteredInternalV2ActivationApproval({ ...approval } as never, runtimeIdentity)).toBe(false);
    expect(isRegisteredInternalV2ActivationApproval({} as never, runtimeIdentity)).toBe(false);
    expect(() => Object.assign(approval, { commit: "deadbee" })).toThrow();
  });

  it("rejects rebuilt/cast runtime identities", () => {
    const parsed = parsePassingReport();
    const authority = approvalAuthority(parsed);
    const runtimeIdentity = runtimeIdentityFor(parsed);
    expect(() => parseInternalV2ActivationApproval(
      parsed, { ...runtimeIdentity } as never, authority.approvalRecord,
    )).toThrow(/runtime|identity|registered/i);
    expect(() => parseInternalV2ActivationApproval(
      parsed, {} as never, authority.approvalRecord,
    )).toThrow(/runtime|identity|registered/i);
  });

  it("rejects a registered report whose blocking evidence is not all pass", () => {
    const report = buildCycleIGateReport(digests);
    const withDigest = {
      ...report,
      reportDigest: hmac(serializeCycleIGateReportAuthorityPayload(report)),
    } as CycleIGateReport;
    const signed = {
      ...withDigest,
      authoritySignature: authoritySignature(
        CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN,
        serializeCycleIGateReportAuthorityPayload(withDigest),
        gateAuthority.privateKey,
      ),
    };
    const parsed = parseCycleIGateReport(JSON.parse(JSON.stringify(signed)));
    const authority = approvalAuthority(parsed);
    const runtimeIdentity = runtimeIdentityFor(parsed);
    expect(() => parseInternalV2ActivationApproval(
      parsed, runtimeIdentity, authority.approvalRecord,
    )).toThrow(/gate|NO_GO|pass/i);
  });
});
