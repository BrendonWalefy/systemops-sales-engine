import { describe, expect, it } from "vitest";
import { buildCycleIGateReport, CYCLE_I_GATE_REPORT_VERSION, parseCycleIGateReport } from "@/application/conversation-v2/gate-report";

describe("Cycle I activation gate", () => {
  it("converts missing measurements to not_measurable and never emits GO when a blocker is not pass", () => {
    const report = buildCycleIGateReport({ reportDigest: "hmac:" + "a".repeat(64), criteria: {} });
    expect(report.version).toBe(CYCLE_I_GATE_REPORT_VERSION);
    expect(report.decision).toBe("NO_GO");
    expect(Object.values(report.criteria).some((item) => item.status === "not_measurable")).toBe(true);
  });

  it("rejects altered immutable applicability and a forged GO", () => {
    const report = buildCycleIGateReport({ reportDigest: "hmac:" + "a".repeat(64), criteria: {} });
    expect(() => parseCycleIGateReport({ ...report, decision: "GO" })).toThrow(/GO|block/i);
    expect(() => parseCycleIGateReport({ ...report, criteria: { ...report.criteria, protocol_integrity: { ...report.criteria.protocol_integrity, denominator: 1 } } })).toThrow(/denominator|applicability/i);
  });
});
