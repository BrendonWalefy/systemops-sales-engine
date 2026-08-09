import { describe, expect, it } from "vitest";
import { buildAuthorizedResponsePlan } from "@/core/conversation/response-plan-builder";

const slotA = {
  index: 1,
  startsAt: "2026-08-10T17:00:00.000Z",
  endsAt: "2026-08-10T18:00:00.000Z",
  label: "Seg 10/08 às 14h",
};

describe("buildAuthorizedResponsePlan", () => {
  it("autoriza apenas preços explícitos das fontes canônicas", () => {
    const plan = buildAuthorizedResponsePlan({
      actionResult: { type: "price_inquiry", referencedPriceCents: 180_000 },
      commercialPolicy: "Pacote cadastrado: R$ 2.400,00 à vista; prazo de 10 dias.",
      installmentTable: "10x de R$ 270,00",
      allowedMediaIds: [],
      expectedState: "idle",
      maxCharacters: 420,
    });

    expect(plan.allowedPriceCents).toEqual([27_000, 180_000, 240_000]);
  });

  it("autoriza somente labels de agenda retornadas pela ação", () => {
    const plan = buildAuthorizedResponsePlan({
      actionResult: {
        type: "slots_found",
        askedForPreference: false,
        slots: [slotA],
      },
      commercialPolicy: null,
      installmentTable: null,
      allowedMediaIds: ["video-b", "video-a", "video-a"],
      expectedState: "awaiting_confirmation",
      maxCharacters: 500,
    });

    expect(plan.allowedScheduleFacts).toEqual(["Seg 10/08 às 14h"]);
    expect(plan.allowedMediaIds).toEqual(["video-a", "video-b"]);
    expect(plan.expectedState).toBe("awaiting_confirmation");
  });

  it("coleta labels de agendamentos e lembretes, mas não de ações sem agenda", () => {
    const listedPlan = buildAuthorizedResponsePlan({
      actionResult: {
        type: "appointments_listed",
        appointments: [
          { label: "Ter 11/08 às 09h", status: "scheduled" },
          { label: "Seg 10/08 às 14h", status: "confirmed" },
          { label: "Ter 11/08 às 09h", status: "scheduled" },
        ],
      },
      commercialPolicy: null,
      installmentTable: null,
      allowedMediaIds: [],
      expectedState: null,
      maxCharacters: 280,
    });
    const reminderPlan = buildAuthorizedResponsePlan({
      actionResult: { type: "appointment_reminder", appointmentLabel: "Qua 12/08 às 10h" },
      commercialPolicy: null,
      installmentTable: null,
      allowedMediaIds: [],
      expectedState: "idle",
      maxCharacters: 280,
    });
    const greetingPlan = buildAuthorizedResponsePlan({
      actionResult: { type: "greeting" },
      commercialPolicy: null,
      installmentTable: null,
      allowedMediaIds: [],
      expectedState: "idle",
      maxCharacters: 280,
    });

    expect(listedPlan.allowedScheduleFacts).toEqual(["Seg 10/08 às 14h", "Ter 11/08 às 09h"]);
    expect(listedPlan.expectedState).toBe("none");
    expect(reminderPlan.allowedScheduleFacts).toEqual(["Qua 12/08 às 10h"]);
    expect(greetingPlan.allowedScheduleFacts).toEqual([]);
  });

  it("preserva os limites e a versão estável do contrato", () => {
    const plan = buildAuthorizedResponsePlan({
      actionResult: { type: "greeting" },
      commercialPolicy: null,
      installmentTable: null,
      allowedMediaIds: [],
      expectedState: "idle",
      maxCharacters: 420,
    });

    expect(plan).toMatchObject({
      version: "response-plan.v1",
      action: "greeting",
      maxQuestions: 1,
      maxCharacters: 420,
      expectedState: "idle",
    });
  });
});
