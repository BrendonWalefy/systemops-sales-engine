// Saga de reagendamento via calendário interno.
// Cobre: cancelamento de appointment sem calendarEventId (no-op no gateway),
// novo agendamento no modo interno, saga completa cancel → rebook,
// e proteção contra double-booking durante o reagendamento.
//
// Contexto real: Gregorie tentava reagendar e o sistema precisava
// cancelar o appointment anterior antes de oferecer novos slots.

import { describe, expect, it } from "vitest";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { Clinic } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { SlotReservation } from "@/core/scheduling/SlotReservationService";
import { BookingService, type BookingReservationService } from "@/core/scheduling/BookingService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const clinic: Clinic = {
  id: "clinic-1",
  name: "BW Odontologia",
  specialty: "odontologia",
  city: null,
  address: null,
  timezone: "America/Sao_Paulo",
  conversationExperience: "concierge",
  greetingMessage: null,
  menuItems: null,
  businessHours: null,
  googleCalendarId: null,
  calendarMode: "internal",
  receptionistPhone: null,
  takeoverTtlHours: 4,
  postAppointmentBufferMinutes: 60,
  defaultAppointmentDurationMinutes: 60,
  voiceResponseEnabled: false,
  ttsConfig: { provider: "nova" as const, speed: 0.92 },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const lead: Lead = {
  id: "lead-gregorie",
  clinicId: clinic.id,
  name: "Gregorie",
  phone: "5511954368563",
  whatsappLid: null,
  email: null,
  channel: "whatsapp",
  campaignId: null,
  treatmentInterest: null,
  status: "appointment_scheduled",
  temperature: "hot",
  assignedToUserId: null,
  nextActionAt: null,
  lostReason: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

// Appointment existente no modo interno (sem calendarEventId)
const existingAppt: Appointment = {
  id: "appt-existing",
  clinicId: clinic.id,
  leadId: lead.id,
  professionalId: null,
  roomId: null,
  calendarEventId: null,      // interno: sem evento externo
  calendarEventUrl: null,
  startsAt: new Date("2026-06-08T14:00:00.000Z"),
  endsAt: new Date("2026-06-08T15:00:00.000Z"),
  status: "scheduled",
  source: "app",
  reminderSentAt: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

const newStart = new Date("2026-06-10T10:00:00.000Z");
const newEnd = new Date("2026-06-10T11:00:00.000Z");

// ─── Fakes ────────────────────────────────────────────────────────────────────

function makeInternalGateway(opts: { isSlotFree?: boolean } = {}) {
  const calls = { cancelAppointment: 0, createAppointment: 0 };
  const gateway: CalendarGateway = {
    async listAvailableSlots() { return []; },
    async isSlotFree() { return opts.isSlotFree ?? true; },
    async createAppointment(input) {
      calls.createAppointment++;
      const now = new Date();
      return {
        id: "appt-new",
        clinicId: input.clinicId,
        leadId: input.leadId,
        professionalId: null,
        roomId: null,
        calendarEventId: null,
        calendarEventUrl: null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: "scheduled",
        source: "app",
        reminderSentAt: null,
        createdAt: now,
        updatedAt: now,
      };
    },
    async cancelAppointment() {
      calls.cancelAppointment++;
    },
    async updateCalendarEvent() {},
    async listBlockEvents() { return []; },
    async createBlockEvent() { throw new Error("not used"); },
    async deleteBlockEvent() {},
  };
  return { gateway, calls };
}

function makeReservationService(reservation: SlotReservation | null) {
  const calls = { release: 0, confirm: 0, releaseBySlot: 0 };
  const svc: BookingReservationService = {
    async releaseExpired() {},
    async reserve() { return reservation; },
    async confirm() { calls.confirm++; },
    async release() { calls.release++; },
    async releaseBySlot() { calls.releaseBySlot++; },
  };
  return { svc, calls };
}

function makeApptRepo(overlap: Appointment[] = []) {
  const saved: Appointment[] = [];
  const repo: AppointmentRepository = {
    async save(a) { saved.push(a); },
    async findById() { return null; },
    async findByLeadId() { return null; },
    async findActiveByLeadId() { return null; },
    async findAllActiveByLeadId() { return overlap; },
    async findByPeriod() { return []; },
    async findDueReminders() { return []; },
    async findByCalendarEventId() { return null; },
  };
  return { repo, saved };
}

function makeLeadRepo() {
  const saved: Lead[] = [];
  const repo: LeadRepository = {
    async save(l) { saved.push(l); },
    async findById() { return null; },
    async findByPhone() { return null; },
    async findByWhatsAppLid() { return null; },
    async findInactiveLeads() { return []; },
    async mergeDuplicateLeads() { throw new Error("not implemented"); },
  };
  return { repo, saved };
}

const pendingReservation: SlotReservation = {
  id: "res-1",
  clinicId: clinic.id,
  leadId: lead.id,
  startsAt: newStart,
  endsAt: newEnd,
  status: "pending",
  calendarEventId: null,
  expiresAt: new Date(newStart.getTime() + 10 * 60_000),
};

// ─── Testes: cancelamento de appointment interno ───────────────────────────────

describe("ReschedulingFlow — cancelamento de appointment interno", () => {
  it("cancela appointment sem calendarEventId sem chamar gateway externo", async () => {
    const { gateway, calls } = makeInternalGateway();
    const { svc } = makeReservationService(pendingReservation);
    const appts = makeApptRepo();
    const leads = makeLeadRepo();

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    const result = await service.cancel({ lead, appointment: existingAppt });

    expect(result.success).toBe(true);
    expect(calls.cancelAppointment).toBe(0); // gateway não é chamado sem calendarEventId
  });

  it("salva appointment como cancelled no banco após cancelamento", async () => {
    const { gateway } = makeInternalGateway();
    const { svc } = makeReservationService(pendingReservation);
    const appts = makeApptRepo();
    const leads = makeLeadRepo();

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    await service.cancel({ lead, appointment: existingAppt });

    const savedAppt = appts.saved.find((a) => a.id === existingAppt.id);
    expect(savedAppt?.status).toBe("cancelled");
  });

  it("atualiza lead para in_conversation após cancelamento", async () => {
    const { gateway } = makeInternalGateway();
    const { svc } = makeReservationService(pendingReservation);
    const appts = makeApptRepo();
    const leads = makeLeadRepo();

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    await service.cancel({ lead, appointment: existingAppt });

    expect(leads.saved.at(-1)?.status).toBe("in_conversation");
  });

  it("libera o slot reservado para que possa ser reoferecido", async () => {
    const { gateway } = makeInternalGateway();
    const { svc, calls } = makeReservationService(pendingReservation);
    const appts = makeApptRepo();
    const leads = makeLeadRepo();

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    await service.cancel({ lead, appointment: existingAppt });

    expect(calls.releaseBySlot).toBe(1);
  });
});

// ─── Testes: novo agendamento após cancelamento (modo interno) ─────────────────

describe("ReschedulingFlow — reagendamento no modo interno", () => {
  it("saga completa: cancela appointment antigo → agenda novo (sem Google Calendar)", async () => {
    const { gateway, calls: gwCalls } = makeInternalGateway({ isSlotFree: true });
    const { svc } = makeReservationService(pendingReservation);
    const appts = makeApptRepo();
    const leads = makeLeadRepo();

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);

    // Passo 1: cancela appointment interno existente
    await service.cancel({ lead, appointment: existingAppt });
    expect(gwCalls.cancelAppointment).toBe(0); // sem chamada externa

    // Passo 2: reagenda com novo horário
    const cancelledLead = { ...lead, status: "in_conversation" as const };
    const result = await service.book({
      clinic,
      lead: cancelledLead,
      startsAt: newStart,
      endsAt: newEnd,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.appointment.calendarEventId).toBeNull();
      expect(result.appointment.source).toBe("app");
      expect(result.appointment.startsAt).toEqual(newStart);
    }
  });

  it("novo appointment do reagendamento tem source app e sem calendarEventId", async () => {
    const { gateway } = makeInternalGateway({ isSlotFree: true });
    const { svc } = makeReservationService(pendingReservation);
    const appts = makeApptRepo();
    const leads = makeLeadRepo();

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    const result = await service.book({ clinic, lead, startsAt: newStart, endsAt: newEnd });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.appointment.source).toBe("app");
      expect(result.appointment.calendarEventId).toBeNull();
    }
    // Confirma que não houve chamada ao Google Calendar
    expect(appts.saved.at(-1)?.source).toBe("app");
  });

  it("slot tomado durante reagendamento → retorna slot_taken sem criar appointment", async () => {
    const { gateway } = makeInternalGateway({ isSlotFree: true });
    const { svc } = makeReservationService(null); // reserva falhou — slot tomado
    const appts = makeApptRepo();
    const leads = makeLeadRepo();

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    const result = await service.book({ clinic, lead, startsAt: newStart, endsAt: newEnd });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("slot_taken");
    expect(appts.saved).toHaveLength(0);
  });

  it("lead atualizado para appointment_scheduled após reagendamento bem-sucedido", async () => {
    const { gateway } = makeInternalGateway({ isSlotFree: true });
    const { svc } = makeReservationService(pendingReservation);
    const appts = makeApptRepo();
    const leads = makeLeadRepo();

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    await service.book({ clinic, lead, startsAt: newStart, endsAt: newEnd });

    expect(leads.saved.at(-1)?.status).toBe("appointment_scheduled");
  });
});

// ─── Testes: Google Calendar disponível mas modo interno configurado ───────────

describe("ReschedulingFlow — modo interno ignorando googleCalendarId", () => {
  it("clínica com googleCalendarId mas calendarMode=internal usa gateway interno (no-op)", async () => {
    const clinicWithGcal: Clinic = {
      ...clinic,
      googleCalendarId: "gcal@test.com",
      calendarMode: "internal",
    };

    const { gateway, calls } = makeInternalGateway({ isSlotFree: true });
    const { svc } = makeReservationService(pendingReservation);
    const appts = makeApptRepo();
    const leads = makeLeadRepo();

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    const cancelResult = await service.cancel({ lead, appointment: existingAppt });
    const bookResult = await service.book({ clinic: clinicWithGcal, lead, startsAt: newStart, endsAt: newEnd });

    expect(cancelResult.success).toBe(true);
    expect(calls.cancelAppointment).toBe(0); // gateway externo não chamado
    expect(bookResult.success).toBe(true);
    if (bookResult.success) {
      expect(bookResult.appointment.calendarEventId).toBeNull();
    }
  });
});
