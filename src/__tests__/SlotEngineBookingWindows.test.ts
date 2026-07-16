import { describe, expect, it } from "vitest";
import { ClinicTimezone, type ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { computeAvailableSlots } from "@/core/scheduling/SlotEngine";
import type { TreatmentBookingWindow } from "@/domain/entities/treatment";

const tz = new ClinicTimezone("America/Sao_Paulo");

// Vitalli: Seg-Sáb 8h-18h
const businessHours: ParsedBusinessHours = {
  startHour: 8,
  startMinute: 0,
  endHour: 18,
  endMinute: 0,
  days: [1, 2, 3, 4, 5, 6],
};

// Janelas reais das lentes: só 09:00 e 16:00.
const LENTES_WINDOWS: TreatmentBookingWindow[] = [
  { startHour: 9, startMinute: 0 },
  { startHour: 16, startMinute: 0 },
];

function local(y: number, m: number, d: number, hour: number, minute = 0): Date {
  return tz.fromLocalParts(y, m, d, hour, minute);
}

function label(date: Date): string {
  const p = tz.toLocalParts(date);
  return `${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

describe("SlotEngine — janelas de início por tratamento (A7)", () => {
  it("oferta APENAS os horários das janelas (09:00 e 16:00), não a grade de 60min", () => {
    const slots = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: local(2026, 6, 20, 0, 0), // seg 20/07
      to: local(2026, 6, 21, 0, 0), // ter 21/07 (um dia)
      slotDurationMinutes: 300, // lentes = 5h
      clinicId: "vitalli",
      allowedStartWindows: LENTES_WINDOWS,
    });
    expect(slots.map((s) => label(s.startsAt))).toEqual(["20 09:00", "20 16:00"]);
  });

  it("slot de 300min às 09:00 bloqueia até 14:00, mas o de 16:00 continua livre", () => {
    const slots = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: [{ startsAt: local(2026, 6, 20, 9, 0), endsAt: local(2026, 6, 20, 14, 0) }],
      from: local(2026, 6, 20, 0, 0),
      to: local(2026, 6, 21, 0, 0),
      slotDurationMinutes: 300,
      clinicId: "vitalli",
      allowedStartWindows: LENTES_WINDOWS,
    });
    // 09:00 ocupado → só 16:00
    expect(slots.map((s) => label(s.startsAt))).toEqual(["20 16:00"]);
  });

  it("permite início às 16:00 mesmo com duração que ultrapassa o fim do expediente (janela vence)", () => {
    const slots = computeAvailableSlots({
      timezone: tz,
      businessHours, // fecha 18:00
      existingEvents: [],
      from: local(2026, 6, 20, 0, 0),
      to: local(2026, 6, 21, 0, 0),
      slotDurationMinutes: 300, // 16:00 → 21:00, além das 18:00
      clinicId: "vitalli",
      allowedStartWindows: LENTES_WINDOWS,
    });
    const starts = slots.map((s) => label(s.startsAt));
    expect(starts).toContain("20 16:00"); // não seria ofertável na grade normal
  });

  it("respeita os dias de operação da clínica (não oferta domingo)", () => {
    // 19/07/2026 é domingo (não está em days). 20 é segunda.
    const slots = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: local(2026, 6, 19, 0, 0), // domingo
      to: local(2026, 6, 21, 0, 0), // até terça 00:00
      slotDurationMinutes: 300,
      clinicId: "vitalli",
      allowedStartWindows: LENTES_WINDOWS,
    });
    const days = new Set(slots.map((s) => tz.toLocalParts(s.startsAt).weekday));
    expect(days.has(0)).toBe(false); // nenhum domingo
    expect(days.has(1)).toBe(true); // segunda presente
  });

  it("filtra por weekdays quando a janela define dias específicos", () => {
    const saturdayOnly: TreatmentBookingWindow[] = [{ startHour: 9, startMinute: 0, weekdays: [6] }];
    const slots = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: local(2026, 6, 20, 0, 0), // seg
      to: local(2026, 6, 27, 0, 0), // até seg seguinte (inclui sáb 25)
      slotDurationMinutes: 300,
      clinicId: "vitalli",
      allowedStartWindows: saturdayOnly,
    });
    const weekdays = new Set(slots.map((s) => tz.toLocalParts(s.startsAt).weekday));
    expect([...weekdays]).toEqual([6]); // só sábado
  });

  it("pula uma janela já passada quando `from` está no meio do dia", () => {
    const slots = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: local(2026, 6, 20, 10, 0), // seg 10:00 — já passou das 09:00
      to: local(2026, 6, 21, 0, 0),
      slotDurationMinutes: 300,
      clinicId: "vitalli",
      allowedStartWindows: LENTES_WINDOWS,
    });
    expect(slots.map((s) => label(s.startsAt))).toEqual(["20 16:00"]);
  });

  it("sem janelas (null) → grade horária padrão inalterada (regressão)", () => {
    const slots = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: [],
      from: local(2026, 6, 20, 8, 0),
      to: local(2026, 6, 20, 12, 0),
      slotDurationMinutes: 60,
      clinicId: "vitalli",
      allowedStartWindows: null,
    });
    // grade de 60min: 08,09,10,11
    expect(slots.length).toBe(4);
  });
});
