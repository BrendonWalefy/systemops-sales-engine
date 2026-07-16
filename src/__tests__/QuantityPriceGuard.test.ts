import { describe, it, expect } from "vitest";
import {
  extractQuantity,
  detectScope,
  resolveQuantityPriceQuery,
} from "@/core/intelligence/quantity-price";
import type { Treatment } from "@/domain/entities/treatment";

function treatment(overrides: Partial<Treatment> & { name: string }): Treatment {
  return {
    id: overrides.name,
    clinicId: "c1",
    durationMinutes: 300,
    description: null,
    requiresEvaluationFirst: true,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: true,
    pipelineSteps: null,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: true,
    priceKind: "from",
    priceUnit: "lentes",
    priceDeductible: false,
    quantityPrices: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const VITALLI_TREATMENTS: Treatment[] = [
  treatment({
    name: "Técnica Simplificada",
    quantityPrices: [
      { quantity: 10, priceCents: 150000 },
      { quantity: 20, priceCents: 180000 },
    ],
  }),
  treatment({
    name: "Técnica Estratificada",
    quantityPrices: [
      { quantity: 10, priceCents: 180000 },
      { quantity: 20, priceCents: 200000 },
    ],
  }),
];

describe("extractQuantity", () => {
  it("extrai quantidade seguida de substantivo de unidade", () => {
    expect(extractQuantity("Queria saber qual seria o valor de 16 lentes")).toBe(16);
    expect(extractQuantity("quanto fica 9 dentes?")).toBe(9);
    expect(extractQuantity("quero fazer 10 facetas em resina")).toBe(10);
  });

  it("ignora números sem unidade de pacote", () => {
    expect(extractQuantity("me chama no 11 98888")).toBeNull();
    expect(extractQuantity("quanto custa as lentes?")).toBeNull();
  });
});

describe("detectScope", () => {
  it("detecta arcada superior/inferior", () => {
    expect(detectScope("só as de cima")).toBe("superior");
    expect(detectScope("10 lentes inferiores")).toBe("inferior");
    expect(detectScope("quero 20 lentes")).toBe("total");
  });
});

describe("resolveQuantityPriceQuery", () => {
  it("quantidade EXATA da tabela → retorna os valores exatos (10 lentes)", () => {
    const r = resolveQuantityPriceQuery("qual valor de 10 lentes?", VITALLI_TREATMENTS);
    expect(r?.kind).toBe("exact");
    if (r?.kind === "exact") {
      expect(r.lines).toContain("Técnica Simplificada: R$ 1.500");
      expect(r.lines).toContain("Técnica Estratificada: R$ 1.800");
    }
  });

  it("caso Kevyn: 16 lentes NÃO está na tabela → unknown com pacotes disponíveis (nunca chuta R$2.000)", () => {
    const r = resolveQuantityPriceQuery("Queria saber qual seria o valor de 16 lentes", VITALLI_TREATMENTS);
    expect(r?.kind).toBe("unknown");
    if (r?.kind === "unknown") {
      expect(r.quantity).toBe(16);
      expect(r.availableSummary).toBe("10 ou 20");
    }
  });

  it("sem quantidade na mensagem → null (fluxo de preço normal assume)", () => {
    expect(resolveQuantityPriceQuery("qual o valor das lentes?", VITALLI_TREATMENTS)).toBeNull();
  });

  it("clínica sem tabela de pacotes → null (comportamento atual)", () => {
    const noPackages = [treatment({ name: "Lentes", quantityPrices: null })];
    expect(resolveQuantityPriceQuery("valor de 16 lentes", noPackages)).toBeNull();
  });
});
