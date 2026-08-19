import { describe, expect, it } from "vitest";
import { parseDentalUnderstanding } from "@/domain-packs/dental/understanding";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";
import { DENTAL_UNDERSTANDING_PROMPT } from "@/domain-packs/dental/understanding-prompt";

/**
 * Matriz de cobertura medida contra o modelo real em 2026-08-18: 30 cenários,
 * 30 aprovados. Este teste não chama o modelo — congela o contrato que tornou
 * aquele resultado possível, para que uma regressão apareça no CI em vez de
 * virar turno silencioso em produção.
 */
function reply(request: string, service: string | null) {
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

describe("dental understanding coverage matrix", () => {
  it("accepts every non-transactional turn without a service", () => {
    for (const request of ["greeting", "other"]) {
      expect(() => parseDentalUnderstanding(reply(request, null))).not.toThrow();
    }
  });

  it("keeps the service requirement exactly where the service is the subject", () => {
    for (const request of ["price-of-service", "service-availability"]) {
      expect(() => parseDentalUnderstanding(reply(request, null))).toThrow();
      expect(() => parseDentalUnderstanding(reply(request, "Clareamento dental"))).not.toThrow();
    }
    for (const request of ["book-appointment", "confirm-slot", "confirm-appointment"]) {
      expect(() => parseDentalUnderstanding(reply(request, null))).not.toThrow();
    }
  });

  it("teaches the model the escape hatches instead of forcing a transaction", () => {
    expect(DENTAL_UNDERSTANDING_PROMPT).toContain("greeting");
    expect(DENTAL_UNDERSTANDING_PROMPT).toContain("other");
    expect(DENTAL_UNDERSTANDING_PROMPT).toContain("Never force a transactional concept");
    expect(DENTAL_UNDERSTANDING_PROMPT).toContain("opening hours with no identifiable catalog service");
  });

  it("offers a concept for a turn that names no service at all", () => {
    const withoutService = DENTAL_REQUESTS.filter((request) =>
      request !== "price-of-service" && request !== "service-availability");
    expect(withoutService).toContain("greeting");
    expect(withoutService).toContain("other");
  });
});
