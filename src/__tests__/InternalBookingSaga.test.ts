// Saga de agendamento no MODO INTERNO. O BookingService é agnóstico de gateway,
// então aqui usamos fakes com a semântica do InternalCalendarGateway:
// createAppointment devolve calendarEventId null + source "app"; cancel é no-op.
// Cobre: booking ok, double booking por reserva, double booking por overlap no
// banco (Passo 1.5) e cancelamento.

import { describe, expect, it, beforeEach } from "vitest";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { Clinic } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { SlotReservation } from "@/core/scheduling/SlotReservationService";
import { BookingService, type BookingReservationService } from "@/core/scheduling/BookingService";

const startsAt = new Date("2026-01-05T13:00:00.000Z");
const endsAt = new Date("2026-01-05T14:00:00.000Z");

const clinic: Clinic = {
  id: "clinic-1",
  name: "Clínica Interna",
  specialty: "odontologia",
  city: null,
  address: null,
  timezone: "America/Sao_Paulo",
  conversationExperience: "menu_first",
  greetingMessage: null,
  menuItems: null,
  businessHours: null,
  googleCalendarId: null,
  calendarMode: "internal",
  receptionistPhone: null,
  takeoverTtlHours: 4,
  postAppointmentBufferMinutes: 60,
  defaultAppointmentDurationMinutes: 60,
  rateLimitPerHour: 60,
  unclearThreshold: 3,
  staleConversationHours: 4,
  slotOfferTtlMinutes: 15,
  maxSlotsToOffer: 5,
  slotLookaheadDays: 14,
  mediaTakeoverTtlHours: null,
  rapidThrottleMs: 4000,
  voiceResponseEnabled: false,
  ttsConfig: { provider: "nova" as const, speed: 0.92 },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const lead: Lead = {
  id: "lead-1",
  clinicId: clinic.id,
  name: "Maria",
  phone: "5511999999999",
  whatsappLid: null,
  email: null,
  channel: "whatsapp",
  campaignId: null,
  treatmentInterest: null,
  status: "in_conversation",
  temperature: null,
  assignedToUserId: null,
  nextActionAt: null,
  lostReason: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

// Gateway com semântica do modo interno: appointment sem evento externo.
function internalGateway(over: Partial<{ isSlotFree: boolean }> = {}) {
  const calls = { cancelAppointment: 0 };
  const gateway = {
    async listAvailableSlots() {
      return [];
    },
    async isSlotFree() {
      return over.isSlotFree ?? true;
    },
    async createAppointment(input: Parameters<CalendarGateway["createAppointment"]>[0]): Promise<Appointment> {
      const now = new Date();
      return {
        id: "appt-internal-1",
        clinicId: input.clinicId,
        leadId: input.leadId,
        professionalId: null,
        roomId: null,
        calendarEventId: null, // interno: sem evento externo
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
    async listBlockEvents() {
      return [];
    },
    async createBlockEvent() {
      throw new Error("not used");
    },
    async deleteBlockEvent() {},
  } as unknown as CalendarGateway;
  return { gateway, calls };
}

function reservationService(reservation: SlotReservation | null) {
  const calls = { release: 0, confirm: 0, releaseBySlot: 0 };
  const svc = {
    async releaseExpired() {},
    async reserve() {
      return reservation;
    },
    async confirm() {
      calls.confirm++;
    },
    async release() {
      calls.release++;
    },
    async releaseBySlot() {
      calls.releaseBySlot++;
    },
  } as unknown as BookingReservationService;
  return { svc, calls };
}

function apptRepo(overlap: Appointment[] = []) {
  const saved: Appointment[] = [];
  const repo = {
    async save(a: Appointment) {
      saved.push(a);
    },
    async findById() {
      return null;
    },
    async findByLeadId() {
      return null;
    },
    async findActiveByLeadId() {
      return null;
    },
    async findAllActiveByLeadId() {
      return [];
    },
    async findByPeriod() {
      return overlap;
    },
    async findDueReminders() {
      return [];
    },
    async findByCalendarEventId() {
      return null;
    },
  } as unknown as AppointmentRepository;
  return { repo, saved };
}

function leadRepo() {
  const saved: Lead[] = [];
  const repo = { async save(l: Lead) { saved.push(l); }, async findById() { return null; } } as unknown as LeadRepository;
  return { repo, saved };
}

const aReservation: SlotReservation = {
  id: "res-1",
  clinicId: clinic.id,
  leadId: lead.id,
  startsAt,
  endsAt,
  status: "pending",
  calendarEventId: null,
  expiresAt: new Date("2026-01-05T13:10:00.000Z"),
};

describe("BookingService — modo interno", () => {
  let leads: ReturnType<typeof leadRepo>;
  beforeEach(() => {
    leads = leadRepo();
  });

  it("agenda com sucesso e persiste appointment interno (calendarEventId null, source app)", async () => {
    const { gateway } = internalGateway({ isSlotFree: true });
    const { svc } = reservationService(aReservation);
    const appts = apptRepo([]);

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    const result = await service.book({ clinic, lead, startsAt, endsAt });

    expect(result.success).toBe(true);
    expect(appts.saved).toHaveLength(1);
    expect(appts.saved[0].calendarEventId).toBeNull();
    expect(appts.saved[0].source).toBe("app");
    expect(leads.saved[0].status).toBe("appointment_scheduled");
  });

  it("double booking: reserva negada (slot já travado) retorna slot_taken sem salvar", async () => {
    const { gateway } = internalGateway({ isSlotFree: true });
    const { svc } = reservationService(null); // segundo lead não consegue reservar
    const appts = apptRepo([]);

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    const result = await service.book({ clinic, lead, startsAt, endsAt });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("slot_taken");
    expect(appts.saved).toHaveLength(0);
  });

  it("double booking: overlap detectado no banco (Passo 1.5) libera a reserva e retorna slot_taken", async () => {
    const conflicting: Appointment = {
      id: "existing-1",
      clinicId: clinic.id,
      leadId: "outro-lead",
      professionalId: null,
      roomId: null,
      calendarEventId: null,
      calendarEventUrl: null,
      startsAt,
      endsAt,
      status: "scheduled",
      source: "app",
      reminderSentAt: null,
      createdAt: new Date("2026-01-05T12:00:00.000Z"),
      updatedAt: new Date("2026-01-05T12:00:00.000Z"),
    };
    const { gateway } = internalGateway({ isSlotFree: true });
    const { svc, calls } = reservationService(aReservation);
    const appts = apptRepo([conflicting]);

    const service = new BookingService(gateway, appts.repo, leads.repo, svc);
    const result = await service.book({ clinic, lead, startsAt, endsAt });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("slot_taken");
    expect(calls.release).toBe(1);
    expect(appts.saved).toHaveLength(0);
  });

  it("cancelamento: persiste status cancelled no banco mesmo com gateway no-op", async () => {
    const { gateway, calls } = internalGateway();
    const { svc } = reservationService(aReservation);
    const appts = apptRepo([]);
    const service = new BookingService(gateway, appts.repo, leads.repo, svc);

    const appointment: Appointment = {
      id: "appt-internal-1",
      clinicId: clinic.id,
      leadId: lead.id,
      professionalId: null,
      roomId: null,
      calendarEventId: null, // interno
      calendarEventUrl: null,
      startsAt,
      endsAt,
      status: "scheduled",
      source: "app",
      reminderSentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await service.cancel({ lead, appointment });

    expect(result.success).toBe(true);
    expect(appts.saved.at(-1)?.status).toBe("cancelled");
    expect(leads.saved.at(-1)?.status).toBe("in_conversation");
    // Sem calendarEventId, o gateway externo não é chamado.
    expect(calls.cancelAppointment).toBe(0);
  });
});
