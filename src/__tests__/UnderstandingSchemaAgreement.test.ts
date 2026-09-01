import { describe, expect, it } from "vitest";
import {
  dentalUnderstandingStructureSchema,
  parseDentalUnderstanding,
  validateDentalUnderstandingSemantics,
} from "@/domain-packs/dental/understanding";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";

/**
 * Há dois schemas em série: o JSON schema no boundary do modelo e o Zod logo
 * depois. Quando discordam, o modelo produz uma saída que o próprio sistema
 * recusa — e o turno morre sem que nada no CI acuse. Foi assim que a exigência
 * condicional de `entities.service` derrubou toda saudação em produção.
 */
function accepts(request: string, service: string | null): boolean {
  try {
    parseDentalUnderstanding({
      version: "understanding.v1",
      request,
      dialogueMove: "new_topic",
      entities: { service, businessInformationTopic: request === "business-information" ? "address" : null, date: null, period: null, time: null, serviceCandidates: null, quantity: null, ordinal: null },
      signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
      safety: { optOut: false, requestsHuman: false, emergency: false },
      confidence: 0.9,
      ambiguity: null,
    });
    return true;
  } catch {
    return false;
  }
}

describe("understanding schema agreement", () => {
  it("offers the model at least one request it can satisfy with no service", () => {
    const satisfiable = DENTAL_REQUESTS.filter((request) => accepts(request, null));
    expect(satisfiable.length).toBeGreaterThan(0);
  });

  it("keeps every request in the canonical structure", () => {
    const requestSchema = dentalUnderstandingStructureSchema.shape.request;
    expect(DENTAL_REQUESTS.every((request) => requestSchema.safeParse(request).success)).toBe(true);
  });

  it("never leaves a request that the model can emit and the parser always rejects", () => {
    const alwaysRejected = DENTAL_REQUESTS.filter((request) =>
      !accepts(request, null) && !accepts(request, "Clareamento dental"));
    expect(alwaysRejected).toEqual([]);
  });

  it("represents service requirements only in semantic validation", () => {
    const value = {
      version: "understanding.v1",
      request: "explain-service",
      dialogueMove: "new_topic",
      entities: { service: null, businessInformationTopic: null, date: null, period: null, time: null, serviceCandidates: null, quantity: null, ordinal: null },
      signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
      safety: { optOut: false, requestsHuman: false, emergency: false },
      confidence: 0.9,
      ambiguity: null,
    } as const;

    expect(dentalUnderstandingStructureSchema.safeParse(value).success).toBe(true);
    expect(validateDentalUnderstandingSemantics(value)).toEqual({
      valid: false,
      issues: [{ path: ["entities", "service"], code: "service_required_for_request" }],
    });
  });
});
