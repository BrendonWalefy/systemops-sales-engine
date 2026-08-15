import { describe, expect, it } from "vitest";
import { validateComposedResponse } from "@/core/conversation/response-validator";
import type { AuthorizedResponsePlan } from "@/core/conversation/response-plan";

const basePlan: AuthorizedResponsePlan = {
  version: "response-plan.v1",
  action: "general_question",
  allowedPriceCents: [],
  allowedScheduleFacts: [],
  allowedMediaIds: [],
  allowedServices: [],
  maxQuestions: 1,
  maxCharacters: 420,
  expectedState: "idle",
};

const makePlan = (
  overrides: Partial<AuthorizedResponsePlan> = {},
): AuthorizedResponsePlan => ({ ...basePlan, ...overrides });

describe("validateComposedResponse", () => {
  it.each([
    ["", "empty_response"],
    ["O valor é R$ 9.999,00.", "unauthorized_price"],
    ["Tenho terça às 19h.", "unauthorized_schedule_fact"],
    ["O resultado é 100% garantido.", "unsupported_guarantee"],
  ] as const)("recusa %s com %s", (text, code) => {
    const result = validateComposedResponse({
      plan: makePlan(),
      response: { text, parts: text ? [{ type: "text", content: text }] : [] },
    });

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(result.violations).toContain(code);
  });

  it("aceita preço, slot e mídia presentes no plano", () => {
    const result = validateComposedResponse({
      plan: makePlan({
        allowedPriceCents: [240_000],
        allowedScheduleFacts: ["Seg 10/08 às 14h"],
        allowedMediaIds: ["case-1"],
      }),
      response: {
        text: "O valor é R$ 2.400,00. Tenho Seg 10/08 às 14h. Qual prefere?",
        parts: [
          { type: "text", content: "O valor é R$ 2.400,00. Tenho Seg 10/08 às 14h. Qual prefere?" },
          { type: "media", id: "case-1" },
        ],
      },
    });

    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("recusa limites e mídia desconhecida em ordem estável", () => {
    const result = validateComposedResponse({
      plan: makePlan({ maxCharacters: 1, maxQuestions: 1 }),
      response: {
        text: "Oi??",
        parts: [
          { type: "text", content: "Oi??" },
          { type: "media", id: "not-authorized" },
          { type: "media", id: "not-authorized" },
        ],
      },
    });

    expect(result).toEqual({
      ok: false,
      violations: ["response_too_long", "too_many_questions", "unauthorized_media"],
    });
  });

  it("recusa valor de parcela e preço em reais fora do plano", () => {
    const result = validateComposedResponse({
      plan: makePlan(),
      response: {
        text: "Fica em 10x de 240,00 ou 2.400 reais.",
        parts: [{ type: "text", content: "Fica em 10x de 240,00 ou 2.400 reais." }],
      },
    });

    expect(result).toEqual({ ok: false, violations: ["unauthorized_price"] });
  });

  it("aceita label de agenda equivalente após normalização", () => {
    const result = validateComposedResponse({
      plan: makePlan({ allowedScheduleFacts: ["Seg 10/08 às 14h"] }),
      response: {
        text: "Tenho segunda 10/08 às 14:00.",
        parts: [{ type: "text", content: "Tenho segunda 10/08 às 14:00." }],
      },
    });

    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("valida todas as claims emitidas em partes de texto divergentes", () => {
    const result = validateComposedResponse({
      plan: makePlan(),
      response: {
        text: "Tudo certo.",
        parts: [{
          type: "text",
          content: "O valor é R$ 9.999,00. Tenho terça às 19h. O resultado é 100% garantido.",
        }],
      },
    });

    expect(result).toEqual({
      ok: false,
      violations: [
        "unauthorized_price",
        "unauthorized_schedule_fact",
        "unsupported_guarantee",
      ],
    });
  });

  it("aplica o limite de caracteres às legendas enviadas", () => {
    const result = validateComposedResponse({
      plan: makePlan({ allowedMediaIds: ["case-1"], maxCharacters: 10 }),
      response: {
        text: "Veja:",
        parts: [{ type: "media", id: "case-1", caption: "Uma legenda longa." }],
      },
    });

    expect(result).toEqual({ ok: false, violations: ["response_too_long"] });
  });

  it.each([
    "Resultados garantidos.",
    "Garantimos resultados.",
    "É risco zero.",
  ])("normaliza promessa proibida: %s", (text) => {
    const result = validateComposedResponse({
      plan: makePlan(),
      response: { text, parts: [{ type: "text", content: text }] },
    });

    expect(result).toEqual({ ok: false, violations: ["unsupported_guarantee"] });
  });

  it.each([
    "Tenho disponibilidade em 11/08.",
    "Tenho na terça-feira.",
  ])("recusa disponibilidade sem horário fora do plano: %s", (text) => {
    const result = validateComposedResponse({
      plan: makePlan(),
      response: { text, parts: [{ type: "text", content: text }] },
    });

    expect(result).toEqual({ ok: false, violations: ["unauthorized_schedule_fact"] });
  });

  it.each([
    "Tenho disponibilidade em 10/08.",
    "Tenho na segunda-feira.",
  ])("aceita disponibilidade parcial presente no plano: %s", (text) => {
    const result = validateComposedResponse({
      plan: makePlan({ allowedScheduleFacts: ["Seg 10/08 às 14h"] }),
      response: { text, parts: [{ type: "text", content: text }] },
    });

    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("não confunde duração de procedimento com horário de agenda", () => {
    const text = "O procedimento costuma durar 1h.";
    const result = validateComposedResponse({
      plan: makePlan(),
      response: { text, parts: [{ type: "text", content: text }] },
    });

    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("aplica limites às partes de texto divergentes", () => {
    const result = validateComposedResponse({
      plan: makePlan({ maxCharacters: 12, maxQuestions: 1 }),
      response: {
        text: "Tudo certo.",
        parts: [{ type: "text", content: "Qual opção? Pode confirmar?" }],
      },
    });

    expect(result).toEqual({
      ok: false,
      violations: ["response_too_long", "too_many_questions"],
    });
  });
});
