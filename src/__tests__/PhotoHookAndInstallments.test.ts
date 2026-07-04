// Testes para:
//   1. isAestheticTreatment — detecção de tratamentos que justificam o photo hook
//   2. buildSelectedTreatmentContext / buildDirectTreatmentContext — photo invite em concierge
//   3. buildActionContext(price_inquiry) — cálculo de parcelas + taxa da operadora

import { describe, it, expect } from "vitest";
import {
  isAestheticTreatment,
  buildSelectedTreatmentContext,
  buildDirectTreatmentContext,
  buildInstallmentTable,
  calculateFlatInstallment,
} from "@/core/pipeline/ConversationOrchestrator";
import { buildActionContext } from "@/core/intelligence/ResponseComposer";
import type { Treatment } from "@/domain/entities/treatment";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTreatment(name: string, requiresEval = false): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "ximendes",
    name,
    durationMinutes: 60,
    description: null,
    requiresEvaluationFirst: requiresEval,
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function makeProcedureItem(name: string, requiresEval = false) {
  return {
    index: 1,
    treatmentId: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    durationMinutes: 60,
    description: null,
    requiresEvaluationFirst: requiresEval,
  };
}

// ─── 1. isAestheticTreatment ──────────────────────────────────────────────────

describe("isAestheticTreatment", () => {
  const aesthetic = [
    "Lentes de resina composta",
    "Lentes de porcelana",
    "Facetas de porcelana",
    "Clareamento dental",
    "Harmonização orofacial",
    "Gengivoplastia",
    "Botox odontológico",
    "Design do sorriso",
  ];

  const nonAesthetic = [
    "Tratamento de canal",
    "Implante dentário",
    "Limpeza dental",
    "Exodontia",
    "Restauração em resina",
    "Avaliação",
    "Prótese dentária",
  ];

  it.each(aesthetic)("'%s' é estético → true", (name) => {
    expect(isAestheticTreatment(name)).toBe(true);
  });

  it.each(nonAesthetic)("'%s' não é estético → false", (name) => {
    expect(isAestheticTreatment(name)).toBe(false);
  });

  it("normaliza acentos — 'harmonizacao' (sem acento) detecta 'Harmonização'", () => {
    expect(isAestheticTreatment("harmonizacao")).toBe(true);
  });

  it("não é case-sensitive", () => {
    expect(isAestheticTreatment("LENTES DE RESINA")).toBe(true);
    expect(isAestheticTreatment("clareamento")).toBe(true);
  });
});

// ─── 2. Photo hook em buildSelectedTreatmentContext ───────────────────────────

describe("buildSelectedTreatmentContext — photo hook (concierge + estético)", () => {
  const lentes = makeProcedureItem("Lentes de resina composta", true);
  const canal = makeProcedureItem("Tratamento de canal");
  const policy = "Lentes a partir de R$2.500 para 20 elementos.";

  it("inclui convite à foto para tratamento estético em modo concierge", () => {
    const ctx = buildSelectedTreatmentContext(lentes, policy, "concierge");
    expect(ctx).toContain("NÃO ENVIOU FOTO");
    expect(ctx).toContain("se sentir à vontade");
  });

  it("photo hook é posicionado como benefício ao lead (não como exigência)", () => {
    const ctx = buildSelectedTreatmentContext(lentes, policy, "concierge");
    expect(ctx).toContain("orientação mais personalizada");
    // Confirma que a instrução é explicitamente opcional
    expect(ctx).toContain("completamente opcional");
    expect(ctx).toContain("nunca pressione");
    // Não deve impor envio da foto ao lead
    expect(ctx).not.toContain("é necessário enviar");
    expect(ctx).not.toContain("precisa enviar");
  });

  it("instrui a solicitar foto apenas UMA vez por conversa", () => {
    const ctx = buildSelectedTreatmentContext(lentes, policy, "concierge");
    expect(ctx).toContain("UMA vez por conversa");
  });

  it("proíbe misturar convite da foto com pergunta de agenda no mesmo turno", () => {
    const ctx = buildSelectedTreatmentContext(lentes, policy, "concierge");
    expect(ctx).toContain("NÃO misture o convite da foto com pergunta de agenda no mesmo turno");
    expect(ctx).toContain("NÃO misture explicação técnica, convite de foto e pergunta de agenda");
  });

  it("NÃO inclui photo hook para tratamento não-estético (canal) mesmo em concierge", () => {
    const ctx = buildSelectedTreatmentContext(canal, null, "concierge");
    expect(ctx).not.toContain("NÃO ENVIOU FOTO");
  });

  it("NÃO inclui photo hook em modo menu_first (só concierge)", () => {
    const ctx = buildSelectedTreatmentContext(lentes, policy, "menu_first");
    expect(ctx).not.toContain("NÃO ENVIOU FOTO");
  });

  it("em menu_first ainda menciona o comando *menu* para voltar", () => {
    const ctx = buildSelectedTreatmentContext(lentes, policy, "menu_first");
    expect(ctx).toContain("*menu*");
  });

  it("em concierge NÃO menciona *menu* (não interrompe fluxo conversacional)", () => {
    const ctx = buildSelectedTreatmentContext(lentes, policy, "concierge");
    expect(ctx).not.toContain("*menu*");
  });
});

// ─── 3. Photo hook em buildDirectTreatmentContext ─────────────────────────────

