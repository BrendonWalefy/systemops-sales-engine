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

// ─── Sábado com horário reduzido (SYS-AGENDA-020) ─────────────────────────

describe("SlotEngine — Saturday short hours", () => {
  // Sábado 07/Jun/2026 (weekday=6)
  const satBH: ParsedBusinessHours = {
    startHour: 8,
    startMinute: 0,
    endHour: 18,
    endMinute: 0,
    days: [1, 2, 3, 4, 5, 6],
    saturdayStartHour: 8,
    saturdayStartMinute: 0,
    saturdayEndHour: 13,
    saturdayEndMinute: 0,
  };

  function satDate(hour: number, minute = 0): Date {
    return tz.fromLocalParts(2026, 5, 6, hour, minute); // 06/Jun/2026 = sábado
  }

  it("oferece slots das 8h às 12h (last start) no sábado com fim às 13h", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours: satBH,
      existingEvents: [],
      from: satDate(8),
      to: satDate(14),
      slotDurationMinutes: 60,
      clinicId: "clinic-sat",
    });
    expect(starts).toEqual(["08:00", "09:00", "10:00", "11:00", "12:00"]);
  });

  it("NÃO oferece slot das 13h-14h no sábado com fim às 13h (SYS-AGENDA-020)", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours: satBH,
      existingEvents: [],
      from: satDate(8),
      to: satDate(16),
      slotDurationMinutes: 60,
      clinicId: "clinic-sat",
    });
    expect(starts).not.toContain("13:00");
    expect(starts[starts.length - 1]).toBe("12:00");
  });
});

// ─── Grade própria de profissional (disponibilidade Victor/Gregorie) ─────────

describe("SlotEngine — professionalSchedule", () => {
  // 05/Jan/2026 = segunda, 06/Jan/2026 = terça, 08/Jan/2026 = quinta
  function dateOn(day: number, hour: number, minute = 0): Date {
    return tz.fromLocalParts(2026, 0, day, hour, minute);
  }

  it("restringe os slots à janela do profissional, mais estreita que o horário da clínica", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: dateOn(6, 8),
      to: dateOn(6, 18),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      professionalSchedule: { 2: { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 } },
    });

    expect(starts).toEqual(["14:00", "15:00", "16:00", "17:00"]);
  });

  it("não oferece nenhum slot num dia que a grade do profissional não inclui", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: dateOn(5, 8),
      to: dateOn(5, 18),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      professionalSchedule: { 2: { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 } },
    });

    expect(starts).toEqual([]);
  });

  it("exclui slot cujo fim ultrapassa o fim da janela do profissional mesmo com a clínica aberta", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: dateOn(8, 9),
      to: dateOn(8, 13),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      professionalSchedule: { 4: { startHour: 9, startMinute: 0, endHour: 12, endMinute: 0 } },
    });

    // 12h-13h cabe no horário comercial (8h-18h) mas estoura a janela do profissional (9h-12h)
    expect(starts).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("trata grade própria vazia como profissional totalmente indisponível", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: dateOn(5, 8),
      to: dateOn(5, 18),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      professionalSchedule: {},
    });

    expect(starts).toEqual([]);
  });

  it("sem grade própria (null), segue o horário da clínica normalmente", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: dateOn(5, 8),
      to: dateOn(5, 11),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      professionalSchedule: null,
    });

    expect(starts).toEqual(["08:00", "09:00", "10:00"]);
  });
});
