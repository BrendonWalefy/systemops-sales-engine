import { describe, expect, it, vi } from "vitest";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import { BookingService, type BookingReservationService } from "@/core/scheduling/BookingService";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { Organization } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";

const oldStart = new Date("2026-09-10T12:00:00.000Z");
const oldEnd = new Date("2026-09-10T13:00:00.000Z");
const newStart = new Date("2026-09-12T15:00:00.000Z");
const newEnd = new Date("2026-09-12T16:00:00.000Z");
const clinic = { id: "clinic-1", name: "Clinic" } as Organization;
const lead = { id: "lead-1", clinicId: clinic.id } as Lead;

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    clinicId: clinic.id,
    leadId: lead.id,
    professionalId: "professional-old",
    roomId: null,
    calendarEventId: "calendar-event-1",
    calendarEventUrl: null,
    startsAt: oldStart,
    endsAt: oldEnd,
    status: "scheduled",
    source: "app",
    origin: "ai_conversation",
    reminderSentAt: null,
    treatmentId: "treatment-1",
    valueCents: null,
    description: null,
    createdAt: oldStart,
    updatedAt: oldStart,
    ...overrides,
  };
}

function setup(options: {
  current?: Appointment;
  overlaps?: Appointment[];
  slotFree?: boolean;
  updateFailureAtCall?: number;
  casFailure?: boolean;
} = {}) {
  let current = options.current ?? appointment();
  const updateCalendarEvent = vi.fn(async () => {
    if (updateCalendarEvent.mock.calls.length === options.updateFailureAtCall) {
      throw new Error("calendar update failed");
    }
  });
  const gateway = {
    isSlotFree: vi.fn().mockResolvedValue(options.slotFree ?? true),
    updateCalendarEvent,
  } as unknown as CalendarGateway;
  const rescheduleActiveForClinicAndLead = vi.fn(async (
    _clinicId: string,
    _leadId: string,
    _appointmentId: string,
    _expectedStart: Date,
    _expectedEnd: Date,
    startsAt: Date,
    endsAt: Date,
    professionalId: string | null,
    updatedAt: Date,
  ) => {
    if (options.casFailure) return null;
    current = { ...current, startsAt, endsAt, professionalId, updatedAt };
    return current;
  });
  const repo = {
    findByIdForClinicAndLead: vi.fn(async () => current),
    findByPeriod: vi.fn().mockResolvedValue(options.overlaps ?? []),
    rescheduleActiveForClinicAndLead,
  } as unknown as AppointmentRepository;
  const reservation = {
    id: "reservation-new",
    clinicId: clinic.id,
    leadId: lead.id,
    startsAt: newStart,
    endsAt: newEnd,
    status: "pending" as const,
    calendarEventId: null,
    expiresAt: new Date(newStart.getTime() + 10 * 60_000),
  };
  const reservations = {
    reserve: vi.fn().mockResolvedValue(reservation),
    confirm: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    releaseBySlot: vi.fn().mockResolvedValue(undefined),
    releaseExpired: vi.fn(),
  } satisfies BookingReservationService;
  const service = new BookingService(
    gateway,
    repo,
    { save: vi.fn() } as unknown as LeadRepository,
    reservations,
  );
  return { service, repo, reservations, updateCalendarEvent, rescheduleActiveForClinicAndLead };
}

const input = {
  clinic,
  lead,
  appointmentId: "appointment-1",
  startsAt: newStart,
  endsAt: newEnd,
  professionalId: "professional-new",
};

describe("BookingService reschedule saga", () => {
  it("updates the same appointment only after target reservation and revalidation", async () => {
    const fixture = setup();
    const result = await fixture.service.reschedule(input);

    expect(result).toMatchObject({
      success: true,
      appointment: {
        id: "appointment-1",
        startsAt: newStart,
        professionalId: "professional-new",
      },
    });
    expect(fixture.reservations.reserve).toHaveBeenCalledOnce();
    expect(fixture.rescheduleActiveForClinicAndLead).toHaveBeenCalledOnce();
    expect(fixture.reservations.confirm).toHaveBeenCalledOnce();
    expect(fixture.reservations.releaseBySlot).toHaveBeenCalledWith(clinic.id, oldStart);
  });

  it("leaves the old appointment untouched when the target conflicts", async () => {
    const competing = appointment({ id: "appointment-2", leadId: "lead-2", startsAt: newStart, endsAt: newEnd });
    const fixture = setup({ overlaps: [competing] });

    await expect(fixture.service.reschedule(input)).resolves.toEqual({
      success: false,
      reason: "slot_taken",
    });
    expect(fixture.rescheduleActiveForClinicAndLead).not.toHaveBeenCalled();
    expect(fixture.reservations.release).toHaveBeenCalledWith("reservation-new");
  });

  it("does not mutate the database when the external event update fails", async () => {
    const fixture = setup({ updateFailureAtCall: 1 });

    await expect(fixture.service.reschedule(input)).resolves.toEqual({
      success: false,
      reason: "calendar_error",
    });
    expect(fixture.rescheduleActiveForClinicAndLead).not.toHaveBeenCalled();
    expect(fixture.reservations.release).toHaveBeenCalledOnce();
  });

  it("compensates the external event when the database CAS fails", async () => {
    const fixture = setup({ casFailure: true });

    await expect(fixture.service.reschedule(input)).resolves.toEqual({
      success: false,
      reason: "db_error",
    });
    expect(fixture.updateCalendarEvent).toHaveBeenNthCalledWith(2, {
      calendarEventId: "calendar-event-1",
      startsAt: oldStart,
      endsAt: oldEnd,
    });
    expect(fixture.reservations.release).toHaveBeenCalledOnce();
  });

  it("fails terminally when external compensation also fails", async () => {
    const fixture = setup({ casFailure: true, updateFailureAtCall: 2 });
    await expect(fixture.service.reschedule(input)).resolves.toEqual({
      success: false,
      reason: "compensation_failed",
    });
  });

  it("retries an already-applied exact target without a second effect", async () => {
    const fixture = setup({
      current: appointment({
        startsAt: newStart,
        endsAt: newEnd,
        professionalId: "professional-new",
      }),
    });

    await expect(fixture.service.reschedule(input)).resolves.toMatchObject({ success: true });
    expect(fixture.reservations.reserve).not.toHaveBeenCalled();
    expect(fixture.updateCalendarEvent).not.toHaveBeenCalled();
    expect(fixture.rescheduleActiveForClinicAndLead).not.toHaveBeenCalled();
  });
});
