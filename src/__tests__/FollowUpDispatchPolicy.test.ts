import { describe, expect, it } from "vitest";

import type { FollowUp } from "@/domain/entities/follow-up";
import { selectOneFollowUpPerLead } from "@/application/use-cases/leads/follow-up-dispatch-policy";

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
