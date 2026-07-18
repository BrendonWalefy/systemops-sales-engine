import { describe, expect, it } from "vitest";
import { buildActionContext } from "@/core/intelligence/ResponseComposer";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";

const slots: FormattedSlot[] = [
  {
    index: 1,
    startsAt: "2026-07-20T12:00:00.000Z",
    endsAt: "2026-07-20T13:00:00.000Z",
    label: "Seg 20/07 às 09h",
  },
  {
    index: 2,
    startsAt: "2026-07-21T19:00:00.000Z",
    endsAt: "2026-07-21T20:00:00.000Z",
    label: "Ter 21/07 às 16h",
  },
];

describe("slot offer copy", () => {
  it("instrui respostas de horários a pedir só o número e avisar a validade", () => {
    const contexts = [
      buildActionContext({ type: "slots_found", slots, askedForPreference: false }),
      buildActionContext({ type: "appointment_rescheduled", newSlots: slots }),
      buildActionContext({ type: "slots_expired", freshSlots: slots, preferredSlotIndex: 2 }),
      buildActionContext({ type: "slot_taken_reoffered", newSlots: slots }),
      buildActionContext({ type: "evaluation_redirect", treatmentName: "Lentes", evaluationSlots: slots }),
    ];

    for (const context of contexts) {
      expect(context).toContain("APENAS com o número");
      expect(context).toContain("15 minutos");
      expect(context).toContain("1. Seg 20/07 às 09h");
      expect(context).toContain("2. Ter 21/07 às 16h");
    }
  });
});
