import { describe, expect, it } from "vitest";
import {
  filterSlotsByRequest,
  formatSlotPt,
  parseCalendarRequest,
} from "./calendar-conversation";
import type { CalendarSlot } from "@/domain/entities/calendar-slot";

const clinicId = "clinic-1";

describe("calendar conversation parsing", () => {
  it("uses amanhã over a conflicting explicit date", () => {
    const now = new Date("2026-05-24T21:18:00-03:00");

    const request = parseCalendarRequest("25/06 amanhã segunda feira", now);

    expect(request.intent).toBe("ask_availability");
    expect(formatSlotPt(request.requestedDate!)).toBe("Seg 25/05 às 00h");
  });

  it("filters the exact requested hour on the requested day", () => {
    const now = new Date("2026-05-24T21:18:00-03:00");
    const request = parseCalendarRequest("agende para as 08 amanha", now);
    const slots = [
      slot("2026-05-25T11:00:00.000Z"),
      slot("2026-05-25T12:00:00.000Z"),
      slot("2026-05-26T11:00:00.000Z"),
    ];

    const filtered = filterSlotsByRequest(slots, request);

    expect(request.intent).toBe("schedule_exact");
    expect(filtered).toHaveLength(1);
    expect(formatSlotPt(filtered[0]!.startsAt)).toBe("Seg 25/05 às 08h");
  });

  it("recognizes list and cancel appointment requests", () => {
    expect(parseCalendarRequest("quais horários tenho agendado?").intent).toBe("list_appointments");
    expect(parseCalendarRequest("cancele para mim o agendamento das 9").intent).toBe(
      "cancel_appointment",
    );
  });

  it("understands day-only requests with an exact hour", () => {
    const now = new Date("2026-05-24T21:37:00-03:00");

    const request = parseCalendarRequest("quero dia 26 as 11h", now);

    expect(request.intent).toBe("schedule_exact");
    expect(request.requestedHour).toBe(11);
    expect(formatSlotPt(request.requestedDate!)).toBe("Ter 26/05 às 00h");
  });

  it("asks for preference when scheduling intent has no date or period", () => {
    const request = parseCalendarRequest("marque para ter");

    expect(request.intent).toBe("ask_availability");
    expect(request.requestedDate).toBeNull();
    expect(request.requestedHour).toBeNull();
  });
});

function slot(startsAtIso: string): CalendarSlot {
  const startsAt = new Date(startsAtIso);
  return {
    id: startsAtIso,
    clinicId,
    professionalId: null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
    source: "google_calendar",
  };
}
