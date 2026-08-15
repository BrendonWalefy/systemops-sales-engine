import { describe, expect, it } from "vitest";
import { buildSafeResponseFallback } from "@/core/conversation/safe-response-fallback";
import type { AuthorizedResponsePlan } from "@/core/conversation/response-plan";
import { validateComposedResponse } from "@/core/conversation/response-validator";
import type { ActionResult } from "@/core/intelligence/ResponseComposer";

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
  allowedServices: [],
  maxQuestions: 1,
  maxCharacters: 500,
  expectedState: "slots_offered",
  ...overrides,
});

const neutralHandoff =
  "Quero te responder isso com precisão. Vou chamar nossa equipe para confirmar e continuar por aqui.";

function expectValidFallback(
  fallback: ReturnType<typeof buildSafeResponseFallback>,
  plan: AuthorizedResponsePlan,
) {
  expect(validateComposedResponse({ plan, response: fallback.response })).toEqual({
    ok: true,
    violations: [],
  });
}

describe("buildSafeResponseFallback", () => {
  it("lista somente os slots autorizados", () => {
    const plan = makePlan({ allowedScheduleFacts: [slotA.label] });
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "slots_found", askedForPreference: false, slots: [slotA, slotB] },
      plan,
      reason: "composer_error",
    });

    expect(fallback.response.text).toContain(slotA.label);
    expect(fallback.response.text).not.toContain(slotB.label);
    expect(fallback.response.mediaIds).toEqual([]);
    expect(fallback.requiresHandoff).toBe(false);
    expectValidFallback(fallback, plan);
  });

  it.each<{
    name: string;
    actionResult: ActionResult;
  }>([
    {
      name: "confirmação",
      actionResult: { type: "appointment_confirmed", slot: slotA, clinicName: "Clínica" },
    },
    {
      name: "reagendamento",
      actionResult: { type: "appointment_rescheduled", newSlots: [slotA, slotB] },
    },
    {
      name: "lista de agendamentos",
      actionResult: {
        type: "appointments_listed",
        appointments: [
          { label: slotA.label, status: "scheduled" },
          { label: slotB.label, status: "scheduled" },
        ],
      },
    },
    {
      name: "slot ocupado",
      actionResult: { type: "slot_taken_reoffered", newSlots: [slotA, slotB] },
    },
    {
      name: "slots expirados",
      actionResult: { type: "slots_expired", freshSlots: [slotA, slotB] },
    },
    {
      name: "redirecionamento para avaliação",
      actionResult: {
        type: "evaluation_redirect",
        treatmentName: "Tratamento",
        evaluationSlots: [slotA, slotB],
      },
    },
    {
      name: "slots alternativos",
      actionResult: { type: "no_slots_available", alternativeSlots: [slotA, slotB] },
    },
    {
      name: "lembrete",
      actionResult: { type: "appointment_reminder", appointmentLabel: slotA.label },
    },
    {
      name: "lembrete com confirmação",
      actionResult: {
        type: "appointment_reminder_with_confirmation",
        appointmentLabel: slotA.label,
      },
    },
    {
      name: "confirmação aceita",
      actionResult: {
        type: "appointment_confirmation_accepted",
        appointmentLabel: slotA.label,
      },
    },
  ])("emite somente labels autorizados em $name", ({ actionResult }) => {
    const plan = makePlan({
      action: actionResult.type,
      allowedScheduleFacts: [slotA.label],
    });
    const fallback = buildSafeResponseFallback({
      actionResult,
      plan,
      reason: "composer_error",
    });

    expect(fallback.response.text).toContain(slotA.label);
    expect(fallback.response.text).not.toContain(slotB.label);
    expect(fallback.requiresHandoff).toBe(false);
    expectValidFallback(fallback, plan);
  });

  it("faz handoff neutro quando nenhum label de agenda é autorizado", () => {
    const plan = makePlan();
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "slots_found", askedForPreference: false, slots: [slotA] },
      plan,
      reason: "response_plan_violation",
    });

    expect(fallback.response.text).toBe(neutralHandoff);
    expect(fallback.requiresHandoff).toBe(true);
    expectValidFallback(fallback, plan);
  });

  it("não inventa resposta editorial quando a composição é insegura", () => {
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "general_question", clinicContext: "contexto interno" },
      plan: makePlan(),
      reason: "response_plan_violation",
    });

    expect(fallback.response).toEqual({
      parts: [{ type: "text", content: neutralHandoff }],
      text: neutralHandoff,
      mediaIds: [],
      model: "deterministic-fallback",
      promptVersion: "response-fallback.v1",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(fallback.requiresHandoff).toBe(true);
    expect(fallback.reason).toBe("response_plan_violation");
    expectValidFallback(fallback, makePlan());
  });

  it("reduz o handoff para respeitar um limite positivo adversarial", () => {
    const plan = makePlan({ maxCharacters: 1 });
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "general_question", clinicContext: "contexto interno" },
      plan,
      reason: "response_plan_violation",
    });

    expect(fallback.response.text).toBe("!");
    expect(fallback.requiresHandoff).toBe(true);
    expectValidFallback(fallback, plan);
  });

  it("retorna o menor handoff não vazio quando o plano torna validação impossível", () => {
    const plan = makePlan({ maxCharacters: 0 });
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "general_question", clinicContext: "contexto interno" },
      plan,
      reason: "composer_error",
    });

    expect(fallback.response.text).toBe("!");
    expect(fallback.requiresHandoff).toBe(true);
    expect(validateComposedResponse({ plan, response: fallback.response })).toEqual({
      ok: false,
      violations: ["response_too_long"],
    });
  });

  it("preserva a cópia aprovada para quantidade sem preço cadastrado", () => {
    const plan = makePlan({ action: "quantity_price_confirmation_required" });
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "quantity_price_confirmation_required", quantity: 10, scope: "superior" },
      plan,
      reason: "composer_error",
    });

    expect(fallback.response.text).toBe(
      "Entendi que você quer harmonizar 10 dentes superiores. Como essa combinação não está cadastrada como pacote fechado, não vou te passar um valor aproximado. Já sinalizei a equipe para confirmar o valor exato e orientar a avaliação.",
    );
    expect(fallback.requiresHandoff).toBe(false);
    expectValidFallback(fallback, plan);
  });

  it("substitui cópia dinâmica que excede o limite do plano sem truncar fatos", () => {
    const plan = makePlan({
      action: "quantity_price_confirmation_required",
      maxCharacters: 1,
    });
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "quantity_price_confirmation_required", quantity: 10, scope: "superior" },
      plan,
      reason: "response_plan_violation",
    });

    expect(fallback.response.text).toBe("!");
    expect(fallback.response.text).not.toContain("10");
    expect(fallback.requiresHandoff).toBe(true);
    expectValidFallback(fallback, plan);
  });

  it("preserva a cópia aprovada para avaliação clínica", () => {
    const plan = makePlan({ action: "clinical_evaluation_required" });
    const fallback = buildSafeResponseFallback({
      actionResult: { type: "clinical_evaluation_required", reason: "dente fraturado" },
      plan,
      reason: "composer_error",
    });

    expect(fallback.response.text).toBe(
      "Entendi o que aconteceu com dente fraturado. Como esse caso precisa ser avaliado pelo Doutor, não vou confirmar técnica ou valor por mensagem. Já sinalizei a equipe para orientar o próximo passo e montar o orçamento correto.",
    );
    expect(fallback.requiresHandoff).toBe(false);
    expectValidFallback(fallback, plan);
  });

  it("não expõe razão clínica interna mesmo quando o validador não reconhece violações", () => {
    const plan = makePlan({ action: "clinical_evaluation_required" });
    const fallback = buildSafeResponseFallback({
      actionResult: {
        type: "clinical_evaluation_required",
        reason: "paciente sinalizado pela auditoria interna",
      },
      plan,
      reason: "composer_error",
    });

    expect(fallback.response.text).toBe(neutralHandoff);
    expect(fallback.response.text).not.toContain("auditoria interna");
    expect(fallback.requiresHandoff).toBe(true);
    expectValidFallback(fallback, plan);
  });

  it("não expõe razão clínica que viole o plano autorizado", () => {
    const plan = makePlan({ action: "clinical_evaluation_required" });
    const fallback = buildSafeResponseFallback({
      actionResult: {
        type: "clinical_evaluation_required",
        reason: "R$ 9.999, segunda às 14h e resultado garantido",
      },
      plan,
      reason: "response_plan_violation",
    });

    expect(fallback.response.text).toBe(neutralHandoff);
    expect(fallback.response.text).not.toContain("9.999");
    expect(fallback.requiresHandoff).toBe(true);
    expectValidFallback(fallback, plan);
  });
});
