import { describe, expect, it } from "vitest";
import { resolveExactRequestedSlot } from "@/core/pipeline/ConversationOrchestrator";
import { ClinicTimezone, type ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { computeAvailableSlots } from "@/core/scheduling/SlotEngine";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";

const tz = new ClinicTimezone("America/Sao_Paulo");

const businessHours: ParsedBusinessHours = {
  startHour: 8,
  startMinute: 0,
  endHour: 18,
  endMinute: 0,
  days: [1, 2, 3, 4, 5],
};

// Gateway fake apoiado na mesma engine pura usada em produção (paridade de lógica),
// mas com os eventos de agenda controlados diretamente pelo teste — sem banco.
function fakeGateway(existingEvents: { startsAt: Date; endsAt: Date }[]): CalendarGateway {
  return {
    listAvailableSlots: async (input) =>
      computeAvailableSlots({
        timezone: tz,
        businessHours,
        existingEvents,
        from: input.from,
        to: input.to,
        slotDurationMinutes: input.slotDurationMinutes,
        clinicId: input.clinicId,
      }),
    createAppointment: async () => {
      throw new Error("not used in this test");
    },
    cancelAppointment: async () => {
      throw new Error("not used in this test");
    },
    listBlockEvents: async () => [],
    createBlockEvent: async () => {
      throw new Error("not used in this test");
    },
    deleteBlockEvent: async () => {
      throw new Error("not used in this test");
    },
    updateBlockEvent: async () => {
      throw new Error("not used in this test");
    },
    isSlotFree: async () => true,
    updateCalendarEvent: async () => {
      throw new Error("not used in this test");
    },
  };
}

describe("resolveExactRequestedSlot", () => {
  // Terça-feira, 07/07/2026.
  const dayParts = { year: 2026, month: 6, day: 7, hour: 0, minute: 0, weekday: 2 };
  const windowStart = tz.fromLocalParts(2026, 6, 7, 0, 0);
  const windowEnd = tz.fromLocalParts(2026, 6, 14, 0, 0);

  it("oferece 15h mesmo quando a duração de 40min faz a grade pular esse horário redondo", async () => {
    // Com slots de 40min ancorados em 8h, a grade natural é 8:00, 8:40, ..., 14:40, 15:20 —
    // 15:00 nunca é gerado, mas está genuinamente livre (nenhum evento conflita).
    const gateway = fakeGateway([]);

    const result = await resolveExactRequestedSlot({
      calendarGateway: gateway,
      clinicId: "clinic-test",
      dayParts,
      preferredTime: "15h",
      businessHours,
      timezone: tz,
      durationMinutes: 40,
      windowStart,
      windowEnd,
      localAppointments: [],
      postAppointmentBufferMinutes: 0,
    });

    expect(result).not.toBeNull();
    const local = tz.toLocalParts(result!.startsAt);
    expect(`${local.hour}:${String(local.minute).padStart(2, "0")}`).toBe("15:00");
  });

  it("retorna null quando o horário pedido realmente conflita com um evento existente", async () => {
    const gateway = fakeGateway([
      { startsAt: tz.fromLocalParts(2026, 6, 7, 15, 0), endsAt: tz.fromLocalParts(2026, 6, 7, 15, 40) },
    ]);

    const result = await resolveExactRequestedSlot({
      calendarGateway: gateway,
      clinicId: "clinic-test",
      dayParts,
      preferredTime: "15h",
      businessHours,
      timezone: tz,
      durationMinutes: 40,
      windowStart,
      windowEnd,
      localAppointments: [],
      postAppointmentBufferMinutes: 0,
    });

    expect(result).toBeNull();
  });

  it("retorna null quando o horário pedido conflita com um appointment local (defesa contra lag)", async () => {
    const gateway = fakeGateway([]);

    const result = await resolveExactRequestedSlot({
      calendarGateway: gateway,
      clinicId: "clinic-test",
      dayParts,
      preferredTime: "15h",
      businessHours,
      timezone: tz,
      durationMinutes: 40,
      windowStart,
      windowEnd,
      localAppointments: [
        { startsAt: tz.fromLocalParts(2026, 6, 7, 15, 0), endsAt: tz.fromLocalParts(2026, 6, 7, 15, 40) },
      ],
      postAppointmentBufferMinutes: 0,
    });

    expect(result).toBeNull();
  });

  it("normaliza hora ambígua para o período comercial (ex: '3' vira 15h quando cabe na janela)", async () => {
    const gateway = fakeGateway([]);

    const result = await resolveExactRequestedSlot({
      calendarGateway: gateway,
      clinicId: "clinic-test",
      dayParts,
      preferredTime: "3",
      businessHours,
      timezone: tz,
      durationMinutes: 40,
      windowStart,
      windowEnd,
      localAppointments: [],
      postAppointmentBufferMinutes: 0,
    });

    expect(result).not.toBeNull();
    expect(tz.toLocalParts(result!.startsAt).hour).toBe(15);
  });

  it("retorna null quando o horário pedido está fora do expediente", async () => {
    const gateway = fakeGateway([]);

    const result = await resolveExactRequestedSlot({
      calendarGateway: gateway,
      clinicId: "clinic-test",
      dayParts,
      preferredTime: "20h",
      businessHours,
      timezone: tz,
      durationMinutes: 40,
      windowStart,
      windowEnd,
      localAppointments: [],
      postAppointmentBufferMinutes: 0,
    });

    expect(result).toBeNull();
  });
});
