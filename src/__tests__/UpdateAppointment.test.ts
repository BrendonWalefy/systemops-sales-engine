import { describe, it, expect, vi } from "vitest";
import { updateAppointment } from "@/application/use-cases/calendar/update-appointment";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { Lead } from "@/domain/entities/lead";
import type { FollowUp } from "@/domain/entities/follow-up";

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    clinicId: "clinic-1",
    leadId: "lead-1",
    professionalId: null,
    roomId: null,
    calendarEventId: "gcal-abc",
    calendarEventUrl: null,
    startsAt: new Date("2026-06-10T14:00:00Z"),
    endsAt: new Date("2026-06-10T15:00:00Z"),
    status: "scheduled",
    source: "app",
    reminderSentAt: null,
    createdAt: new Date("2026-06-01T10:00:00Z"),
    updatedAt: new Date("2026-06-01T10:00:00Z"),
    ...overrides,
  };
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    clinicId: "clinic-1",
    name: "Maria",
    phone: "+5511999999999",
    whatsappLid: null,
    email: null,
    channel: "whatsapp",
    campaignId: null,
    treatmentInterest: null,
    profilePicUrl: null,
    status: "appointment_scheduled",
    temperature: "warm",
    assignedToUserId: null,
    nextActionAt: null,
    lostReason: null,
    createdAt: new Date("2026-06-01T10:00:00Z"),
    updatedAt: new Date("2026-06-01T10:00:00Z"),
    ...overrides,
  };
}

function makeGateway(overrides: Partial<CalendarGateway> = {}): CalendarGateway {
  return {
    listAvailableSlots: vi.fn().mockResolvedValue([]),
    createAppointment: vi.fn(),
    cancelAppointment: vi.fn(),
    listBlockEvents: vi.fn().mockResolvedValue([]),
    createBlockEvent: vi.fn(),
    deleteBlockEvent: vi.fn(),
    isSlotFree: vi.fn().mockResolvedValue(true),
    updateCalendarEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeApptRepo(appt: Appointment | null = makeAppointment()): AppointmentRepository {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(appt),
    findByLeadId: vi.fn().mockResolvedValue(appt),
    findActiveByLeadId: vi.fn().mockResolvedValue(appt),
    findAllActiveByLeadId: vi.fn().mockResolvedValue(appt ? [appt] : []),
    findByPeriod: vi.fn().mockResolvedValue([]),
    findDueReminders: vi.fn().mockResolvedValue([]),
    findByCalendarEventId: vi.fn().mockResolvedValue(null),
  };
}

function makeLeadRepo(lead: Lead | null = makeLead()): LeadRepository {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(lead),
    findByPhone: vi.fn().mockResolvedValue(null),
    findByWhatsAppLid: vi.fn().mockResolvedValue(null),
    findInactiveLeads: vi.fn().mockResolvedValue([]),
    mergeDuplicateLeads: vi.fn().mockResolvedValue(lead),
  };
}

function makeFollowUpRepo(): FollowUpRepository {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    listDue: vi.fn().mockResolvedValue([]),
    listPendingByLead: vi.fn().mockResolvedValue([]),
    findPendingByReason: vi.fn().mockResolvedValue(null),
    cancelPendingByReason: vi.fn().mockResolvedValue(0),
    cancelPendingByLead: vi.fn().mockResolvedValue(0),
    claimForSending: vi.fn().mockResolvedValue(true),
    recoverStaleSending: vi.fn().mockResolvedValue(0),
  };
}

