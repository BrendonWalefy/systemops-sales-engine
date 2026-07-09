import { describe, expect, it } from "vitest";
import { composePriceSection, type TreatmentPriceFact } from "@/application/config/editorial-config";

/**
 * Item 3 — "um fato, um dono" (docs/architecture/config-ownership-audit.md §5).
 *
 * `composePriceSection` DERIVA a prosa de preço a partir dos fatos estruturados do
 * treatment (priceCents + flags), substituindo o preço digitado à mão na
 * commercialPolicy. Estes contratos garantem que o número que a IA fala nasce do
 * cadastro (Financeiro) e nunca pode divergir dele.
 *
 * Invariante de rollout seguro: quando NENHUM tratamento é cotável por mensagem, a
 * função retorna "" — então a commercialPolicy humana (clínicas ainda não migradas,
 * ex. Ximendes) segue 100% intacta. Zero regressão ao publicar a derivação.
 */
function fact(overrides: Partial<TreatmentPriceFact> & { name: string }): TreatmentPriceFact {
  return {
    priceCents: null,
    minPriceCents: null,
    priceQuotableInChat: false,
    priceKind: "from",
    priceUnit: null,
    priceDeductible: false,
    ...overrides,
  };
}

describe("composePriceSection — derivação de preço", () => {
  it("retorna vazio quando nada é cotável (protege clínicas não migradas)", () => {
    const text = composePriceSection([
      fact({ name: "Implante", minPriceCents: 290000, priceQuotableInChat: false }),
      fact({ name: "Canal", priceCents: 90000, priceQuotableInChat: false }),
    ]);
    expect(text).toBe("");
  });

  it("piso ('from') vira 'a partir de' com valor exato na avaliação", () => {
    const text = composePriceSection([
      fact({ name: "Lentes", minPriceCents: 250000, priceQuotableInChat: true, priceKind: "from" }),
    ]);
    expect(text).toContain("Lentes: a partir de R$ 2.500");
    expect(text).toContain("o valor exato é definido na avaliação");
  });

  it("fixo ('fixed') vira valor exato, sem 'a partir de'", () => {
    const text = composePriceSection([
      fact({ name: "Limpeza", priceCents: 22000, priceQuotableInChat: true, priceKind: "fixed" }),
    ]);
    expect(text).toContain("Limpeza: R$ 220.");
    expect(text).not.toContain("a partir de");
  });

  it("inclui a unidade quando presente (evita cotação enganosa)", () => {
    const text = composePriceSection([
      fact({ name: "Lentes", minPriceCents: 250000, priceUnit: "20 elementos", priceQuotableInChat: true }),
    ]);
    expect(text).toContain("R$ 2.500 (20 elementos)");
  });

  it("abatimento acrescenta a instrução de mencionar o desconto", () => {
    const text = composePriceSection([
      fact({ name: "Avaliação", priceCents: 10000, priceQuotableInChat: true, priceKind: "fixed", priceDeductible: true }),
    ]);
    expect(text).toContain("Avaliação: R$ 100.");
    expect(text).toContain("abatido integralmente do tratamento");
    expect(text).toContain("sempre mencione esse abatimento");
  });

  it("cotável marcado mas sem valor cadastrado é ignorado (não inventa número)", () => {
    const text = composePriceSection([
      fact({ name: "Botox", priceQuotableInChat: true, priceCents: null, minPriceCents: null }),
    ]);
    expect(text).toBe("");
  });

  it("'fixed' cai para minPriceCents e 'from' cai para priceCents quando o preferido é nulo", () => {
    const fixedFallback = composePriceSection([
      fact({ name: "A", priceCents: null, minPriceCents: 5000, priceQuotableInChat: true, priceKind: "fixed" }),
    ]);
    expect(fixedFallback).toContain("A: R$ 50.");

    const fromFallback = composePriceSection([
      fact({ name: "B", priceCents: 7000, minPriceCents: null, priceQuotableInChat: true, priceKind: "from" }),
    ]);
    expect(fromFallback).toContain("B: a partir de R$ 70");
  });

  it("adiciona a linha 'demais procedimentos' quando há não-cotáveis", () => {
    const text = composePriceSection([
      fact({ name: "Lentes", minPriceCents: 250000, priceQuotableInChat: true }),
      fact({ name: "Implante", minPriceCents: 290000, priceQuotableInChat: false }),
    ]);
    expect(text).toContain("Para os demais procedimentos, não informe valores por mensagem");
  });

  it("NÃO adiciona a linha 'demais' quando todos são cotáveis", () => {
    const text = composePriceSection([
      fact({ name: "Lentes", minPriceCents: 250000, priceQuotableInChat: true }),
      fact({ name: "Avaliação", priceCents: 10000, priceQuotableInChat: true, priceKind: "fixed" }),
    ]);
    expect(text).not.toContain("Para os demais procedimentos");
  });

  it("é TTS-safe: sem bullets (•) nem traços de lista", () => {
    const text = composePriceSection([
      fact({ name: "Lentes", minPriceCents: 250000, priceQuotableInChat: true }),
      fact({ name: "Implante", priceQuotableInChat: false }),
    ]);
    expect(text).not.toContain("•");
    expect(text).not.toMatch(/^\s*-\s/m);
  });

  it("formata centavos não-redondos com 2 casas", () => {
    const text = composePriceSection([
      fact({ name: "X", priceCents: 15050, priceQuotableInChat: true, priceKind: "fixed" }),
    ]);
    expect(text).toContain("R$ 150,50");
  });

  it("campanha ativa com valor diferente do de lista vira 'de X por Y' com o nome da campanha", () => {
    const text = composePriceSection([
      fact({
        name: "Lentes",
        priceCents: 150000,
        priceQuotableInChat: true,
        priceKind: "fixed",
        originalPriceCents: 170000,
        campaignName: "Promoção de lançamento",
      }),
    ]);
    expect(text).toContain("Lentes: de R$ 1.700 por R$ 1.500.");
    expect(text).toContain('[Promoção "Promoção de lançamento"]');
  });

  it("campanha ativa com data de término inclui o prazo na prosa", () => {
    const endsAt = new Date("2026-07-31T23:59:59Z");
    const text = composePriceSection([
      fact({
        name: "Lentes",
        priceCents: 150000,
        priceQuotableInChat: true,
        priceKind: "fixed",
        originalPriceCents: 170000,
        campaignName: "Promoção de lançamento",
        campaignEndsAt: endsAt,
      }),
    ]);
    expect(text).toMatch(/válida até \d{2}\/\d{2}/);
  });

  it("sem campanha (originalPriceCents ausente), não menciona 'de X por Y' nem promoção", () => {
    const text = composePriceSection([
      fact({ name: "Lentes", priceCents: 150000, priceQuotableInChat: true, priceKind: "fixed" }),
    ]);
    expect(text).toContain("Lentes: R$ 1.500.");
    expect(text).not.toContain("Promoção");
    expect(text).not.toContain(" por ");
  });

  it("kind 'from' com campanha mantém 'a partir de' e aponta o preço de lista entre parênteses", () => {
    const text = composePriceSection([
      fact({
        name: "Lentes",
        minPriceCents: 150000,
        priceQuotableInChat: true,
        priceKind: "from",
        originalPriceCents: 170000,
        campaignName: "Promoção de lançamento",
      }),
    ]);
    expect(text).toContain("Lentes: a partir de R$ 1.500 (de R$ 1.700)");
    expect(text).toContain("o valor exato é definido na avaliação");
  });

  it("shape Ximendes: avaliação abatida + 2 técnicas de lentes + demais na avaliação", () => {
    const text = composePriceSection([
      fact({ name: "Avaliação", priceCents: 10000, priceQuotableInChat: true, priceKind: "fixed", priceDeductible: true }),
      fact({ name: "Lentes de resina (Simplificada)", minPriceCents: 250000, priceUnit: "20 elementos", priceQuotableInChat: true, priceKind: "from" }),
      fact({ name: "Lentes de resina (Estratificada)", minPriceCents: 500000, priceUnit: "20 elementos", priceQuotableInChat: true, priceKind: "from" }),
      fact({ name: "Implante", minPriceCents: 290000, priceQuotableInChat: false }),
      fact({ name: "Clareamento", priceQuotableInChat: false }),
    ]);

    expect(text).toContain("VALORES (informe exatamente estes; nunca invente outros):");
    expect(text).toContain("Avaliação: R$ 100.");
    expect(text).toContain("abatido integralmente do tratamento");
    expect(text).toContain("Lentes de resina (Simplificada): a partir de R$ 2.500 (20 elementos)");
    expect(text).toContain("Lentes de resina (Estratificada): a partir de R$ 5.000 (20 elementos)");
    expect(text).toContain("Para os demais procedimentos, não informe valores por mensagem");
    // Nenhum valor dos não-cotáveis vaza.
    expect(text).not.toContain("2.900");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });
});
