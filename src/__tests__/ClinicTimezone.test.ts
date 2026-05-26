// Tests for ClinicTimezone — Bug #1 focus: fromLocalParts() with UTC-3 (America/Sao_Paulo)
// These tests verify correct day-of-week handling and the round-trip correctness.

import { describe, it, expect } from "vitest";
import { ClinicTimezone, type ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";

const TZ = "America/Sao_Paulo"; // UTC-3 (no DST in winter; UTC-2 in DST summer)
const tz = new ClinicTimezone(TZ);

// ─── Helper ────────────────────────────────────────────────────────────────

/**
 * Build a UTC Date that represents the given local clock time in America/Sao_Paulo.
 * We use tz.fromLocalParts and then verify the weekday via toLocalParts.
 */
function localMidnight(year: number, month: number, day: number): Date {
  return tz.fromLocalParts(year, month, day, 0, 0);
}

// Known reference: 2025-06-25 is a Wednesday (Quarta) in real calendar.
// weekday: 0=Dom 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sáb
const REF_YEAR = 2025;
const REF_MONTH = 5; // June (0-indexed)
const REF_WED_DAY = 25; // Wednesday 2025-06-25

// ─── Section 1: fromLocalParts + toLocalParts roundtrip ────────────────────

describe("ClinicTimezone — fromLocalParts/toLocalParts roundtrip (UTC-3)", () => {
  it("midnight of each day of the week returns correct weekday", () => {
    // Week starting Mon 23/Jun/2025
    const weekDays = [
      { day: 23, expectedWeekday: 1, name: "Segunda (Mon 23/Jun)" },
      { day: 24, expectedWeekday: 2, name: "Terça (Tue 24/Jun)" },
      { day: 25, expectedWeekday: 3, name: "Quarta (Wed 25/Jun)" },
      { day: 26, expectedWeekday: 4, name: "Quinta (Thu 26/Jun)" },
      { day: 27, expectedWeekday: 5, name: "Sexta (Fri 27/Jun)" },
      { day: 28, expectedWeekday: 6, name: "Sábado (Sat 28/Jun)" },
      { day: 29, expectedWeekday: 0, name: "Domingo (Sun 29/Jun)" },
    ];

    for (const { day, expectedWeekday, name } of weekDays) {
      const utcDate = localMidnight(2025, 5, day); // month=5 → June
      const parts = tz.toLocalParts(utcDate);
      expect(parts.weekday, `${name}: weekday should be ${expectedWeekday}`).toBe(expectedWeekday);
      expect(parts.day, `${name}: day should be ${day}`).toBe(day);
      expect(parts.month, `${name}: month should be 5 (June 0-indexed)`).toBe(5);
    }
  });

  it("midnight of sexta (Fri 27/Jun/2025) returns weekday=5", () => {
    // Critical scenario for Bug #1
    const fri = localMidnight(2025, 5, 27);
    const parts = tz.toLocalParts(fri);
    expect(parts.weekday).toBe(5); // 5 = Sexta
    expect(parts.day).toBe(27);
  });

  it("midnight of quinta (Thu 26/Jun/2025) returns weekday=4", () => {
    const thu = localMidnight(2025, 5, 26);
    const parts = tz.toLocalParts(thu);
    expect(parts.weekday).toBe(4); // 4 = Quinta
    expect(parts.day).toBe(26);
  });

  it("roundtrip: fromLocalParts then toLocalParts preserves year/month/day/hour for next 14 days from ref", () => {
    const baseUtc = localMidnight(REF_YEAR, REF_MONTH, REF_WED_DAY);

    for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
      const targetUtc = new Date(baseUtc.getTime() + daysAhead * 24 * 60 * 60_000);
      const original = tz.toLocalParts(targetUtc);

      // Re-create from parts and convert back
      const reconstructed = tz.fromLocalParts(original.year, original.month, original.day, original.hour, original.minute);
      const recheck = tz.toLocalParts(reconstructed);

      expect(recheck.year, `day +${daysAhead}: year`).toBe(original.year);
      expect(recheck.month, `day +${daysAhead}: month`).toBe(original.month);
      expect(recheck.day, `day +${daysAhead}: day`).toBe(original.day);
      expect(recheck.hour, `day +${daysAhead}: hour`).toBe(original.hour);
      expect(recheck.minute, `day +${daysAhead}: minute`).toBe(original.minute);
    }
  });

  it("business hours 9h: fromLocalParts produces correct hour back", () => {
    const hour9 = tz.fromLocalParts(2025, 5, 27, 9, 0);
    const parts = tz.toLocalParts(hour9);
    expect(parts.hour).toBe(9);
    expect(parts.day).toBe(27);
    expect(parts.weekday).toBe(5); // sexta
  });

  it("business hours 14h: fromLocalParts produces correct hour back", () => {
    const hour14 = tz.fromLocalParts(2025, 5, 27, 14, 0);
    const parts = tz.toLocalParts(hour14);
    expect(parts.hour).toBe(14);
    expect(parts.day).toBe(27);
    expect(parts.weekday).toBe(5);
  });

  it("business hours 17h: fromLocalParts produces correct hour back", () => {
    const hour17 = tz.fromLocalParts(2025, 5, 27, 17, 0);
    const parts = tz.toLocalParts(hour17);
    expect(parts.hour).toBe(17);
    expect(parts.day).toBe(27);
    expect(parts.weekday).toBe(5);
  });

  it("Bug #1 regression: fromLocalParts(2025,5,27,0,0) UTC timestamp must be on Jun-27 local, NOT Jun-26", () => {
    // The bug: Date.UTC(year, month, day, 0, 0) for UTC-3 gives 21h of the PREVIOUS day locally.
    // The correction should shift hours forward, landing on midnight of Jun-27 local.
    const fri = tz.fromLocalParts(2025, 5, 27, 0, 0);

    // Verify it is NOT on Thursday June 26 local time
    const parts = tz.toLocalParts(fri);
    expect(parts.day).not.toBe(26); // Must not be Jun-26 (quinta)
    expect(parts.weekday).not.toBe(4); // Must not be weekday 4 (quinta)

    // Must be Jun-27 (sexta)
    expect(parts.day).toBe(27);
    expect(parts.weekday).toBe(5);
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(0);
  });
});

