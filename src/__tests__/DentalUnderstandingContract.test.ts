import { describe, expect, it } from "vitest";
import {
  dentalUnderstandingStructureSchema,
  parseDentalUnderstanding,
  validateDentalUnderstandingSemantics,
} from "@/domain-packs/dental/understanding";

const base = {
  version: "understanding.v1",
  dialogueMove: "new_topic",
  signals: {
    purchaseIntent: null,
    priceSensitivity: null,
    sentiment: null,
    objection: null,
  },
  safety: { optOut: false, requestsHuman: false, emergency: false },
  confidence: 0.9,
  ambiguity: null,
} as const;

function entities(service: string | null) {
  return {
    service,
    date: null,
    period: null,
    time: null,
    serviceCandidates: null,
    quantity: null,
    ordinal: null,
  };
}

describe("contrato de Understanding dental", () => {
  it.each([
    ["price-of-service", entities("clareamento")],
    ["service-availability", entities("aparelho")],
    ["book-appointment", entities(null)],
    ["confirm-slot", entities(null)],
    ["confirm-appointment", entities(null)],
  ])("aceita %s no recorte F", (request, requestEntities) => {
    expect(parseDentalUnderstanding({ ...base, request, entities: requestEntities }).request).toBe(request);
  });

  it.each([
    [{ ...base, request: "unknown", entities: entities(null) }],
    [{ ...base, request: "book-appointment", entities: entities(null), confidence: 1.1 }],
    [{ ...base, request: "book-appointment", entities: { ...entities(null), unexpected: true } }],
  ])("rejeita saída fora do contrato", (value) => {
    expect(() => parseDentalUnderstanding(value)).toThrow();
  });

  it("separa estrutura válida da exigência semântica de serviço", () => {
    const value = {
      ...base,
      request: "price-of-service",
      entities: entities(null),
    } as const;

    expect(dentalUnderstandingStructureSchema.safeParse(value).success).toBe(true);
    expect(validateDentalUnderstandingSemantics(value)).toEqual({
      valid: false,
      issues: [{
        path: ["entities", "service"],
        code: "service_required_for_request",
      }],
    });
    expect(() => parseDentalUnderstanding(value)).toThrow();
  });
});
