import { describe, expect, it } from "vitest";
import { buildSafeResponseFallback } from "@/core/conversation/safe-response-fallback";
import type { AuthorizedResponsePlan } from "@/core/conversation/response-plan";

const slotA = {
  index: 1,
  startsAt: "2026-08-10T17:00:00.000Z",
  endsAt: "2026-08-10T18:00:00.000Z",
  label: "Seg 10/08 às 14h",
};
const slotB = {
  index: 2,
  startsAt: "2026-08-11T18:00:00.000Z",
  endsAt: "2026-08-11T19:00:00.000Z",
  label: "Ter 11/08 às 15h",
};
const makePlan = (
  overrides: Partial<AuthorizedResponsePlan> = {},
): AuthorizedResponsePlan => ({
  version: "response-plan.v1",
  action: "slots_found",
  allowedPriceCents: [],
  allowedScheduleFacts: [],
  allowedMediaIds: [],
  maxQuestions: 1,
  maxCharacters: 500,
  expectedState: "slots_offered",
  ...overrides,
});

describe("buildSafeResponseFallback", () => {
  it("lista somente os slots autorizados", () => {
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "slots_found", askedForPreference: false, slots: [slotA, slotB] },
      plan: makePlan({ allowedScheduleFacts: [slotA.label] }),
      reason: "composer_error",
    });

    expect(fallback.response.text).toContain(slotA.label);
    expect(fallback.response.text).not.toContain(slotB.label);
    expect(fallback.response.mediaIds).toEqual([]);
    expect(fallback.requiresHandoff).toBe(false);
  });

  it("não inventa resposta editorial quando a composição é insegura", () => {
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "general_question", clinicContext: "contexto interno" },
      plan: makePlan(),
      reason: "response_plan_violation",
    });

    expect(fallback.response.text).toBe(
      "Quero te responder isso com precisão. Vou chamar nossa equipe para confirmar e continuar por aqui.",
    );
    expect(fallback.requiresHandoff).toBe(true);
  });

  it("preserva a cópia aprovada para quantidade sem preço cadastrado", () => {
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "quantity_price_confirmation_required", quantity: 10, scope: "superior" },
      plan: makePlan({ action: "quantity_price_confirmation_required" }),
      reason: "composer_error",
    });

    expect(fallback.response.text).toBe(
      "Entendi que você quer harmonizar 10 dentes superiores. Como essa combinação não está cadastrada como pacote fechado, não vou te passar um valor aproximado. Já sinalizei a equipe para confirmar o valor exato e orientar a avaliação.",
    );
    expect(fallback.requiresHandoff).toBe(false);
  });

  it("preserva a cópia aprovada para avaliação clínica", () => {
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "clinical_evaluation_required", reason: "esse procedimento" },
      plan: makePlan({ action: "clinical_evaluation_required" }),
      reason: "composer_error",
    });

    expect(fallback.response.text).toBe(
      "Entendi o que aconteceu com esse procedimento. Como esse caso precisa ser avaliado pelo Doutor, não vou confirmar técnica ou valor por mensagem. Já sinalizei a equipe para orientar o próximo passo e montar o orçamento correto.",
    );
    expect(fallback.requiresHandoff).toBe(false);
  });
});