// ─── Section 2: resolvePreferredDate ───────────────────────────────────────

describe("ClinicTimezone — resolvePreferredDate day names", () => {
  const businessHours: ParsedBusinessHours = {
    startHour: 8,
    endHour: 18,
    days: [1, 2, 3, 4, 5],
  };

  /**
   * Build a UTC Date representing the given local date+hour in São Paulo.
   */
  function nowAt(year: number, month: number, day: number, hour: number, minute = 0): Date {
    return tz.fromLocalParts(year, month, day, hour, minute);
  }

  // Reference week: 2025-06-23 (Mon) to 2025-06-29 (Sun)
  // Today = Wednesday 25/Jun/2025 10h local
  const todayWed = nowAt(2025, 5, 25, 10, 0);

  it("'segunda' a partir de quarta → retorna próxima segunda (30/Jun)", () => {
    const result = tz.resolvePreferredDate("segunda", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(1); // Segunda
    expect(parts.day).toBe(30);
  });

  it("'segunda-feira' (formato completo) retorna próxima segunda", () => {
    const result = tz.resolvePreferredDate("segunda-feira", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(1);
  });

  it("'terça' a partir de quarta → retorna terça da próxima semana (01/Jul)", () => {
    const result = tz.resolvePreferredDate("terça", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(2);
    expect(parts.day).toBe(1); // 1/Jul
  });

  it("'quarta' a partir de quarta (mesmo dia, dentro do horário) → retorna hoje", () => {
    const result = tz.resolvePreferredDate("quarta", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(3); // Quarta
    expect(parts.day).toBe(25); // Mesmo dia
  });

  it("'quinta' a partir de quarta → retorna amanhã quinta (26/Jun)", () => {
    const result = tz.resolvePreferredDate("quinta", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(4); // Quinta
    expect(parts.day).toBe(26);
  });

  it("CRÍTICO — 'sexta' a partir de quarta → retorna sexta amanhã-depois-amanhã (27/Jun), NOT quinta (26)", () => {
    const result = tz.resolvePreferredDate("sexta", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    // Must be sexta (5), not quinta (4)
    expect(parts.weekday).toBe(5); // Sexta
    expect(parts.day).toBe(27);
  });

  it("'sexta-feira' (formato completo) a partir de quarta → retorna sexta (27/Jun)", () => {
    const result = tz.resolvePreferredDate("sexta-feira", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(5);
    expect(parts.day).toBe(27);
  });

  it("'sábado' a partir de quarta → retorna sábado (28/Jun)", () => {
    const result = tz.resolvePreferredDate("sábado", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(6);
    expect(parts.day).toBe(28);
  });

  it("'domingo' a partir de quarta → retorna domingo (29/Jun)", () => {
    const result = tz.resolvePreferredDate("domingo", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(0);
    expect(parts.day).toBe(29);
  });

  it("CRÍTICO — hoje é quinta (26/Jun/2025 09h), pede sexta → retorna amanhã sexta (27/Jun)", () => {
    const todayThu9am = nowAt(2025, 5, 26, 9, 0);
    const result = tz.resolvePreferredDate("sexta", todayThu9am, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(5); // Sexta
    expect(parts.day).toBe(27);
  });

  it("CRÍTICO — hoje é sexta manhã (09h), pede sexta → retorna hoje (ainda há horário comercial)", () => {
    const todayFri9am = nowAt(2025, 5, 27, 9, 0);
    const result = tz.resolvePreferredDate("sexta", todayFri9am, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(5); // Sexta
    expect(parts.day).toBe(27); // Hoje (sexta)
  });

  it("CRÍTICO — hoje é sexta tarde (17h30, clínica fecha 18h), pede sexta → retorna próxima sexta", () => {
    const todayFri1730 = nowAt(2025, 5, 27, 17, 30);
    const result = tz.resolvePreferredDate("sexta", todayFri1730, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(5); // Sexta
    expect(parts.day).toBe(4); // 4/Jul — próxima sexta
  });

  it("REGRESSÃO — hoje quarta 25/Jun/2025, pede 'sexta' → weekday=5 (Sex, 27/Jun)", () => {
    // This is the direct regression case from the bug report
    const wednesdayNow = nowAt(2025, 5, 25, 10, 0);
    const result = tz.resolvePreferredDate("sexta", wednesdayNow, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(5); // Must be 5 (Sex), NOT 4 (Qui)
  });

  it("'hoje' retorna o início do dia atual", () => {
    const result = tz.resolvePreferredDate("hoje", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(3); // Quarta
    expect(parts.day).toBe(25);
    expect(parts.hour).toBe(0);
  });

  it("'amanhã' retorna o início do dia seguinte", () => {
    const result = tz.resolvePreferredDate("amanhã", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.weekday).toBe(4); // Quinta
    expect(parts.day).toBe(26);
    expect(parts.hour).toBe(0);
  });

  it("retorna null para string sem data reconhecida", () => {
    const result = tz.resolvePreferredDate("qualquer horário disponível", todayWed, businessHours);
    expect(result).toBeNull();
  });

  it("formato DD/MM: '27/06' a partir de quarta → retorna 27/Jun", () => {
    const result = tz.resolvePreferredDate("27/06", todayWed, businessHours);
    expect(result).not.toBeNull();
    const parts = tz.toLocalParts(result!);
    expect(parts.day).toBe(27);
    expect(parts.month).toBe(5); // June
  });
});

// ─── Section 3: startOfLocalDay consistency ────────────────────────────────

describe("ClinicTimezone — startOfLocalDay", () => {
  it("startOfLocalDay of a 14h slot is midnight of the same local day", () => {
    const slot14h = tz.fromLocalParts(2025, 5, 27, 14, 0); // Fri 14h
    const midnight = tz.startOfLocalDay(slot14h);
    const parts = tz.toLocalParts(midnight);
    expect(parts.day).toBe(27);
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(0);
    expect(parts.weekday).toBe(5); // still sexta
  });

  it("startOfLocalDay does NOT shift to previous day", () => {
    // If fromLocalParts has the off-by-one bug, startOfLocalDay would return 26 (quinta)
    const slot = tz.fromLocalParts(2025, 5, 27, 9, 0);
    const midnight = tz.startOfLocalDay(slot);
    const parts = tz.toLocalParts(midnight);
    expect(parts.day).not.toBe(26); // Must NOT be quinta Jun-26
    expect(parts.day).toBe(27);
    expect(parts.weekday).toBe(5);
  });
});
