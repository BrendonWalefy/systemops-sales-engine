import { describe, expect, it } from "vitest";
import { createCycleIProtocol, validateProtocolObservations } from "@/application/conversation-v2/comparison-protocol";

const manifest = { version: "cycle-f-dental.v1", population: "cycle-f-supported-dental-corpus", cases: Array.from({ length: 17 }, (_, i) => ({ caseId: `price-${String(i + 1).padStart(4, "0")}`, requiredAxes: ["request"], critical: i === 0 })), exclusions: [{ requests: ["unsupported"], reason: "outside" }] };
const d0 = { unstableAcrossRuns: ["price-0001"] };

describe("Cycle I protocol", () => {
  it("freezes exactly 17 cases, six runs, and adjacent interleaved pairs", () => {
    const protocol = createCycleIProtocol({ manifest, d0, corpusDigest: "hmac:" + "a".repeat(64) });
    expect(protocol.runs).toBe(6);
    expect(protocol.cases).toHaveLength(17);
    expect(protocol.order).toHaveLength(204);
    for (let i = 0; i < protocol.order.length; i += 2) {
      expect(protocol.order[i]).toMatchObject({ arm: "v1" });
      expect(protocol.order[i + 1]).toMatchObject({ arm: "v2", caseId: protocol.order[i]!.caseId, run: protocol.order[i]!.run });
    }
    expect(Object.isFrozen(protocol.order)).toBe(true);
  });

  it("rejects a protocol that changes N or its pre-observation D0 intersection", () => {
    expect(() => createCycleIProtocol({ manifest, d0, corpusDigest: "hmac:" + "a".repeat(64), runs: 5 })).toThrow(/6/);
    expect(() => createCycleIProtocol({ manifest: { ...manifest, cases: manifest.cases.slice(1) }, d0, corpusDigest: "hmac:" + "a".repeat(64) })).toThrow(/17/);
  });

  it("requires every scheduled arm and preserves infrastructure errors", () => {
    const protocol = createCycleIProtocol({ manifest, d0, corpusDigest: "hmac:" + "a".repeat(64) });
    const observations = protocol.order.map((entry) => ({ ...entry, status: "observed" as const, payloadDigest: "hmac:" + "b".repeat(64) }));
    expect(() => validateProtocolObservations(protocol, observations.slice(1))).toThrow(/missing/i);
    expect(() => validateProtocolObservations(protocol, [...observations, observations[0]!])).toThrow(/duplicate/i);
    expect(() => validateProtocolObservations(protocol, observations.map((item, i) => i === 0 ? { ...item, status: "infrastructure_error" as const } : item))).toThrow(/infrastructure/i);
  });
});
