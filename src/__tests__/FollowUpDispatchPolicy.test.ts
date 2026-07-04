import { describe, expect, it } from "vitest";

import type { FollowUp } from "@/domain/entities/follow-up";
import {
  selectOneFollowUpPerLead,
  shouldSuppressFollowUpForOperatorActivity,
  OPERATOR_ACTIVE_WINDOW_MS,
} from "@/application/use-cases/leads/follow-up-dispatch-policy";

function makeFollowUp(overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "fu-1",
    clinicId: "clinic-1",
    leadId: "lead-1",
    dueAt: new Date("2026-06-11T10:00:00Z"),
    status: "pending",
    reason: "Lead inativo — segunda chance",
    suggestedMessage: null,
    completedAt: null,
    createdAt: new Date("2026-06-11T09:00:00Z"),
    updatedAt: new Date("2026-06-11T09:00:00Z"),
    ...overrides,
  };
}

describe("selectOneFollowUpPerLead", () => {
  it("mantém só o primeiro follow-up por lead e deixa o restante como deferred", () => {
    const firstLead = makeFollowUp({ id: "fu-1", leadId: "lead-1" });
    const sameLeadLater = makeFollowUp({ id: "fu-2", leadId: "lead-1", reason: "video_sent:Video A" });
    const secondLead = makeFollowUp({ id: "fu-3", leadId: "lead-2" });

    const result = selectOneFollowUpPerLead([firstLead, sameLeadLater, secondLead]);

    expect(result.selected.map((followUp) => followUp.id)).toEqual(["fu-1", "fu-3"]);
    expect(result.deferred.map((followUp) => followUp.id)).toEqual(["fu-2"]);
  });

  it("preserva todos quando cada follow-up pertence a um lead diferente", () => {
    const result = selectOneFollowUpPerLead([
      makeFollowUp({ id: "fu-1", leadId: "lead-1" }),
      makeFollowUp({ id: "fu-2", leadId: "lead-2" }),
    ]);

    expect(result.selected).toHaveLength(2);
    expect(result.deferred).toHaveLength(0);
  });
});

describe("shouldSuppressFollowUpForOperatorActivity — operador ativo suprime reengajamento (F4)", () => {
  const now = new Date("2026-07-04T15:00:00Z");

  it("suprime quando a IA está pausada (takeover humano)", () => {
    expect(
      shouldSuppressFollowUpForOperatorActivity({
        aiPaused: true,
        lastMessageAuthor: "lead",
        lastMessageSentAt: new Date("2026-07-01T10:00:00Z"),
        now,
      }),
    ).toBe(true);
  });

  it("suprime quando a última mensagem é de clinic_user dentro da janela de 12h", () => {
    expect(
      shouldSuppressFollowUpForOperatorActivity({
        aiPaused: false,
        lastMessageAuthor: "clinic_user",
        lastMessageSentAt: new Date("2026-07-04T08:00:00Z"), // 7h atrás
        now,
      }),
    ).toBe(true);
  });

  it("não suprime quando a mensagem do operador é mais antiga que a janela", () => {
    expect(
      shouldSuppressFollowUpForOperatorActivity({
        aiPaused: false,
        lastMessageAuthor: "clinic_user",
        lastMessageSentAt: new Date(now.getTime() - OPERATOR_ACTIVE_WINDOW_MS - 60_000),
        now,
      }),
    ).toBe(false);
  });

  it("não suprime quando a última mensagem é do lead ou da IA", () => {
    expect(
      shouldSuppressFollowUpForOperatorActivity({
        aiPaused: false,
        lastMessageAuthor: "lead",
        lastMessageSentAt: new Date("2026-07-04T14:59:00Z"),
        now,
      }),
    ).toBe(false);
    expect(
      shouldSuppressFollowUpForOperatorActivity({
        aiPaused: false,
        lastMessageAuthor: "agent",
        lastMessageSentAt: new Date("2026-07-04T14:59:00Z"),
        now,
      }),
    ).toBe(false);
  });

  it("não suprime conversa sem mensagens", () => {
    expect(
      shouldSuppressFollowUpForOperatorActivity({
        aiPaused: false,
        lastMessageAuthor: null,
        lastMessageSentAt: null,
        now,
      }),
    ).toBe(false);
  });
});
