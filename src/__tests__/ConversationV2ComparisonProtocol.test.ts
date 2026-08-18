import { describe, expect, it } from "vitest";
import { createCycleIProtocol, validateProtocolObservations } from "@/application/conversation-v2/comparison-protocol";

const manifest = { version: "cycle-f-dental.v1", population: "cycle-f-supported-dental-corpus", cases: Array.from({ length: 17 }, (_, i) => ({ caseId: `price-${String(i + 1).padStart(4, "0")}`, requiredAxes: ["request"], critical: i === 0 })), exclusions: [{ requests: ["unsupported"], reason: "outside" }] };
const d0 = { unstableAcrossRuns: ["price-0001"] };
const ref = (tail: string): `hmac:${string}` => `hmac:${"a".repeat(63)}${tail}`;
const input = { manifest, d0, corpusDigest: ref("1"), d0Digest: ref("2"), populationDigest: ref("3") };

describe("Cycle I protocol", () => {
  it("freezes exactly 17 cases, six runs, and adjacent interleaved pairs", () => {
    const protocol = createCycleIProtocol(input);
    expect(protocol.runs).toBe(6);
    expect(protocol.cases).toHaveLength(17);
    expect(protocol.order).toHaveLength(204);
    for (let i = 0; i < protocol.order.length; i += 2) {
      expect(protocol.order[i]).toMatchObject({ arm: "v1" });
      expect(protocol.order[i + 1]).toMatchObject({ arm: "v2", caseId: protocol.order[i]!.caseId, run: protocol.order[i]!.run });
    }
    expect(Object.isFrozen(protocol.order)).toBe(true);
    expect(protocol.corpusDigest).toBe(ref("1"));
    expect(protocol.d0Digest).toBe(ref("2"));
  });

  it("rejects a protocol that changes N or its pre-observation D0 intersection", () => {
    expect(() => createCycleIProtocol({ ...input, runs: 5 })).toThrow(/6/);
    expect(() => createCycleIProtocol({ manifest: { ...manifest, cases: manifest.cases.slice(1) }, d0, corpusDigest: ref("1"), d0Digest: ref("2"), populationDigest: ref("3") })).toThrow(/17/);
  });

  it("requires every scheduled arm and preserves infrastructure errors", () => {
    const protocol = createCycleIProtocol(input);
    const observations = protocol.order.map((entry) => ({ ...entry, stratum: protocol.cases.find((item) => item.caseId === entry.caseId)!.stratum, status: "observed" as const, payloadDigest: ref("4"), corpusDigest: protocol.corpusDigest, d0Digest: protocol.d0Digest, populationDigest: protocol.populationDigest }));
    expect(() => validateProtocolObservations(protocol, observations.slice(1))).toThrow(/missing/i);
    expect(() => validateProtocolObservations(protocol, [...observations, observations[0]!])).toThrow(/duplicate/i);
    expect(() => validateProtocolObservations(protocol, observations.map((item, i) => i === 0 ? { ...item, status: "infrastructure_error" as const } : item))).toThrow(/infrastructure/i);
    expect(() => validateProtocolObservations(protocol, [observations[1]!, observations[0]!, ...observations.slice(2)])).toThrow(/order/i);
    expect(() => validateProtocolObservations(protocol, observations.map((item, i) => i === 0 ? { ...item, run: 7 as 1 } : item))).toThrow(/run|union/i);
    expect(() => validateProtocolObservations(protocol, observations.map((item, i) => i === 0 ? { ...item, stratum: "stable_primary" as const } : item))).toThrow(/stratum/i);
    expect(() => validateProtocolObservations(protocol, observations.map((item, i) => i === 0 ? { ...item, d0Digest: ref("9") } : item))).toThrow(/digest/i);
  });
});