describe("updateAppointment", () => {
  describe("not found", () => {
    it("returns not_found when appointment does not exist", async () => {
      const result = await updateAppointment(
        { appointmentId: "x", clinicId: "clinic-1", status: "confirmed" },
        { appointmentRepository: makeApptRepo(null), calendarGateway: makeGateway() },
      );
      expect(result).toEqual({ success: false, reason: "not_found" });
    });

    it("returns not_found when clinicId does not match", async () => {
      const result = await updateAppointment(
        { appointmentId: "appt-1", clinicId: "OTHER", status: "confirmed" },
        { appointmentRepository: makeApptRepo(), calendarGateway: makeGateway() },
      );
      expect(result).toEqual({ success: false, reason: "not_found" });
    });
  });

  describe("slot conflict", () => {
    it("returns slot_taken when new time is occupied", async () => {
      const gateway = makeGateway({ isSlotFree: vi.fn().mockResolvedValue(false) });
      const result = await updateAppointment(
        {
          appointmentId: "appt-1",
          clinicId: "clinic-1",
          startsAt: new Date("2026-06-10T16:00:00Z"),
          endsAt: new Date("2026-06-10T17:00:00Z"),
        },
        { appointmentRepository: makeApptRepo(), calendarGateway: gateway },
      );
      expect(result).toEqual({ success: false, reason: "slot_taken" });
    });

    it("does not save when slot is taken", async () => {
      const gateway = makeGateway({ isSlotFree: vi.fn().mockResolvedValue(false) });
      const apptRepo = makeApptRepo();
      await updateAppointment(
        {
          appointmentId: "appt-1",
          clinicId: "clinic-1",
          startsAt: new Date("2026-06-10T16:00:00Z"),
          endsAt: new Date("2026-06-10T17:00:00Z"),
        },
        { appointmentRepository: apptRepo, calendarGateway: gateway },
      );
      expect(apptRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("drag-and-drop → GCal sync", () => {
    it("calls updateCalendarEvent when time changes and event has calendarEventId", async () => {
      const gateway = makeGateway();
      const newStart = new Date("2026-06-10T16:00:00Z");
      const newEnd = new Date("2026-06-10T17:00:00Z");

      await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", startsAt: newStart, endsAt: newEnd },
        { appointmentRepository: makeApptRepo(), calendarGateway: gateway },
      );

      expect(gateway.updateCalendarEvent).toHaveBeenCalledWith({
        calendarEventId: "gcal-abc",
        startsAt: newStart,
        endsAt: newEnd,
      });
    });

    it("does NOT call updateCalendarEvent when only status changes", async () => {
      const gateway = makeGateway();
      await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", status: "confirmed" },
        { appointmentRepository: makeApptRepo(), calendarGateway: gateway },
      );
      expect(gateway.updateCalendarEvent).not.toHaveBeenCalled();
    });

    it("does NOT call updateCalendarEvent when appointment has no calendarEventId", async () => {
      const appt = makeAppointment({ calendarEventId: null });
      const gateway = makeGateway();
      await updateAppointment(
        {
          appointmentId: "appt-1",
          clinicId: "clinic-1",
          startsAt: new Date("2026-06-10T16:00:00Z"),
          endsAt: new Date("2026-06-10T17:00:00Z"),
        },
        { appointmentRepository: makeApptRepo(appt), calendarGateway: gateway },
      );
      expect(gateway.updateCalendarEvent).not.toHaveBeenCalled();
    });

    it("still saves to DB even when GCal update throws", async () => {
      const gateway = makeGateway({
        updateCalendarEvent: vi.fn().mockRejectedValue(new Error("GCal error")),
      });
      const apptRepo = makeApptRepo();
      const result = await updateAppointment(
        {
          appointmentId: "appt-1",
          clinicId: "clinic-1",
          startsAt: new Date("2026-06-10T16:00:00Z"),
          endsAt: new Date("2026-06-10T17:00:00Z"),
        },
        { appointmentRepository: apptRepo, calendarGateway: gateway },
      );
      expect(result.success).toBe(true);
      expect(apptRepo.save).toHaveBeenCalled();
    });
  });

  describe("status: completed", () => {
    it("updates lead status to won", async () => {
      const leadRepo = makeLeadRepo();
      await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", status: "completed" },
        {
          appointmentRepository: makeApptRepo(),
          calendarGateway: makeGateway(),
          leadRepository: leadRepo,
        },
      );
      expect(leadRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: "won" }),
      );
    });

    it("schedules follow-up 6 months out on completed", async () => {
      const followUpRepo = makeFollowUpRepo();
      const leadRepo = makeLeadRepo();
      await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", status: "completed" },
        {
          appointmentRepository: makeApptRepo(),
          calendarGateway: makeGateway(),
          leadRepository: leadRepo,
          followUpRepository: followUpRepo,
        },
      );
      expect(followUpRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: "clinic-1",
          leadId: "lead-1",
          reason: "Retorno de rotina",
          status: "pending",
        }),
      );
      const saved = (followUpRepo.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as FollowUp;
      const sixMonthsFromAppt = new Date("2026-12-10T14:00:00Z");
      expect(Math.abs(saved.dueAt.getTime() - sixMonthsFromAppt.getTime())).toBeLessThan(
        48 * 60 * 60 * 1000, // within 2 days (DST tolerance)
      );
    });
  });

  describe("status: no_show", () => {
    it("updates lead status to in_conversation", async () => {
      const leadRepo = makeLeadRepo();
      await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", status: "no_show" },
        {
          appointmentRepository: makeApptRepo(),
          calendarGateway: makeGateway(),
          leadRepository: leadRepo,
        },
      );
      expect(leadRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: "in_conversation" }),
      );
    });

    it("schedules follow-up 7 days out on no_show", async () => {
      const followUpRepo = makeFollowUpRepo();
      const leadRepo = makeLeadRepo();
      await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", status: "no_show" },
        {
          appointmentRepository: makeApptRepo(),
          calendarGateway: makeGateway(),
          leadRepository: leadRepo,
          followUpRepository: followUpRepo,
        },
      );
      const saved = (followUpRepo.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as FollowUp;
      expect(saved.reason).toBe("Lead não compareceu à consulta");
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      expect(Math.abs(saved.dueAt.getTime() - sevenDaysFromNow.getTime())).toBeLessThan(
        60 * 60 * 1000, // within 1 hour
      );
    });
  });

  describe("status: confirmed", () => {
    it("cancela follow-ups pendentes ao confirmar appointment", async () => {
      const followUpRepo = makeFollowUpRepo();
      await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", status: "confirmed" },
        {
          appointmentRepository: makeApptRepo(),
          calendarGateway: makeGateway(),
          followUpRepository: followUpRepo,
        },
      );
      expect(followUpRepo.cancelPendingByLead).toHaveBeenCalledWith({ leadId: "lead-1" });
    });

    it("does not update lead status on confirmed (already appointment_scheduled)", async () => {
      const leadRepo = makeLeadRepo();
      await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", status: "confirmed" },
        {
          appointmentRepository: makeApptRepo(),
          calendarGateway: makeGateway(),
          leadRepository: leadRepo,
        },
      );
      expect(leadRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("status: scheduled", () => {
    it("cancela follow-ups pendentes ao voltar para scheduled", async () => {
      const followUpRepo = makeFollowUpRepo();
      await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", status: "scheduled" },
        {
          appointmentRepository: makeApptRepo(),
          calendarGateway: makeGateway(),
          followUpRepository: followUpRepo,
        },
      );
      expect(followUpRepo.cancelPendingByLead).toHaveBeenCalledWith({ leadId: "lead-1" });
    });
  });

  describe("side effects without repos", () => {
    it("succeeds without leadRepository (side effects skipped)", async () => {
      const result = await updateAppointment(
        { appointmentId: "appt-1", clinicId: "clinic-1", status: "completed" },
        { appointmentRepository: makeApptRepo(), calendarGateway: makeGateway() },
      );
      expect(result.success).toBe(true);
    });
  });
});
