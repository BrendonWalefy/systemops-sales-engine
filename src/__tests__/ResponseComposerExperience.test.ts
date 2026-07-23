import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildActionContext,
  resolveComposerModel,
  shouldUseResponsesApi,
} from "@/core/intelligence/ResponseComposer";

function clearComposerModelEnv() {
  vi.stubEnv("OPENAI_COMPOSER_MODEL", "");
  vi.stubEnv("OPENAI_COMPOSER_MODEL_START", "");
  vi.stubEnv("OPENAI_COMPOSER_MODEL_START", "");
  vi.stubEnv("OPENAI_COMPOSER_MODEL_DEFAULT", "");
  vi.stubEnv("OPENAI_COMPOSER_MODEL_GROWTH", "");
  vi.stubEnv("OPENAI_COMPOSER_MODEL_GROWTH", "");
  vi.stubEnv("OPENAI_COMPOSER_MODEL_SCALE", "");
  vi.stubEnv("OPENAI_COMPOSER_MODEL_SCALE", "");
  vi.stubEnv("OPENAI_COMPOSER_MODEL_ENTERPRISE", "");
  vi.stubEnv("OPENAI_COMPOSER_MODEL_PREMIUM", "");
  vi.stubEnv("OPENAI_COMPOSER_API", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ResponseComposer — conversation experience", () => {
  it("price inquiry context no longer forces menu CTA in concierge mode", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge");

    expect(ctx).not.toContain("digitar *menu*");
    expect(ctx).not.toContain("digite menu");
    expect(ctx).toContain("conduza ativamente para o próximo passo");
  });

  it("price inquiry context pushes demo-quality value framing", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge");

    expect(ctx).toContain("NÃO entregue uma lista seca de preços");
    expect(ctx).toContain("o que ela entrega na prática");
    expect(ctx).toContain("Prefira um fechamento confiante e humano");
    expect(ctx).toContain("Evite encerramentos passivos");
  });

  it("general question context does not reoffer menu for clear questions", () => {
    const ctx = buildActionContext(
      { type: "general_question", clinicContext: "Lead perguntou sobre endereço." },
      "menu_first",
    );

    expect(ctx).not.toContain("digitar *menu*");
    expect(ctx).toContain("Não reapresente menu");
  });

  it("price objection handoff still instructs the composer to sell before escalating", () => {
    const ctx = buildActionContext({
      type: "handoff_requested",
      handoffReason: "Lead achou caro e comparou valor com outra clínica",
    });

    expect(ctx).toContain("Pedido comercial sensível");
    expect(ctx).toContain("NÃO pode ser só");
    expect(ctx).toContain("responda vendendo");
    expect(ctx).toContain("reancore o valor");
    expect(ctx).toContain("degrau de menor compromisso");
    expect(ctx).toContain("não use \"cada caso é único\" como clichê");
    expect(ctx).toContain("investimento parecer mais compreensível");
    expect(ctx).toContain("não use superlativos genéricos");
    expect(ctx).toContain("atendimento exclusivo");
  });

  it("generic handoff keeps the short human escalation instruction", () => {
    const ctx = buildActionContext({
      type: "handoff_requested",
      handoffReason: "Lead pediu fotos do procedimento realizado",
    });

    expect(ctx).toContain("Este pedido requer atendimento humano");
    expect(ctx).toContain("a IA não pode cumprir");
    expect(ctx).not.toContain("responda vendendo");
  });

  it("greeting with a clear treatment question should answer before scheduling", () => {
    const ctx = buildActionContext({ type: "greeting" }, "concierge");

    expect(ctx).toContain("se a mesma mensagem já contém procedimento");
    expect(ctx).toContain("responda esse conteúdo");
    expect(ctx).toContain("Não pule direto para agenda");
    expect(ctx).toContain("PROIBIDO mencionar \"ver horários\"");
    expect(ctx).toContain("a menos que o lead tenha pedido explicitamente para marcar");
  });

  it("thinking acknowledgment avoids call-center fallback", () => {
    const ctx = buildActionContext({ type: "acknowledgment" }, "concierge");

    expect(ctx).toContain("Se o lead disse que vai pensar");
    expect(ctx).toContain("sem pressão");
    expect(ctx).toContain("NÃO use \"fico à disposição\"");
    expect(ctx).toContain("\"estou por aqui, caso\"");
  });

  it("general question context blocks invented natural-smile proof points", () => {
    const ctx = buildActionContext({
      type: "general_question",
      clinicContext: "Lead tem medo de ficar com sorriso artificial.",
    });

    expect(ctx).toContain("MEDO DE RESULTADO ARTIFICIAL");
    expect(ctx).toContain("sem inventar processos específicos");
    expect(ctx).toContain("Só diga que escolhe cor/transparência");
  });
});

