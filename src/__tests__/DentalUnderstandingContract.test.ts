import { describe, expect, it } from "vitest";
import { parseDentalUnderstanding } from "@/domain-packs/dental/understanding";

const base = {
  version: "understanding.v1",
  dialogueMove: "new_topic",
  signals: {},
  safety: {},
  confidence: 0.9,
  ambiguity: null,
} as const;

describe("contrato de Understanding dental", () => {
  it.each([
    ["price-of-service", { service: "clareamento" }],
    ["service-availability", { service: "aparelho" }],
    ["book-appointment", {}],
    ["confirm-slot", {}],
    ["confirm-appointment", {}],
  ])("aceita %s no recorte F", (request, entities) => {
    expect(parseDentalUnderstanding({ ...base, request, entities }).request).toBe(request);
  });

  it.each([
    [{ ...base, request: "price-of-service", entities: {} }],
    [{ ...base, request: "unknown", entities: {} }],
    [{ ...base, request: "book-appointment", entities: {}, confidence: 1.1 }],
  ])("rejeita saída fora do contrato", (value) => {
    expect(() => parseDentalUnderstanding(value)).toThrow();
  });
});
