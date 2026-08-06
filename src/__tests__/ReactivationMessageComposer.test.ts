import { describe, expect, it } from "vitest";
import {
  MAX_DRAFT_LENGTH,
  buildReactivationMessagePrompt,
  extractMoneyMentions,
  validateDraft,
  type ReactivationMessageInput,
} from "@/core/intelligence/ReactivationMessageComposer";

const offer = {
  treatmentName: "Lentes de contato dental",
  priceLabel: "R$ 1.200",
  campaignName: "Julho — condição especial",
};

const base: ReactivationMessageInput = {
  clinicName: "Clínica Aurora",
  receptionistName: "Marina",
  specialty: "odontologia estética",
  leadName: "Ana",
  treatmentInterest: "Lentes de contato dental",
  outcomeReason: "price",
  evidenceExcerpt: "tá bem acima do que eu posso pagar agora",
  offer,
  deadlineLabel: "sexta-feira, 24/07",
  recentMessages: [
    { author: "lead", body: "quanto fica as lentes?" },
    { author: "agent", body: "A partir de R$ 1.800 por dente." },
    { author: "lead", body: "tá bem acima do que eu posso pagar agora" },
  ],
};

describe("ReactivationMessageComposer — guard de preço", () => {
  it("aceita rascunho que cita exatamente o valor autorizado", () => {
    const r = validateDraft("Oi Ana! Consegui R$ 1.200 nas lentes até sexta.", base);
    expect(r.ok).toBe(true);
  });

  it("recusa valor diferente do autorizado — a IA não pode criar obrigação comercial", () => {
    const r = validateDraft("Oi Ana! Consegui R$ 800 nas lentes.", base);
    expect(r).toEqual({ ok: false, reason: "preco_nao_autorizado" });
  });

  it("recusa qualquer preço quando a campanha não tem oferta", () => {
    const r = validateDraft("Oi Ana! Temos condição de R$ 900.", {
      offer: null,
      deadlineLabel: null,
    });
    expect(r).toEqual({ ok: false, reason: "preco_nao_autorizado" });
  });

  it("aceita mensagem sem preço quando não há oferta", () => {
    const r = validateDraft("Oi Ana! Ainda tem interesse nas lentes?", {
      offer: null,
      deadlineLabel: null,
    });
    expect(r.ok).toBe(true);
  });

  it("tolera variação de espaçamento e centavos no valor", () => {
    expect(validateDraft("Fica R$1.200 fechado.", base).ok).toBe(true);
    expect(validateDraft("Fica R$ 1.200,00 fechado.", base).ok).toBe(true);
  });

  it("recusa quando um dos vários valores citados é inventado", () => {
    const r = validateDraft("De R$ 1.800 por R$ 1.200 — só até sexta.", base);
    expect(r).toEqual({ ok: false, reason: "preco_nao_autorizado" });
  });

  it("extrai todas as menções a dinheiro", () => {
    expect(extractMoneyMentions("de R$ 1.800 por R$1.200")).toEqual(["r$1.800", "r$1.200"]);
    expect(extractMoneyMentions("sem valor nenhum")).toEqual([]);
  });
});

describe("ReactivationMessageComposer — guard de urgência", () => {
  it("recusa urgência inventada quando não há prazo", () => {
    const r = validateDraft("Oi Ana! Últimas vagas, corre!", {
      offer: null,
      deadlineLabel: null,
    });
    expect(r).toEqual({ ok: false, reason: "prazo_inventado" });
  });

  it("aceita urgência quando a clínica definiu prazo", () => {
    const r = validateDraft("Oi Ana! A condição vai até sexta-feira, 24/07.", base);
    expect(r.ok).toBe(true);
  });
});

describe("ReactivationMessageComposer — higiene do texto", () => {
  it("recusa texto vazio", () => {
    expect(validateDraft("   ", base)).toEqual({ ok: false, reason: "vazio" });
  });

  it("recusa texto acima do limite de WhatsApp", () => {
    const r = validateDraft("a".repeat(MAX_DRAFT_LENGTH + 1), base);
    expect(r).toEqual({ ok: false, reason: "muito_longo" });
  });

  it("recusa marcador de preenchimento que vazou", () => {
    expect(validateDraft("Oi [nome], tudo bem?", base)).toEqual({
      ok: false,
      reason: "placeholder_nao_preenchido",
    });
    expect(validateDraft("Oi {{nome}}, tudo bem?", base)).toEqual({
      ok: false,
      reason: "placeholder_nao_preenchido",
    });
  });

  it("remove aspas que o modelo colocou ao redor da mensagem", () => {
    const r = validateDraft('"Oi Ana, tudo bem?"', base);
    expect(r).toEqual({ ok: true, text: "Oi Ana, tudo bem?" });
  });
});

describe("ReactivationMessageComposer — prompt", () => {
  it("injeta oferta e prazo como dados autorizados", () => {
    const prompt = buildReactivationMessagePrompt(base);
    expect(prompt).toContain("OFERTA AUTORIZADA");
    expect(prompt).toContain("R$ 1.200");
    expect(prompt).toContain("sexta-feira, 24/07");
    expect(prompt).toContain("Marina");
    expect(prompt).toContain("tá bem acima do que eu posso pagar agora");
  });

  it("proíbe explicitamente preço quando não há oferta", () => {
    const prompt = buildReactivationMessagePrompt({ ...base, offer: null });
    expect(prompt).toContain("SEM OFERTA");
    expect(prompt).not.toContain("OFERTA AUTORIZADA");
  });

  it("proíbe urgência quando não há prazo", () => {
    const prompt = buildReactivationMessagePrompt({ ...base, deadlineLabel: null });
    expect(prompt).toContain("SEM PRAZO");
  });

  it("adapta a orientação ao motivo do não-fechamento", () => {
    const preco = buildReactivationMessagePrompt(base);
    const medo = buildReactivationMessagePrompt({ ...base, outcomeReason: "fear" });
    expect(preco).toContain("valor foi o que travou");
    expect(medo).toContain("insegurança com o procedimento");
  });
});
