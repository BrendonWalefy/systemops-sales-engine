import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCycleIGateReport, CYCLE_I_GATE_REPORT_VERSION, parseCycleIGateReport, serializeCycleIGateReportAuthorityPayload, type CycleIGateReport } from "@/application/conversation-v2/gate-report";
import { CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN } from "@/application/conversation-v2/configured-cycle-i-authority";

const ref = (tail: string): `hmac:${string}` => `hmac:${"a".repeat(63)}${tail}`;
const base = { reportDigest: ref("1"), populationDigest: ref("2"), datasetDigest: ref("3"), configDigest: ref("4") };
const authorityKey = "cycle-i-authority-key-with-at-least-32-characters";
const gateAuthority = generateKeyPairSync("ed25519");
const approvalAuthority = generateKeyPairSync("ed25519");
process.env.CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY = gateAuthority.publicKey
  .export({ type: "spki", format: "pem" }).toString();
process.env.CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY = approvalAuthority.publicKey
  .export({ type: "spki", format: "pem" }).toString();
function seal(report: CycleIGateReport): CycleIGateReport {
  const withDigest = {
    ...report,
    reportDigest: `hmac:${createHmac("sha256", authorityKey)
      .update(serializeCycleIGateReportAuthorityPayload(report)).digest("hex")}`,
  } as CycleIGateReport;
  return {
    ...withDigest,
    authoritySignature: `ed25519:${sign(
      null,
      Buffer.from(`${CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN}\0${serializeCycleIGateReportAuthorityPayload(withDigest)}`),
      gateAuthority.privateKey,
    ).toString("hex")}`,
  };
}

describe("Cycle I activation gate", () => {
  it("converts missing measurements to not_measurable and never emits GO when a blocker is not pass", () => {
    const report = buildCycleIGateReport(base);
    expect(report.version).toBe(CYCLE_I_GATE_REPORT_VERSION);
    expect(report.decision).toBe("NO_GO");
    expect(Object.values(report.criteria).some((item) => item.status === "not_measurable")).toBe(true);
  });

  it("rejects altered immutable applicability and a forged GO", () => {
    const report = buildCycleIGateReport(base);
    expect(() => parseCycleIGateReport(seal({ ...report, decision: "GO" }))).toThrow(/GO|block|rederive/i);
    expect(() => parseCycleIGateReport(seal({ ...report, criteria: { ...report.criteria, protocol_integrity: { ...report.criteria.protocol_integrity, denominator: 1 } } }))).toThrow(/denominator|applicability|rederive/i);
  });

  it("derives gates from measured evidence and rejects evidence-free or threshold-forged GO", () => {
    const allPassWithoutEvidence = buildCycleIGateReport({ ...base, measurements: {
      h_entailment: { passed: true }, shadow_no_effects: { sideEffects: 0, contamination: 0 }, protocol_integrity: { completedObservations: 204 }, supported_understanding: { v1Correct: 10, v2Correct: 10, cycleFAxesPassed: true, criticalRegressionCount: 0 }, supported_decision: { matches: 1 }, critical_regressions: { count: 0 }, qualitative: { completed: true, factuallyCorrect: { v1: 1, v2: 1 }, addressedWhatTheLeadRaised: { v1: 1, v2: 1 }, advancedTheJourney: { v1: 1, v2: 1 }, wouldRepeatToday: { v1: 1, v2: 1 }, criticalFactuallyIncorrectCount: 0 }, full_turn_cost: { v1MeanMinor: 1, v2MeanMinor: 1 }, full_turn_p95: { v1P95Ms: 1, v2P95Ms: 1 }, rollback: { passed: true }, observability: { passed: true }, verification: { passed: true }, adversarial_review: { passed: true },
    } as never });
    expect(allPassWithoutEvidence.decision).toBe("NO_GO");
    const evidence = (denominator: number) => ({ evidenceDigest: ref("5"), populationDigest: ref("2"), datasetDigest: ref("3"), configDigest: ref("4"), denominator });
    const passing = buildCycleIGateReport({ ...base, measurements: {
      h_entailment: { ...evidence(1), passed: true }, shadow_no_effects: { ...evidence(1), sideEffects: 0, contamination: 0 }, protocol_integrity: { ...evidence(204), completedObservations: 204 }, supported_understanding: { ...evidence(90), v1Correct: 10, v2Correct: 10, cycleFAxesPassed: true, criticalRegressionCount: 0 }, supported_decision: { ...evidence(1), matches: 1 }, critical_regressions: { ...evidence(180), count: 0 }, qualitative: { ...evidence(1), completed: true, factuallyCorrect: { v1: 1, v2: 1 }, addressedWhatTheLeadRaised: { v1: 1, v2: 1 }, advancedTheJourney: { v1: 1, v2: 1 }, wouldRepeatToday: { v1: 1, v2: 1 }, criticalFactuallyIncorrectCount: 0 }, full_turn_cost: { ...evidence(1), v1MeanMinor: 1, v2MeanMinor: 1 }, full_turn_p95: { ...evidence(1), v1P95Ms: 1, v2P95Ms: 1 }, rollback: { ...evidence(1), passed: true }, observability: { ...evidence(1), passed: true }, verification: { ...evidence(1), passed: true }, adversarial_review: { ...evidence(1), passed: true },
    } });
    expect(passing.decision).toBe("GO");
    expect(buildCycleIGateReport({ ...base, measurements: { supported_understanding: { ...evidence(90), v1Correct: 9, v2Correct: 8, cycleFAxesPassed: true, criticalRegressionCount: 0 } } }).criteria.supported_understanding.status).toBe("fail");
    expect(() => parseCycleIGateReport(seal({ ...passing, criteria: Object.fromEntries(Object.entries(passing.criteria).map(([key, value]) => [key, { ...value, status: "pass", evidenceDigest: ref("9") }])) } as CycleIGateReport))).toThrow(/measurement|rederive|evidence/i);
    expect(() => parseCycleIGateReport(seal({ ...passing, measurements: undefined } as never))).toThrow();
  });

  it("binds reportDigest to the complete canonically rederived report", () => {
    const original = seal(buildCycleIGateReport(base));
    expect(parseCycleIGateReport(JSON.parse(JSON.stringify(original))).reportDigest)
      .toBe(original.reportDigest);
    const changed = { ...original, reportDigest: ref("9") };
    expect(() => parseCycleIGateReport(changed)).toThrow(/authority|signature|digest/i);
  });
});
