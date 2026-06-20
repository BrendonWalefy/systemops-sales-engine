import { describe, expect, it } from "vitest";
import {
  isRecoveryCandidate,
  resolveAppointmentLifecycleState,
  resolvePipelineIndex,
  type InboxPresentationRow,
} from "@/app/(clinic)/app/inbox/inbox-presentation";

function makeRow(overrides: Partial<InboxPresentationRow> = {}): InboxPresentationRow {
  return {
    aiPaused: false,
    needsAttention: false,
    takeoverExpiresAt: null,
    lastMessageAt: new Date("2026-06-20T12:00:00.000Z"),
    hoursWaiting: 0,
    leadStatus: "in_conversation",
    conversationCategory: "sales",
    latestAppointmentStatus: null,
    latestAppointmentUpdatedAt: null,
    ...overrides,
  };
}

describe("inbox presentation rules", () => {
  it("mantém no_show em recuperação enquanto o lead não responder depois do status", () => {
    const row = makeRow({
      leadStatus: "follow_up_due",
      latestAppointmentStatus: "no_show",
      latestAppointmentUpdatedAt: new Date("2026-06-20T12:30:00.000Z"),
      lastMessageAt: new Date("2026-06-20T12:00:00.000Z"),
    });

    expect(resolveAppointmentLifecycleState(row, { author: "agent" })).toBe("no_show");
    expect(isRecoveryCandidate(row, { author: "agent" })).toBe(true);
    expect(resolvePipelineIndex(row, { author: "agent" })).toBe(3);
  });

  it("remove o estado de cancelado quando o lead volta a falar depois do cancelamento", () => {
    const row = makeRow({
      latestAppointmentStatus: "cancelled",
      latestAppointmentUpdatedAt: new Date("2026-06-20T11:00:00.000Z"),
      lastMessageAt: new Date("2026-06-20T12:00:00.000Z"),
    });

    expect(resolveAppointmentLifecycleState(row, { author: "lead" })).toBe("none");
    expect(isRecoveryCandidate(row, { author: "lead" })).toBe(false);
  });

  it("leva consulta futura confirmada até o fim do pipeline", () => {
    const row = makeRow({
      leadStatus: "appointment_scheduled",
      latestAppointmentStatus: "confirmed",
      latestAppointmentUpdatedAt: new Date("2026-06-20T11:00:00.000Z"),
    });

    expect(resolvePipelineIndex(row, { author: "agent" })).toBe(4);
  });
});

