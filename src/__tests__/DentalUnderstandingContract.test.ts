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
    businessInformationTopic: null,
    date: null,
    period: null,
    time: null,
    serviceCandidates: null,
    faqQuestion: null,
    quantity: null,
    quantityScope: null,
    objectionQuestion: null,
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

  it("exige tópico fechado para informação institucional", () => {
    const valid = {
      ...base,
      request: "business-information",
      entities: {
        ...entities(null),
        businessInformationTopic: "business-hours",
      },
    } as const;

    expect(parseDentalUnderstanding(valid).request).toBe("business-information");
    expect(() => parseDentalUnderstanding({
      ...valid,
      entities: { ...valid.entities, businessInformationTopic: null },
    })).toThrow();
    expect(() => parseDentalUnderstanding({
      ...valid,
      entities: { ...valid.entities, businessInformationTopic: "unknown" },
    })).toThrow();
    expect(() => parseDentalUnderstanding({
      ...valid,
      request: "price-of-service",
      entities: { ...valid.entities, service: "clareamento" },
    })).toThrow();
  });

  it("exige exatamente dois tratamentos canônicos e distintos para comparação", () => {
    const valid = {
      ...base,
      request: "compare-services",
      entities: {
        ...entities(null),
        serviceCandidates: ["Clareamento", "Faceta"],
      },
    } as const;

    expect(parseDentalUnderstanding(valid).request).toBe("compare-services");
    for (const serviceCandidates of [
      null,
      ["Clareamento"],
      ["Clareamento", "Faceta", "Implante"],
      ["Clareamento", " clareamento "],
    ]) {
      expect(() => parseDentalUnderstanding({
        ...valid,
        entities: { ...valid.entities, serviceCandidates },
      })).toThrow();
    }
    expect(() => parseDentalUnderstanding({
      ...valid,
      request: "other",
    })).toThrow();
  });

  it("exige a pergunta canônica somente para FAQ", () => {
    const valid = {
      ...base,
      request: "frequently-asked-question",
      entities: {
        ...entities(null),
        faqQuestion: "Preciso de encaminhamento?",
      },
    } as const;

    expect(parseDentalUnderstanding(valid).request).toBe("frequently-asked-question");
    expect(() => parseDentalUnderstanding({
      ...valid,
      entities: { ...valid.entities, faqQuestion: null },
    })).toThrow();
    expect(() => parseDentalUnderstanding({
      ...valid,
      request: "business-differentials",
    })).toThrow();
  });

  it("aceita pagamento com serviço opcional", () => {
    expect(parseDentalUnderstanding({
      ...base,
      request: "payment-options",
      entities: entities(null),
    }).request).toBe("payment-options");
    expect(parseDentalUnderstanding({
      ...base,
      request: "payment-options",
      entities: entities("Clareamento"),
    }).entities.service).toBe("Clareamento");
  });

  it("restringe quantidade e escopo a preço com quantidade positiva inteira", () => {
    const valid = {
      ...base,
      request: "price-of-service",
      entities: {
        ...entities("Lentes"),
        quantity: 10,
        quantityScope: "superior",
      },
    } as const;
    expect(parseDentalUnderstanding(valid).entities.quantity).toBe(10);
    for (const quantity of [0, -1, 1.5]) {
      expect(() => parseDentalUnderstanding({
        ...valid,
        entities: { ...valid.entities, quantity },
      })).toThrow();
    }
    expect(() => parseDentalUnderstanding({
      ...valid,
      request: "service-availability",
    })).toThrow();
  });

  it("exige uma pergunta canônica somente para objeção cadastrada", () => {
    const valid = {
      ...base,
      request: "registered-objection",
      entities: {
        ...entities(null),
        objectionQuestion: "Está caro para mim",
      },
    } as const;
    expect(parseDentalUnderstanding(valid).request).toBe("registered-objection");
    expect(() => parseDentalUnderstanding({
      ...valid,
      entities: { ...valid.entities, objectionQuestion: null },
    })).toThrow();
    expect(() => parseDentalUnderstanding({
      ...valid,
      request: "other",
    })).toThrow();
  });
});
