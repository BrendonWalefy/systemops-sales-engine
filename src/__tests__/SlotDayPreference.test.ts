// Integration-light tests: "lead pede sexta" → resolvePreferredDate → filtragem de slots → dia correto
// No DB, no Calendar API. Pure functions only.

import { describe, it, expect } from "vitest";
import { ClinicTimezone, type ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";
import type { CalendarSlot } from "@/domain/entities/calendar-slot";

const TZ = "America/Sao_Paulo";
const tz = new ClinicTimezone(TZ);

const businessHours: ParsedBusinessHours = {
  startHour: 8,
  endHour: 18,
  days: [1, 2, 3, 4, 5], // Mon-Fri
};

// ─── Mock slot factory ──────────────────────────────────────────────────────

/**
 * Build a CalendarSlot starting at the given local time in Sao Paulo.
 * Duration: 1 hour.
 */
function makeSlot(year: number, month: number, day: number, hour: number): CalendarSlot {
  const startsAt = tz.fromLocalParts(year, month, day, hour, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  return {
    id: `test:${year}-${month + 1}-${day}-${hour}`,
    clinicId: "clinic-test",
    professionalId: null,
    startsAt,
    endsAt,
    source: "google_calendar",
  };
}

// Reference week starting 2025-06-23 (Mon) through 2025-06-29 (Sun)
// Plus next week Mon 30/Jun through Sun 06/Jul
const ALL_SLOTS: CalendarSlot[] = [
  // Week 1: Jun 23-27 (Mon-Fri) at 9h and 14h
  makeSlot(2025, 5, 23, 9),  // Mon 9h
  makeSlot(2025, 5, 23, 14), // Mon 14h
  makeSlot(2025, 5, 24, 9),  // Tue 9h
  makeSlot(2025, 5, 24, 14), // Tue 14h
  makeSlot(2025, 5, 25, 9),  // Wed 9h
  makeSlot(2025, 5, 25, 14), // Wed 14h
  makeSlot(2025, 5, 26, 9),  // Thu 9h
  makeSlot(2025, 5, 26, 14), // Thu 14h
  makeSlot(2025, 5, 27, 9),  // Fri 9h
  makeSlot(2025, 5, 27, 14), // Fri 14h
  // Weekend: no business day slots
  // Week 2: Jun 30 – Jul 4
  makeSlot(2025, 5, 30, 9),  // Mon 9h
  makeSlot(2025, 5, 30, 14), // Mon 14h
  makeSlot(2025, 6, 1, 9),   // Tue 9h (Jul 1)
  makeSlot(2025, 6, 1, 14),  // Tue 14h
  makeSlot(2025, 6, 2, 9),   // Wed 9h
  makeSlot(2025, 6, 2, 14),  // Wed 14h
  makeSlot(2025, 6, 3, 9),   // Thu 9h
  makeSlot(2025, 6, 3, 14),  // Thu 14h
  makeSlot(2025, 6, 4, 9),   // Fri 9h
  makeSlot(2025, 6, 4, 14),  // Fri 14h
];

// ─── Filtering helper (mirrors what Orchestrator would do) ──────────────────

/**
 * Filters slots to those that fall on or after the preferred date (same local day).
 * Returns only slots whose local date matches the target's local date.
 */
function filterSlotsByDate(slots: CalendarSlot[], targetDate: Date): CalendarSlot[] {
  const targetParts = tz.toLocalParts(targetDate);
  return slots.filter((slot) => {
    const parts = tz.toLocalParts(slot.startsAt);
    return (
      parts.year === targetParts.year &&
      parts.month === targetParts.month &&
      parts.day === targetParts.day
    );
  });
}

/**
 * Filters slots to those whose local weekday matches the target weekday.
 * Used to select all slots on a given day-of-week in the result set.
 */
function filterSlotsByWeekday(slots: CalendarSlot[], weekday: number): CalendarSlot[] {
  return slots.filter((slot) => {
    const parts = tz.toLocalParts(slot.startsAt);
    return parts.weekday === weekday;
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SlotDayPreference — 'lead pede sexta' → slots no dia correto", () => {
  const nowWed = tz.fromLocalParts(2025, 5, 25, 10, 0); // Wed Jun-25 10h

  it("pede 'sexta' → resolvePreferredDate retorna sexta (27/Jun)", () => {
    const preferred = tz.resolvePreferredDate("sexta", nowWed, businessHours);
    expect(preferred).not.toBeNull();
    const parts = tz.toLocalParts(preferred!);
    expect(parts.weekday).toBe(5); // Sexta
    expect(parts.day).toBe(27);
  });

  it("CRÍTICO — slots filtrados para 'sexta' são APENAS slots de sexta (dia=27), não quinta (dia=26)", () => {
    const preferred = tz.resolvePreferredDate("sexta", nowWed, businessHours);
    expect(preferred).not.toBeNull();

    const filtered = filterSlotsByDate(ALL_SLOTS, preferred!);
    expect(filtered.length).toBeGreaterThan(0);

    for (const slot of filtered) {
      const parts = tz.toLocalParts(slot.startsAt);
      expect(parts.weekday).toBe(5); // Must all be Sexta
      expect(parts.day).toBe(27);   // Must all be Jun-27
      expect(parts.day).not.toBe(26); // Must NOT be Jun-26 (Quinta)
    }
  });

  it("pede 'quinta' → slots filtrados são apenas quinta (dia=26)", () => {
    const preferred = tz.resolvePreferredDate("quinta", nowWed, businessHours);
    expect(preferred).not.toBeNull();

    const filtered = filterSlotsByDate(ALL_SLOTS, preferred!);
    expect(filtered.length).toBeGreaterThan(0);

    for (const slot of filtered) {
      const parts = tz.toLocalParts(slot.startsAt);
      expect(parts.weekday).toBe(4); // Must all be Quinta
      expect(parts.day).toBe(26);   // Must all be Jun-26
    }
  });

  it("pede 'segunda' → slots filtrados são apenas segunda (dia=23 — this week)", () => {
    // From Wed, Monday is behind → should wrap to next Monday (Jun 30)
    const preferred = tz.resolvePreferredDate("segunda", nowWed, businessHours);
    expect(preferred).not.toBeNull();

    const filtered = filterSlotsByDate(ALL_SLOTS, preferred!);
    expect(filtered.length).toBeGreaterThan(0);

    for (const slot of filtered) {
      const parts = tz.toLocalParts(slot.startsAt);
      expect(parts.weekday).toBe(1); // Must all be Segunda
      expect(parts.day).toBe(30);   // Must be Jun-30 (next monday)
    }
  });

  it("pede 'amanhã' (from Wed) → slots filtrados são apenas quinta Jun-26", () => {
    const preferred = tz.resolvePreferredDate("amanhã", nowWed, businessHours);
    expect(preferred).not.toBeNull();

    const filtered = filterSlotsByDate(ALL_SLOTS, preferred!);
    expect(filtered.length).toBeGreaterThan(0);

    for (const slot of filtered) {
      const parts = tz.toLocalParts(slot.startsAt);
      expect(parts.weekday).toBe(4); // Quinta
      expect(parts.day).toBe(26);   // Jun-26
    }
  });

  it("slots de sexta (27/Jun) têm exatamente 2 slots (9h e 14h)", () => {
    const preferred = tz.resolvePreferredDate("sexta", nowWed, businessHours);
    const filtered = filterSlotsByDate(ALL_SLOTS, preferred!);
    expect(filtered).toHaveLength(2);

    const hours = filtered.map((s) => tz.toLocalParts(s.startsAt).hour).sort((a, b) => a - b);
    expect(hours).toEqual([9, 14]);
  });

  it("slots de quinta (26/Jun) têm exatamente 2 slots (9h e 14h)", () => {
    const preferred = tz.resolvePreferredDate("quinta", nowWed, businessHours);
    const filtered = filterSlotsByDate(ALL_SLOTS, preferred!);
    expect(filtered).toHaveLength(2);

    const hours = filtered.map((s) => tz.toLocalParts(s.startsAt).hour).sort((a, b) => a - b);
    expect(hours).toEqual([9, 14]);
  });
});

describe("SlotDayPreference — cross-day consistency verification", () => {
  it("cada slot mock está no dia local correto (sanity check do makeSlot)", () => {
    // Verify the makeSlot helper itself is correct
    const friSlot = makeSlot(2025, 5, 27, 9);
    const friParts = tz.toLocalParts(friSlot.startsAt);
    expect(friParts.weekday).toBe(5); // Sexta
    expect(friParts.day).toBe(27);

    const thuSlot = makeSlot(2025, 5, 26, 9);
    const thuParts = tz.toLocalParts(thuSlot.startsAt);
    expect(thuParts.weekday).toBe(4); // Quinta
    expect(thuParts.day).toBe(26);
  });

  it("filterSlotsByWeekday(5) retorna APENAS slots de sexta", () => {
    const friSlots = filterSlotsByWeekday(ALL_SLOTS, 5);
    expect(friSlots.length).toBeGreaterThan(0);

    for (const slot of friSlots) {
      const parts = tz.toLocalParts(slot.startsAt);
      expect(parts.weekday).toBe(5);
    }
  });

  it("filterSlotsByWeekday(4) retorna APENAS slots de quinta", () => {
    const thuSlots = filterSlotsByWeekday(ALL_SLOTS, 4);
    expect(thuSlots.length).toBeGreaterThan(0);

    for (const slot of thuSlots) {
      const parts = tz.toLocalParts(slot.startsAt);
      expect(parts.weekday).toBe(4);
    }
  });

  it("nenhum slot de quinta está entre os slots de sexta", () => {
    const friSlots = filterSlotsByWeekday(ALL_SLOTS, 5);
    const thuInFri = friSlots.filter((s) => tz.toLocalParts(s.startsAt).weekday === 4);
    expect(thuInFri).toHaveLength(0);
  });

  it("REGRESSÃO Bug #1 — slot criado para sexta tem weekday=5 via toLocalParts", () => {
    // Direct regression: if fromLocalParts is buggy, the slot's startsAt UTC
    // would land on Thursday's timezone representation (weekday=4 instead of 5)
    const fri9h = tz.fromLocalParts(2025, 5, 27, 9, 0);
    const parts = tz.toLocalParts(fri9h);

    expect(parts.weekday).toBe(5); // 5 = Sexta — MUST NOT be 4 (Quinta)
    expect(parts.day).toBe(27);
  });

  it("REGRESSÃO — slot de sexta 9h retorna startsAt que não está em UTC do dia anterior", () => {
    const fri9h = tz.fromLocalParts(2025, 5, 27, 9, 0);
    // UTC for 9h São Paulo (UTC-3) = 12h UTC of the same day
    // If bug exists, it would be 21h UTC of Jun-26 instead of 12h UTC Jun-27
    const utcHour = fri9h.getUTCHours();
    const utcDay = fri9h.getUTCDate();

    // Should be 12h UTC on Jun-27 (not 21h on Jun-26)
    expect(utcDay).toBe(27); // UTC date should still be 27
    expect(utcHour).toBe(12); // 9h local = 12h UTC in UTC-3
  });
});

describe("SlotDayPreference — cenários de hoje é quinta, pede sexta", () => {
  // Regression scenario from bug report: today is Thursday, lead asks for "sexta"
  const nowThu = tz.fromLocalParts(2025, 5, 26, 10, 0); // Thu Jun-26 10h

  it("hoje quinta 10h, pede 'sexta' → preferred date é Jun-27 (sexta)", () => {
    const preferred = tz.resolvePreferredDate("sexta", nowThu, businessHours);
    expect(preferred).not.toBeNull();
    const parts = tz.toLocalParts(preferred!);
    expect(parts.weekday).toBe(5);
    expect(parts.day).toBe(27);
  });

  it("hoje quinta 10h, pede 'sexta' → slots retornados são de Jun-27, NOT Jun-26", () => {
    const preferred = tz.resolvePreferredDate("sexta", nowThu, businessHours);
    expect(preferred).not.toBeNull();

    const filtered = filterSlotsByDate(ALL_SLOTS, preferred!);
    expect(filtered.length).toBeGreaterThan(0);

    for (const slot of filtered) {
      const parts = tz.toLocalParts(slot.startsAt);
      expect(parts.day).toBe(27);   // Must be Jun-27 (sexta)
      expect(parts.day).not.toBe(26); // Must NOT be Jun-26 (quinta)
      expect(parts.weekday).toBe(5); // Weekday must be Sexta (5)
    }
  });
});
