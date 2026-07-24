import { describe, expect, it, vi } from "vitest";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import { ReplayCalendarCapture } from "@/application/replay/replay-calendar-capture";

function readGateway(): CalendarGateway {
  return {
    listAvailableSlots: vi.fn().mockResolvedValue([{
      startsAt: new Date("2026-07-27T12:00:00.000Z"),
      endsAt: new Date("2026-07-27T13:00:00.000Z"),
      professionalId: null,
      source: "manual",
    }]),
    listBlockEvents: vi.fn().mockResolvedValue([]),
    isSlotFree: vi.fn().mockResolvedValue(true),
    createAppointment: vi.fn().mockRejectedValue(new Error("must not write")),
    cancelAppointment: vi.fn().mockRejectedValue(new Error("must not write")),
    updateCalendarEvent: vi.fn().mockRejectedValue(new Error("must not write")),
    createBlockEvent: vi.fn().mockRejectedValue(new Error("must not write")),
    deleteBlockEvent: vi.fn().mockRejectedValue(new Error("must not write")),
    updateBlockEvent: vi.fn().mockRejectedValue(new Error("must not write")),
  };
}

describe("ReplayCalendarCapture", () => {
  it("delega leituras à fotografia e captura escrita de appointment", async () => {
    const source = readGateway();
    const capture = new ReplayCalendarCapture(source);
    const slots = await capture.listAvailableSlots({
      clinicId: "clinic-a",
      from: new Date("2026-07-27T00:00:00.000Z"),
      to: new Date("2026-07-28T00:00:00.000Z"),
      slotDurationMinutes: 60,
    });
    const appointment = await capture.createAppointment({
      clinicId: "clinic-a",
      leadId: "lead-a",
      startsAt: slots[0]!.startsAt,
      endsAt: slots[0]!.endsAt,
      title: "Avaliação — Lead replay",
    });

    expect(source.listAvailableSlots).toHaveBeenCalledOnce();
    expect(source.createAppointment).not.toHaveBeenCalled();
    expect(appointment.calendarEventId).toMatch(/^replay-calendar-/);
    expect(capture.effects).toEqual([
      expect.objectContaining({
        sequence: 1,
        kind: "appointment.create",
        clinicId: "clinic-a",
        title: "Avaliação — Lead replay",
      }),
    ]);
  });

  it("captura cancelamento, atualização e bloqueios sem chamar writers", async () => {
    const source = readGateway();
    const capture = new ReplayCalendarCapture(source);
    const startsAt = new Date("2026-07-27T12:00:00.000Z");
    const endsAt = new Date("2026-07-27T13:00:00.000Z");

    await capture.cancelAppointment({ calendarEventId: "existing-1" });
    await capture.updateCalendarEvent({
      calendarEventId: "existing-1",
      startsAt,
      endsAt,
    });
    const block = await capture.createBlockEvent({
      clinicId: "clinic-a",
      startsAt,
      endsAt,
      reason: "Reunião",
    });
    await capture.updateBlockEvent({
      calendarEventId: block.calendarEventId,
      startsAt,
      endsAt,
      reason: "Reunião alterada",
    });
    await capture.deleteBlockEvent({ calendarEventId: block.calendarEventId });

    expect(capture.effects.map((effect) => effect.kind)).toEqual([
      "appointment.cancel",
      "appointment.update",
      "block.create",
      "block.update",
      "block.delete",
    ]);
    expect(source.cancelAppointment).not.toHaveBeenCalled();
    expect(source.updateCalendarEvent).not.toHaveBeenCalled();
  });
});
