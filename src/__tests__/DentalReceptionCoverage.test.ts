import { describe, expect, it } from "vitest";
import { parseDentalUnderstanding } from "@/domain-packs/dental/understanding";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";
import { createDentalReceptionCapability } from "@/domain-packs/dental/capabilities";

function understanding(request: string, service: string | null = null) {
  return {
    version: "understanding.v1",
    request,
    dialogueMove: "new_topic",
    entities: { service, date: null, period: null, time: null, serviceCandidates: null, quantity: null, ordinal: null },
    signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
    safety: { optOut: false, requestsHuman: false, emergency: false },
    confidence: 0.9,
    ambiguity: null,
  };
}

describe("dental reception coverage", () => {
  it("covers the opener that every lead actually sends", () => {
    expect(DENTAL_REQUESTS).toContain("greeting");
    expect(DENTAL_REQUESTS).toContain("other");
  });

  it("accepts a greeting without demanding a service", () => {
    expect(() => parseDentalUnderstanding(understanding("greeting"))).not.toThrow();
    expect(() => parseDentalUnderstanding(understanding("other"))).not.toThrow();
  });

  it("still demands a service where a service is the subject", () => {
    expect(() => parseDentalUnderstanding(understanding("price-of-service"))).toThrow();
    expect(() => parseDentalUnderstanding(understanding("service-availability"))).toThrow();
    expect(() => parseDentalUnderstanding(understanding("price-of-service", "Clareamento"))).not.toThrow();
  });

  it("claims the greeting and asks how it can help", async () => {
    const capability = createDentalReceptionCapability();
    const claim = capability.claim(parseDentalUnderstanding(understanding("greeting")) as never, {} as never);
    expect(claim).not.toBeNull();

    const decision = await capability.decide(claim!, {} as never);
    expect(decision).toMatchObject({ kind: "ask" });

    const result = await capability.execute(decision, {} as never);
    expect(result).toMatchObject({
      type: "clarification_required",
      semanticClass: "clarification_required",
      origin: { capabilityId: "dental-reception" },
    });
  });

  it("does not claim a transactional request", () => {
    const capability = createDentalReceptionCapability();
    expect(capability.claim(parseDentalUnderstanding(understanding("price-of-service", "Clareamento")) as never, {} as never))
      .toBeNull();
  });
});
