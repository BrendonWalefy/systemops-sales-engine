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

    // Evento 9h30-10h30 + 60min de buffer ocupa até 11h30: a primeira marca limpa
    // livre é exatamente 11h30 (a grade antiga, presa ao cursor de hora em hora a
    // partir das 9h, só enxergava 12h).
    expect(starts).toEqual(["11:30", "12:30"]);
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

  it("20 Lentes (4h) + 60min buffer: segundo 20 Lentes cabe às 13h", () => {
    // Após um 20 Lentes às 8h-12h + 60min buffer (ocupa até 13h), o dia ainda
    // comporta um segundo procedimento de 4h das 13h às 17h — dentro do expediente
    // e respeitando o buffer. A grade antiga (cursor rígido de 4h em 4h a partir
    // das 8h) só testava 12h e 16h e perdia esse encaixe.
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

    expect(starts).toEqual(["13:00"]);
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

  // ── Regressão: horários quebrados (Ximendes — Avaliação de 40min) ──
  // A grade antiga somava a duração num cursor contínuo a partir de `from`,
  // atravessando noites: com 40min os slots caíam em 8h20/12h20/14h20. Todo
  // início ofertado precisa estar em marca de :00 ou :30, em todos os dias.

  it("duração de 40min só gera inícios em :00/:30, em todos os dias da janela", () => {
    const slots = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: localDate(8),
      to: tz.fromLocalParts(2026, 0, 8, 0, 0),
      slotDurationMinutes: 40,
      clinicId: "clinic-test",
    });

    expect(slots.length).toBeGreaterThan(10);
    for (const slot of slots) {
      const parts = tz.toLocalParts(slot.startsAt);
      expect([0, 30]).toContain(parts.minute);
    }
    // Slots de 40min não se sobrepõem: 8h00-8h40 aceita, próxima marca livre é 9h00.
    const firstDay = slots
      .filter((s) => tz.toLocalParts(s.startsAt).day === 5)
      .map((s) => localTimeLabel(s.startsAt));
    expect(firstDay.slice(0, 3)).toEqual(["08:00", "09:00", "10:00"]);
  });

  it("duração de 45min também se mantém nas marcas de :00/:30", () => {
    const starts = slotStarts({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: localDate(8),
      to: localDate(12),
      slotDurationMinutes: 45,
      clinicId: "clinic-test",
    });

    // 8h00-8h45 → próxima marca livre 9h00; nada em :45 ou :15.
    expect(starts).toEqual(["08:00", "09:00", "10:00", "11:00"]);
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
