import { describe, it, expect } from "vitest";
import {
  detectOldPriceObjection,
  detectAtypicalClinicalCase,
} from "@/core/intelligence/objection-triage";

// A5 — Objeção de preço antigo. Caso real: Marcel (15/07) — "vcs tinham me passado
// um valor legal... ficava 10 de 200 e pouquinho".
describe("detectOldPriceObjection", () => {
  it("detecta que o lead cita uma cotação nossa anterior mais barata", () => {
    expect(detectOldPriceObjection("vcs tinham me passado um valor legal, se conseguir manter")).toBe(true);
    expect(detectOldPriceObjection("aquele valor era um valor do ano passado?")).toBe(true);
    expect(detectOldPriceObjection("me passaram um preço menor antes")).toBe(true);
  });

  it("não dispara para pergunta de preço comum", () => {
    expect(detectOldPriceObjection("qual o valor das lentes?")).toBe(false);
    expect(detectOldPriceObjection("quanto custa 20 lentes?")).toBe(false);
    // "era" sozinho não pode disparar (pergunta comum de reconferência)
    expect(detectOldPriceObjection("qual era o valor mesmo?")).toBe(false);
    expect(detectOldPriceObjection("o valor é 2000 certo?")).toBe(false);
  });
});

// A6 — Triagem de caso atípico. Caso real: Gaab (15/07) — dois dentes fraturados,
// só a raiz, indicação de ponte fixa.
describe("detectAtypicalClinicalCase", () => {
  it("detecta dente fraturado / só raiz / ponte / prótese / implante / extração", () => {
    expect(detectAtypicalClinicalCase("esses dois dentes estão fraturados")).toBe("dente fraturado");
    expect(detectAtypicalClinicalCase("tem somente a raiz por dentro")).toBe("só a raiz do dente");
    expect(detectAtypicalClinicalCase("meu dentista indicou uma ponte fixa")).toBe("ponte/prótese");
    expect(detectAtypicalClinicalCase("preciso de um implante")).toBe("implante");
    expect(detectAtypicalClinicalCase("esse dente eu já perdi, caiu o dente")).toBe("dente extraído/ausente");
  });

  it("não dispara para caso estético direto de lentes", () => {
    expect(detectAtypicalClinicalCase("quero transformar meu sorriso com lentes")).toBeNull();
    expect(detectAtypicalClinicalCase("qual o valor de 20 lentes estratificadas?")).toBeNull();
  });
});