describe("ResponseComposer — concierge modes (drive)", () => {
  // undefined drive deve preservar o comportamento histórico do concierge:
  // condução ativa ao próximo passo (default = "sempre_proximo_passo").
  it("defaults to active next-step drive when no drive is configured", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge", undefined, undefined, undefined);
    expect(ctx).toContain("conduza ativamente para o próximo passo");
  });

  it("responder_e_parar suppresses the closing question on price inquiries", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge", undefined, undefined, "responder_e_parar");
    expect(ctx).toContain("não faça nenhuma pergunta");
    expect(ctx).not.toContain("conduza ativamente para o próximo passo");
  });

  it("direto_ao_agendamento pushes straight to scheduling on price inquiries", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge", undefined, undefined, "direto_ao_agendamento");
    expect(ctx).toContain("ofereça imediatamente ver os horários");
  });

  it("responder_e_parar suppresses the closing question on general questions", () => {
    const ctx = buildActionContext(
      { type: "general_question", clinicContext: "Lead perguntou sobre o procedimento." },
      "concierge",
      undefined,
      undefined,
      "responder_e_parar",
    );
    expect(ctx).toContain("não faça perguntas de fechamento");
  });

  it("drive is ignored outside concierge (menu-first keeps its own guidance)", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "menu_first", undefined, undefined, "responder_e_parar");
    expect(ctx).not.toContain("não faça nenhuma pergunta");
  });
});

describe("ResponseComposer — model routing", () => {
  it("keeps Start on the standard composer model by default", () => {
    clearComposerModelEnv();

    expect(resolveComposerModel("start")).toBe("gpt-4o-mini");
  });

  it("routes Scale and custom plans to the premium composer model by default", () => {
    clearComposerModelEnv();

    expect(resolveComposerModel("scale")).toBe("gpt-5.5");
    expect(resolveComposerModel("scale")).toBe("gpt-5.5");
    expect(resolveComposerModel("enterprise")).toBe("gpt-5.5");
  });

  it("lets a global env override force all plans during replay or benchmark", () => {
    clearComposerModelEnv();
    vi.stubEnv("OPENAI_COMPOSER_MODEL", "gpt-5.4");

    expect(resolveComposerModel("start")).toBe("gpt-5.4");
    expect(resolveComposerModel("growth")).toBe("gpt-5.4");
  });

  it("lets Growth use a different model via override", () => {
    clearComposerModelEnv();
    vi.stubEnv("OPENAI_COMPOSER_MODEL_GROWTH", "gpt-5.4");

    expect(resolveComposerModel("growth")).toBe("gpt-5.4");
    expect(resolveComposerModel("scale")).toBe("gpt-5.5");
  });

  it("uses Responses API for GPT-5 family unless explicitly forced to chat", () => {
    clearComposerModelEnv();

    expect(shouldUseResponsesApi("gpt-5.5")).toBe(true);
    expect(shouldUseResponsesApi("gpt-4o-mini")).toBe(false);

    vi.stubEnv("OPENAI_COMPOSER_API", "chat");
    expect(shouldUseResponsesApi("gpt-5.5")).toBe(false);

    vi.stubEnv("OPENAI_COMPOSER_API", "responses");
    expect(shouldUseResponsesApi("gpt-4o-mini")).toBe(true);
  });
});
