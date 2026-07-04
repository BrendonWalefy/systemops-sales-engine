// Guards determinísticos pós-classificação — casos reais da Ximendes (02/07/2026):
// lead perguntou "qual valor pra fazer o polimento nas lentes de resina?" e a IA
// (1) cotou o preço das lentes novas em vez de encaminhar a manutenção à equipe e
// (2) apresentou apenas a Técnica Estratificada quando o termo cobria as duas variações.
import { describe, expect, it } from "vitest";
import {
  detectAmbiguousTreatmentTerm,
  detectUncataloguedMaintenanceInquiry,
} from "@/core/pipeline/ConversationOrchestrator";
import type { Treatment } from "@/domain/entities/treatment";

function treatment(name: string, overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "clinic-1",
    name,
    durationMinutes: 60,
    description: null,
    requiresEvaluationFirst: false,
    triggerTemplate: null,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    pipelineSteps: null,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: false,
    priceKind: "from",
    priceUnit: null,
    priceDeductible: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const SHARED_LENS_ALIASES = [
  "lentes",
  "lente",
  "faceta",
  "facetas",
  "resina",
  "lentes de resina",
  "lentes de contato dental",
  "faceta de resina",
  "resina nos dentes",
  "lente no dente",
];

const treatments = [
  treatment("Avaliação", { aliases: ["consulta", "avaliação inicial"] }),
  treatment("Lentes de resina composta estratificada", {
    aliases: [...SHARED_LENS_ALIASES, "estratificada", "premium"],
  }),
  treatment("Lentes de resina composta simplificada", {
    aliases: [...SHARED_LENS_ALIASES, "simplificada"],
  }),
  treatment("Clareamento dental", { aliases: ["clareamento", "clarear"] }),
  treatment("Limpeza dental", { aliases: ["limpeza", "profilaxia"] }),
];

describe("detectAmbiguousTreatmentTerm", () => {
  it("termo genérico que cobre duas variações retorna ambas (caso Jean)", () => {
    const result = detectAmbiguousTreatmentTerm(
      "Qual valor pra fazer o polimento nas lentes de resina ?",
      treatments,
    );
    expect(result).toEqual([
      "Lentes de resina composta estratificada",
      "Lentes de resina composta simplificada",
    ]);
  });

  it("'quanto custam as lentes' é ambíguo entre as duas técnicas", () => {
    const result = detectAmbiguousTreatmentTerm("quanto custam as lentes?", treatments);
    expect(result).toHaveLength(2);
  });

  it("termo exclusivo de uma variação não é ambíguo", () => {
    expect(detectAmbiguousTreatmentTerm("quanto custa a lente estratificada?", treatments)).toBeNull();
    expect(detectAmbiguousTreatmentTerm("valor das lentes premium", treatments)).toBeNull();
    expect(detectAmbiguousTreatmentTerm("quanto fica a simplificada?", treatments)).toBeNull();
  });

  it("pergunta comparativa nomeando as duas variações não é ambígua (LLM compõe a comparação)", () => {
    const result = detectAmbiguousTreatmentTerm(
      "qual a diferença entre a estratificada e a simplificada?",
      treatments,
    );
    expect(result).toBeNull();
  });

  it("tratamento sem variações não dispara ambiguidade", () => {
    expect(detectAmbiguousTreatmentTerm("quanto custa o clareamento?", treatments)).toBeNull();
  });

  it("mensagem sem menção a tratamento retorna null", () => {
    expect(detectAmbiguousTreatmentTerm("bom dia, tudo bem?", treatments)).toBeNull();
  });
});

describe("detectUncataloguedMaintenanceInquiry", () => {
  it("detecta polimento de lentes já feitas (caso Jean)", () => {
    expect(
      detectUncataloguedMaintenanceInquiry(
        "Qual valor pra fazer o polimento nas lentes de resina ?",
        treatments,
      ),
    ).toBe("polimento");
  });

  it("detecta insistência do lead na mesma pergunta", () => {
    expect(
      detectUncataloguedMaintenanceInquiry("Queria saber o valor do polimento", treatments),
    ).toBe("polimento");
  });

  it("detecta verbo de manutenção", () => {
    expect(
      detectUncataloguedMaintenanceInquiry("quanto custa pra polir as lentes?", treatments),
    ).toBe("polir");
  });

  it("não dispara quando o serviço de manutenção consta no catálogo", () => {
    const withMaintenance = [
      ...treatments,
      treatment("Manutenção ortodôntica", { aliases: ["manutenção do aparelho"] }),
    ];
    expect(
      detectUncataloguedMaintenanceInquiry(
        "quanto custa a manutenção do aparelho?",
        withMaintenance,
      ),
    ).toBeNull();
  });

  it("pergunta de preço do tratamento em si não é manutenção", () => {
    expect(
      detectUncataloguedMaintenanceInquiry("quanto custam as lentes de resina?", treatments),
    ).toBeNull();
  });

  it("não confunde palavras que apenas contêm o radical", () => {
    expect(
      detectUncataloguedMaintenanceInquiry("qual a política de pagamento?", treatments),
    ).toBeNull();
  });
});
