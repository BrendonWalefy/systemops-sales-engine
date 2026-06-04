import { describe, expect, it } from "vitest";
import { ClinicTimezone, type ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { computeAvailableSlots } from "@/core/scheduling/SlotEngine";

const tz = new ClinicTimezone("America/Sao_Paulo");

const businessHours: ParsedBusinessHours = {
  startHour: 8,
  startMinute: 0,
  endHour: 18,
  endMinute: 0,
  days: [1, 2, 3, 4, 5],
};

function localDate(hour: number, minute = 0): Date {
  return tz.fromLocalParts(2026, 0, 5, hour, minute);
}

function localTimeLabel(date: Date): string {
  const parts = tz.toLocalParts(date);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function slotStarts(input: Parameters<typeof computeAvailableSlots>[0]): string[] {
  return computeAvailableSlots(input).map((slot) => localTimeLabel(slot.startsAt));
}

describe("SlotEngine", () => {
  it("keeps the first slot after an event available when no buffer is configured", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [{ startsAt: localDate(9), endsAt: localDate(10) }],
      from: localDate(8),
      to: localDate(12),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
    });

    expect(starts).toEqual(["08:00", "10:00", "11:00"]);
  });

  it("blocks the hour immediately after each scheduled event when buffer is 60 minutes", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [{ startsAt: localDate(9), endsAt: localDate(10) }],
      from: localDate(8),
      to: localDate(12),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      postEventBufferMinutes: 60,
    });

    expect(starts).toEqual(["08:00", "11:00"]);
  });

  it.each([
    { bufferMinutes: 0, expected: ["08:00", "08:30", "10:00", "10:30", "11:00", "11:30"] },
    { bufferMinutes: 30, expected: ["08:00", "08:30", "10:30", "11:00", "11:30"] },
    { bufferMinutes: 60, expected: ["08:00", "08:30", "11:00", "11:30"] },
  ])(
    "changes available slots when post-event buffer is $bufferMinutes minutes",
    ({ bufferMinutes, expected }) => {
      const starts = slotStarts({
        timezone: tz,
        businessHours,
        existingEvents: [{ startsAt: localDate(9), endsAt: localDate(10) }],
        from: localDate(8),
        to: localDate(12),
        slotDurationMinutes: 30,
        clinicId: "clinic-test",
        postEventBufferMinutes: bufferMinutes,
      });

      expect(starts).toEqual(expected);
    },
  );

  it("requires a full buffer after non-hour-aligned events before offering a slot", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [{ startsAt: localDate(9, 30), endsAt: localDate(10, 30) }],
      from: localDate(9),
      to: localDate(13),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      postEventBufferMinutes: 60,
    });

    expect(starts).toEqual(["12:00"]);
  });

  it("returns no slot when revalidating a candidate inside the post-event buffer", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [{ startsAt: localDate(9), endsAt: localDate(10) }],
      from: localDate(10),
      to: localDate(11),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      postEventBufferMinutes: 60,
      maxSlots: 1,
    });

    expect(starts).toEqual([]);
  });

  it("allows revalidating the first candidate after an event when buffer is disabled", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [{ startsAt: localDate(9), endsAt: localDate(10) }],
      from: localDate(10),
      to: localDate(11),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      postEventBufferMinutes: 0,
      maxSlots: 1,
    });

    expect(starts).toEqual(["10:00"]);
  });

  // ── Cenários de tratamentos com duração variável + buffer (Ximendes Odontologia) ──

  it("20 Lentes (4h) + 60min buffer: próximo slot de 60min só aparece às 13h", () => {
    // Doutora agenda "20 Lentes" das 8h às 12h + 60min de intervalo
    // Pacientes com consultas de 60min só podem ser atendidos a partir das 13h
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [
        { startsAt: localDate(8), endsAt: localDate(12), appliesPostEventBuffer: true },
      ],
      from: localDate(8),
      to: localDate(18),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      postEventBufferMinutes: 60,
    });

    expect(starts).toEqual(["13:00", "14:00", "15:00", "16:00", "17:00"]);
  });

  it("20 Lentes (4h) + 60min buffer: segundo 20 Lentes não cabe no mesmo dia", () => {
    // Após um 20 Lentes às 8h-12h + 60min buffer (ocupa até 13h),
    // o próximo slot de 4h começaria às 12h (overlap com buffer) ou 16h (16+4=20h, fora do expediente)
    // → nenhum slot de 4h disponível no mesmo dia
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [
        { startsAt: localDate(8), endsAt: localDate(12), appliesPostEventBuffer: true },
      ],
      from: localDate(8),
      to: localDate(18),
      slotDurationMinutes: 240,
      clinicId: "clinic-test",
      postEventBufferMinutes: 60,
    });

    expect(starts).toEqual([]);
  });

  it("20 Lentes (4h) sem eventos: slots disponíveis às 8h e 12h dentro do expediente", () => {
    // Verifica que o engine gera slots de 4h corretamente: 8h-12h e 12h-16h
    // 16h+4h=20h ultrapassa o expediente (18h), então não aparece
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: localDate(8),
      to: localDate(18),
      slotDurationMinutes: 240,
      clinicId: "clinic-test",
      postEventBufferMinutes: 60,
    });

    expect(starts).toEqual(["08:00", "12:00"]);
  });

  it("does not add post-event buffer to events marked as operational blocks", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [
        { startsAt: localDate(9), endsAt: localDate(10), appliesPostEventBuffer: false },
      ],
      from: localDate(8),
      to: localDate(12),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      postEventBufferMinutes: 60,
    });

    expect(starts).toEqual(["08:00", "10:00", "11:00"]);
  });
});
