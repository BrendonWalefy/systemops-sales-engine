import { describe, expect, it } from "vitest";
import { validateComposedResponse } from "@/core/conversation/response-validator";
import type { AuthorizedResponsePlan } from "@/core/conversation/response-plan";

const basePlan: AuthorizedResponsePlan = {
  version: "response-plan.v1",
  action: "general_question",
  allowedPriceCents: [],
  allowedScheduleFacts: [],
  allowedMediaIds: [],
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
});
