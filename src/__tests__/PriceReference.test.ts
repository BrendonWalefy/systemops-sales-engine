import { describe, expect, it } from "vitest";
import {
  extractAllReferencedPrices,
  extractReferencedPrice,
} from "@/core/intelligence/price-reference";
import { buildActionContext } from "@/core/intelligence/ResponseComposer";

describe("extractReferencedPrice", () => {
  it("preserva o valor no formato americano usado pelo WhatsApp", () => {
    expect(extractReferencedPrice("Esses 2,000.00 vocês parcelam?")).toEqual({
      cents: 200_000,
      formatted: "R$ 2.000",
    });
  });

  it("aceita formatos brasileiros e valor inteiro sem separador", () => {
    expect(extractReferencedPrice("R$ 2.000")?.cents).toBe(200_000);
    expect(extractReferencedPrice("R$ 2.000,00 dá para parcelar?")?.cents).toBe(200_000);
    expect(extractReferencedPrice("vocês parcelam o 20000?")?.cents).toBe(2_000_000);
  });

  it("não trata telefone como preço", () => {
    expect(extractReferencedPrice("Dá para parcelar? Meu telefone é 5511999999999")).toBeNull();
  });
});

describe("extractAllReferencedPrices", () => {
  it("devolve os dois valores de uma oferta à vista ou parcelada", () => {
    expect(
      extractAllReferencedPrices("Fica R$ 4.000 à vista ou 10x de R$ 400 no cartão."),
    ).toEqual([400_000, 40_000]);
  });

  it("não repete o mesmo valor citado duas vezes na mesma resposta", () => {
    expect(
      extractAllReferencedPrices("O valor é R$ 2.000. Confirma o R$ 2.000?"),
    ).toEqual([200_000]);
  });

  it("devolve vazio quando não há contexto de dinheiro", () => {
    expect(extractAllReferencedPrices("Podemos marcar terça às 14h?")).toEqual([]);
  });
});

describe("buildActionContext — valor citado pelo lead", () => {
  it("instrui a responder o valor citado, sem trocar por outro pacote", () => {
    const context = buildActionContext({
      type: "price_inquiry",
      identifiedTreatment: "Lente em Resina Estratificada",
      referencedPriceCents: 200_000,
    });

    expect(context).toContain("mencionou explicitamente R$ 2.000");
    expect(context).toContain("NÃO substitua por outro preço de tratamento");
    expect(context).toContain("sem calcular uma parcela quando ele não informar o número de vezes");
  });
});
