import { describe, expect, it } from "vitest";
import { ClinicTimezone, type ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { computeAvailableSlots } from "@/core/scheduling/SlotEngine";

const tz = new ClinicTimezone("America/Sao_Paulo");

const businessHours: ParsedBusinessHours = {
  startHour: 8,
  endHour: 18,
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
