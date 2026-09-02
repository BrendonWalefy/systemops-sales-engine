import { describe, expect, it } from "vitest";
import { resolveDentalTodayAppointment } from "@/application/conversation-v2/dental-live-adapters";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { Appointment } from "@/domain/entities/calendar-slot";

const NOW = new Date("2026-09-02T15:00:00.000Z");
const timezone = new ClinicTimezone("America/Sao_Paulo");

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    clinicId: "clinic-1",
    leadId: "lead-1",
    professionalId: null,
    roomId: null,
    calendarEventId: null,
    calendarEventUrl: null,
    startsAt: new Date("2026-09-02T16:00:00.000Z"),
    endsAt: new Date("2026-09-02T17:00:00.000Z"),
    status: "scheduled",
    source: "app",
    origin: "ai_conversation",
    reminderSentAt: null,
    treatmentId: null,
    valueCents: null,
    description: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function resolve(rows: readonly Appointment[]) {
  return resolveDentalTodayAppointment({
    appointments: rows,
    clinicId: "clinic-1",
    leadId: "lead-1",
    timezone,
    now: NOW,
  });
}

describe("dental operations live adapter", () => {
  it("binds the only active appointment on the clinic local day", () => {
    expect(resolve([appointment()])).toEqual({
      kind: "exact",
      appointment: {
        id: "appointment-1",
        label: timezone.formatForConfirmation(
          new Date("2026-09-02T16:00:00.000Z"),
        ),
        evidenceRef: "appointment:appointment-1",
      },
    });
  });

  it("uses the clinic timezone at the UTC day boundary", () => {
    expect(resolve([appointment({
      startsAt: new Date("2026-09-03T01:30:00.000Z"),
      endsAt: new Date("2026-09-03T02:30:00.000Z"),
    })]).kind).toBe("exact");
    expect(resolve([appointment({
      startsAt: new Date("2026-09-03T03:30:00.000Z"),
      endsAt: new Date("2026-09-03T04:30:00.000Z"),
    })])).toEqual({ kind: "none" });
  });

  it.each(["cancelled", "completed", "no_show"] as const)(
    "ignores terminal status %s",
    (status) => {
      expect(resolve([appointment({ status })])).toEqual({ kind: "none" });
    },
  );

  it("fails closed for a foreign clinic or lead row", () => {
    expect(() => resolve([appointment({ clinicId: "clinic-2" })]))
      .toThrow("appointment tenant binding mismatch");
    expect(() => resolve([appointment({ leadId: "lead-2" })]))
      .toThrow("appointment tenant binding mismatch");
  });

  it("does not choose between multiple appointments on the same day", () => {
    expect(resolve([
      appointment(),
      appointment({
        id: "appointment-2",
        startsAt: new Date("2026-09-02T18:00:00.000Z"),
        endsAt: new Date("2026-09-02T19:00:00.000Z"),
      }),
    ])).toEqual({ kind: "ambiguous" });
  });
});