describe("buildDirectTreatmentContext — photo hook (concierge + estético)", () => {
  const clareamento = makeTreatment("Clareamento dental");
  const implante = makeTreatment("Implante dentário", true);

  it("inclui convite à foto para tratamento estético direto em concierge", () => {
    const ctx = buildDirectTreatmentContext(clareamento, null, "concierge");
    expect(ctx).toContain("NÃO ENVIOU FOTO");
    expect(ctx).toContain("se sentir à vontade");
  });

  it("NÃO inclui photo hook para implante (não-estético) em concierge", () => {
    const ctx = buildDirectTreatmentContext(implante, null, "concierge");
    expect(ctx).not.toContain("NÃO ENVIOU FOTO");
  });

  it("NÃO inclui photo hook em menu_first mesmo para tratamento estético", () => {
    const ctx = buildDirectTreatmentContext(clareamento, null, "menu_first");
    expect(ctx).not.toContain("NÃO ENVIOU FOTO");
  });
});

// ─── 4. Cálculo de parcelas em price_inquiry ─────────────────────────────────

describe("calculateFlatInstallment — cálculo exato com taxa flat da maquininha", () => {
  it("12x a 11,99% flat → R$237 (igual screenshot da maquininha)", () => {
    // 2500 / (1 - 0.1199) / 12 = 2840.59 / 12 = 236.72 → ceil → 237
    expect(calculateFlatInstallment(2500, 11.99, 12)).toBe(237);
  });

  it("4x a 6,99% flat → R$672 (igual screenshot)", () => {
    // 2500 / (1 - 0.0699) / 4 = 2687.88 / 4 = 671.97 → ceil → 672
    expect(calculateFlatInstallment(2500, 6.99, 4)).toBe(672);
  });

  it("arredonda sempre para cima", () => {
    const exact = 2500 / (1 - 11.99 / 100) / 12;
    expect(calculateFlatInstallment(2500, 11.99, 12)).toBeGreaterThanOrEqual(exact);
  });
});

describe("buildInstallmentTable — tabela com taxas flat", () => {
  const policy = "Lentes simplificada: R$1.500 para 10 elementos ou R$2.500 para 20 elementos.";
  const rates = [
    { n: 4,  rate: 6.99,  active: true  },
    { n: 6,  rate: 8.99,  active: false },
    { n: 10, rate: 10.99, active: true  },
    { n: 12, rate: 11.99, active: true  },
  ];

  it("gera tabela apenas com faixas ativas", () => {
    const table = buildInstallmentTable(policy, rates);
    expect(table).toContain("4x");
    expect(table).toContain("10x");
    expect(table).toContain("12x");
    expect(table).not.toContain("6x"); // inativo
  });

  it("valor exato para R$2.500 em 12x a 11,99% → R$237", () => {
    const table = buildInstallmentTable(policy, rates);
    expect(table).toContain("12x R$237");
  });

  it("instrui a não mencionar taxa adicional", () => {
    const table = buildInstallmentTable(policy, rates);
    expect(table).toContain("NUNCA diga");
    expect(table).toContain("taxa já está");
  });

  it("retorna null quando política não tem preços", () => {
    expect(buildInstallmentTable("Agende sua consulta conosco.", rates)).toBeNull();
  });

  it("retorna null quando não há faixas ativas", () => {
    const inactiveRates = rates.map((r) => ({ ...r, active: false }));
    expect(buildInstallmentTable(policy, inactiveRates)).toBeNull();
  });

  it("ignora valores pequenos (< R$200)", () => {
    const table = buildInstallmentTable("Desconto de R$50 na limpeza. Lentes R$1.500.", rates);
    expect(table).not.toContain("R$50");
    expect(table).toContain("R$1.500");
  });
});

describe("price_inquiry — fallback sem taxa configurada", () => {
  it("instrui a calcular parcela base (valor ÷ N)", () => {
    const ctx = buildActionContext({ type: "price_inquiry" });
    expect(ctx).toContain("valor ÷ número de parcelas");
  });

  it("apresenta como 'Nx de R$X'", () => {
    const ctx = buildActionContext({ type: "price_inquiry" });
    expect(ctx).toContain("Nx de R$X");
  });

  it("menciona que taxa fica com a maquininha/operadora (não inventar %)", () => {
    const ctx = buildActionContext({ type: "price_inquiry" });
    expect(ctx).toContain("maquininha");
    expect(ctx).toContain("NÃO invente uma porcentagem de taxa");
  });

  it("presente em ambos os modos sem taxa configurada", () => {
    const ctxMenu = buildActionContext({ type: "price_inquiry" }, "menu_first");
    const ctxConc = buildActionContext({ type: "price_inquiry" }, "concierge");
    expect(ctxMenu).toContain("maquininha");
    expect(ctxConc).toContain("maquininha");
  });
});

describe("price_inquiry — com tabela de parcelas configurada", () => {
  const policy = "Lentes simplificada: R$1.500 para 10 lentes ou R$2.500 para 20 lentes.";
  const rates = [
    { n: 4,  rate: 6.99,  active: true },
    { n: 12, rate: 11.99, active: true },
  ];
  const table = buildInstallmentTable(policy, rates)!;

  it("injeta tabela pré-calculada no context", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge", table);
    expect(ctx).toContain("TABELA DE PARCELAMENTO");
    expect(ctx).toContain("taxa já embutida");
  });

  it("instrui a NÃO mencionar taxa adicional quando tabela está presente", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "menu_first", table);
    expect(ctx).toContain("sem mencionar taxa adicional");
    expect(ctx).not.toContain("taxa da maquininha fica com a operadora");
  });

  it("valor exato aparece no context (12x R$237 para R$2.500 a 11,99%)", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge", table);
    expect(ctx).toContain("12x R$237");
  });
});
