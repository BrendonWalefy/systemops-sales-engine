import { describe, expect, it } from "vitest";
import { buildInboxSnapshotSignature } from "@/app/(clinic)/app/inbox/inbox-snapshot";

describe("buildInboxSnapshotSignature", () => {
  it("gera a mesma assinatura independente da ordem das conversas", () => {
    const a = buildInboxSnapshotSignature([
      {
        convId: "b",
        conversationUpdatedAt: "2026-06-16T12:00:00.000Z",
        leadUpdatedAt: "2026-06-16T12:00:00.000Z",
        lastMessageAt: "2026-06-16T12:00:00.000Z",
        lastReadAt: null,
        aiPaused: false,
        needsAttention: false,
        takeoverExpiresAt: null,
        conversationCategory: "sales",
        leadStatus: "active",
        leadTemperature: "warm",
        appointmentStartsAt: null,
        latestAppointmentStatus: null,
        latestAppointmentUpdatedAt: null,
      },
      {
        convId: "a",
        conversationUpdatedAt: "2026-06-16T11:00:00.000Z",
        leadUpdatedAt: "2026-06-16T11:00:00.000Z",
        lastMessageAt: "2026-06-16T11:00:00.000Z",
        lastReadAt: null,
        aiPaused: true,
        needsAttention: true,
        takeoverExpiresAt: "2026-06-16T13:00:00.000Z",
        conversationCategory: "sales",
        leadStatus: "appointment_scheduled",
        leadTemperature: "hot",
        appointmentStartsAt: "2026-06-17T11:00:00.000Z",
        latestAppointmentStatus: "scheduled",
        latestAppointmentUpdatedAt: "2026-06-16T11:00:00.000Z",
      },
    ]);

    const b = buildInboxSnapshotSignature([
      {
        convId: "a",
        conversationUpdatedAt: "2026-06-16T11:00:00.000Z",
        leadUpdatedAt: "2026-06-16T11:00:00.000Z",
        lastMessageAt: "2026-06-16T11:00:00.000Z",
        lastReadAt: null,
        aiPaused: true,
        needsAttention: true,
        takeoverExpiresAt: "2026-06-16T13:00:00.000Z",
        conversationCategory: "sales",
        leadStatus: "appointment_scheduled",
        leadTemperature: "hot",
        appointmentStartsAt: "2026-06-17T11:00:00.000Z",
        latestAppointmentStatus: "scheduled",
        latestAppointmentUpdatedAt: "2026-06-16T11:00:00.000Z",
      },
      {
        convId: "b",
        conversationUpdatedAt: "2026-06-16T12:00:00.000Z",
        leadUpdatedAt: "2026-06-16T12:00:00.000Z",
        lastMessageAt: "2026-06-16T12:00:00.000Z",
        lastReadAt: null,
        aiPaused: false,
        needsAttention: false,
        takeoverExpiresAt: null,
        conversationCategory: "sales",
        leadStatus: "active",
        leadTemperature: "warm",
        appointmentStartsAt: null,
        latestAppointmentStatus: null,
        latestAppointmentUpdatedAt: null,
      },
    ]);

    expect(a).toBe(b);
  });

  it("muda a assinatura quando muda algum campo relevante da inbox", () => {
    const base = buildInboxSnapshotSignature(
      [{
        convId: "a",
        conversationUpdatedAt: "2026-06-16T11:00:00.000Z",
        leadUpdatedAt: "2026-06-16T11:00:00.000Z",
        lastMessageAt: "2026-06-16T11:00:00.000Z",
        lastReadAt: null,
        aiPaused: false,
        needsAttention: false,
        takeoverExpiresAt: null,
        conversationCategory: "sales",
        leadStatus: "active",
        leadTemperature: "warm",
        appointmentStartsAt: null,
        latestAppointmentStatus: null,
        latestAppointmentUpdatedAt: null,
      }],
      { autoReplyEnabled: false, clinicUpdatedAt: "2026-06-16T10:00:00.000Z" },
    );

    const changed = buildInboxSnapshotSignature(
      [{
        convId: "a",
        conversationUpdatedAt: "2026-06-16T11:00:00.000Z",
        leadUpdatedAt: "2026-06-16T11:00:00.000Z",
        lastMessageAt: "2026-06-16T11:05:00.000Z",
        lastReadAt: null,
        aiPaused: false,
        needsAttention: false,
        takeoverExpiresAt: null,
        conversationCategory: "sales",
        leadStatus: "active",
        leadTemperature: "warm",
        appointmentStartsAt: null,
        latestAppointmentStatus: null,
        latestAppointmentUpdatedAt: null,
      }],
      { autoReplyEnabled: false, clinicUpdatedAt: "2026-06-16T10:00:00.000Z" },
    );

    expect(changed).not.toBe(base);
  });

  it("muda a assinatura quando a categoria da conversa muda", () => {
    const sales = buildInboxSnapshotSignature([{
      convId: "a",
      conversationUpdatedAt: "2026-06-16T11:00:00.000Z",
      leadUpdatedAt: "2026-06-16T11:00:00.000Z",
      lastMessageAt: "2026-06-16T11:00:00.000Z",
      lastReadAt: null,
      aiPaused: false,
      needsAttention: false,
      takeoverExpiresAt: null,
      conversationCategory: "sales",
      leadStatus: "active",
      leadTemperature: "warm",
      appointmentStartsAt: null,
      latestAppointmentStatus: null,
      latestAppointmentUpdatedAt: null,
    }]);

    const operational = buildInboxSnapshotSignature([{
      convId: "a",
      conversationUpdatedAt: "2026-06-16T11:00:00.000Z",
      leadUpdatedAt: "2026-06-16T11:00:00.000Z",
      lastMessageAt: "2026-06-16T11:00:00.000Z",
      lastReadAt: null,
      aiPaused: false,
      needsAttention: false,
      takeoverExpiresAt: null,
      conversationCategory: "operational",
      leadStatus: "active",
      leadTemperature: "warm",
      appointmentStartsAt: null,
      latestAppointmentStatus: null,
      latestAppointmentUpdatedAt: null,
    }]);

    expect(operational).not.toBe(sales);
  });

  it("muda a assinatura quando o status do último agendamento muda", () => {
    const scheduled = buildInboxSnapshotSignature([{
      convId: "a",
      conversationUpdatedAt: "2026-06-16T11:00:00.000Z",
      leadUpdatedAt: "2026-06-16T11:00:00.000Z",
      lastMessageAt: "2026-06-16T11:00:00.000Z",
      lastReadAt: null,
      aiPaused: false,
      needsAttention: false,
      takeoverExpiresAt: null,
      conversationCategory: "sales",
      leadStatus: "follow_up_due",
      leadTemperature: "warm",
      appointmentStartsAt: null,
      latestAppointmentStatus: "scheduled",
      latestAppointmentUpdatedAt: "2026-06-16T11:00:00.000Z",
    }]);

    const noShow = buildInboxSnapshotSignature([{
      convId: "a",
      conversationUpdatedAt: "2026-06-16T11:00:00.000Z",
      leadUpdatedAt: "2026-06-16T11:00:00.000Z",
      lastMessageAt: "2026-06-16T11:00:00.000Z",
      lastReadAt: null,
      aiPaused: false,
      needsAttention: false,
      takeoverExpiresAt: null,
      conversationCategory: "sales",
      leadStatus: "follow_up_due",
      leadTemperature: "warm",
      appointmentStartsAt: null,
      latestAppointmentStatus: "no_show",
      latestAppointmentUpdatedAt: "2026-06-16T11:05:00.000Z",
    }]);

    expect(noShow).not.toBe(scheduled);
  });
});
