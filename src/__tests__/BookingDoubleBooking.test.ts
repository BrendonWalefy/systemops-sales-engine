import { describe, expect, it, vi } from "vitest";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { Organization } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { SlotReservation } from "@/core/scheduling/SlotReservationService";
import { BookingService, type BookingReservationService } from "@/core/scheduling/BookingService";

const startsAt = new Date("2026-01-05T13:00:00.000Z");
const endsAt = new Date("2026-01-05T14:00:00.000Z");

const clinic: Organization = {
  id: "clinic-1",
  name: "Clínica Teste",
  specialty: "odontologia",
  segment: "dental",
  serviceNoun: "tratamento",
  bookingNoun: "consulta",
  contactNoun: "paciente",
  agentRole: "recepcionista virtual",
  businessDescriptor: null,
  businessNoun: "clínica",
  city: null,
  address: null,
  timezone: "America/Sao_Paulo",
  greetingMessage: null,
  menuItems: null,
  businessHours: null,
  googleCalendarId: null,
  calendarMode: null,
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
  messageDebounceMs: null,
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
  profilePicUrl: null,
  status: "in_conversation",
  temperature: null,
  assignedToUserId: null,
  nextActionAt: null,
  lostReason: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const reservation: SlotReservation = {
  id: "reservation-1",
  clinicId: clinic.id,
  leadId: lead.id,
  startsAt,
  endsAt,
  status: "pending",
  calendarEventId: null,
  expiresAt: new Date("2026-01-05T13:10:00.000Z"),
};

function appointment(): Appointment {
  return {
    id: "appointment-1",
    clinicId: clinic.id,
    leadId: lead.id,
    professionalId: null,
    roomId: null,
    calendarEventId: "event-1",
    calendarEventUrl: null,
    startsAt,
    endsAt,
    status: "scheduled",
    source: "app",
    reminderSentAt: null,
    treatmentId: null,
    valueCents: null,
    createdAt: new Date("2026-01-05T12:00:00.000Z"),
    updatedAt: new Date("2026-01-05T12:00:00.000Z"),
  };
}

class FakeCalendarGateway implements CalendarGateway {
  isSlotFreeResult = true;
  isSlotFreeError: Error | null = null;
  createAppointmentError: Error | null = null;
  createAppointmentCalls = 0;
  lastCreatedTitle: string | null = null;

  constructor(private readonly order: string[]) {}

  async listAvailableSlots(): Promise<CalendarSlot[]> {
    return [];
  }

  async createAppointment(input: Parameters<CalendarGateway["createAppointment"]>[0]): Promise<Appointment> {
    this.order.push("createAppointment");
    this.createAppointmentCalls++;
    this.lastCreatedTitle = input.title;
    if (this.createAppointmentError) throw this.createAppointmentError;
    return appointment();
  }

  async cancelAppointment(): Promise<void> {}

  async listBlockEvents(): Promise<[]> {
    return [];
  }

  async createBlockEvent(): Promise<never> {
    throw new Error("not implemented");
  }

  async deleteBlockEvent(): Promise<void> {}
  async updateBlockEvent(): Promise<never> { throw new Error("not implemented"); }

  async isSlotFree(): Promise<boolean> {
    this.order.push("isSlotFree");
    if (this.isSlotFreeError) throw this.isSlotFreeError;
    return this.isSlotFreeResult;
  }

  async updateCalendarEvent(): Promise<void> {}
}

class FakeReservationService implements BookingReservationService {
  reservation: SlotReservation | null = reservation;
  releasedIds: string[] = [];
  confirmedIds: string[] = [];

  constructor(private readonly order: string[]) {}

  async releaseExpired(): Promise<void> {
    this.order.push("releaseExpired");
  }

  async reserve(): Promise<SlotReservation | null> {
    this.order.push("reserve");
    return this.reservation;
  }

  async confirm(reservationId: string): Promise<void> {
    this.order.push("confirm");
    this.confirmedIds.push(reservationId);
  }

  async release(reservationId: string): Promise<void> {
    this.order.push("release");
    this.releasedIds.push(reservationId);
  }

  async releaseBySlot(): Promise<void> {
    this.order.push("releaseBySlot");
  }
}

class FakeAppointmentRepository implements AppointmentRepository {
  saved: Appointment[] = [];
  saveError: Error | null = null;

  constructor(private readonly order: string[]) {}

  async save(input: Appointment): Promise<void> {
    this.order.push("saveAppointment");
    if (this.saveError) throw this.saveError;
    this.saved.push(input);
  }

  async findById(): Promise<Appointment | null> {
    return null;
  }

  async findByLeadId(): Promise<Appointment | null> {
    return null;
  }

  async findActiveByLeadId(): Promise<Appointment | null> {
    return null;
  }

  async findAllActiveByLeadId(): Promise<Appointment[]> {
    return [];
  }

  async findByPeriod(): Promise<Appointment[]> {
    return [];
  }

  async findDueReminders(): Promise<Appointment[]> {
    return [];
  }

  async findByCalendarEventId(): Promise<Appointment | null> {
    return null;
  }
}

class FakeLeadRepository implements LeadRepository {
  saved: Lead[] = [];

  constructor(private readonly order: string[]) {}

  async findById(): Promise<Lead | null> {
    return lead;
  }

  async findByPhone(): Promise<Lead | null> {
    return lead;
  }

  async findByWhatsAppLid(): Promise<Lead | null> {
    return null;
  }

  async findInactiveLeads(): Promise<Lead[]> {
    return [];
  }

  async mergeDuplicateLeads(): Promise<Lead> {
    return lead;
  }

  async save(input: Lead): Promise<void> {
    this.order.push("saveLead");
    this.saved.push(input);
  }
}

function setup() {
  const order: string[] = [];
  const calendar = new FakeCalendarGateway(order);
  const appointmentRepo = new FakeAppointmentRepository(order);
  const leadRepo = new FakeLeadRepository(order);
  const reservations = new FakeReservationService(order);
  const service = new BookingService(calendar, appointmentRepo, leadRepo, reservations);

  return { appointmentRepo, calendar, leadRepo, order, reservations, service };
}

async function bookWith(service: BookingService, treatmentName?: string) {
  return service.book({ clinic, lead, startsAt, endsAt, treatmentName });
}

describe("BookingService — título do evento no Calendar", () => {
  it("usa o nome do tratamento quando fornecido", async () => {
    const { calendar, service } = setup();
    await bookWith(service, "20 Lentes");
    expect(calendar.lastCreatedTitle).toBe("20 Lentes — Maria | Clínica Teste");
  });

  it("usa 'Consulta' quando treatmentName não é fornecido", async () => {
    const { calendar, service } = setup();
    await bookWith(service);
    expect(calendar.lastCreatedTitle).toBe("Consulta — Maria | Clínica Teste");
  });

  it("usa 'Paciente' quando o lead não tem nome cadastrado", async () => {
    const { calendar, service } = setup();
    const leadSemNome = { ...lead, name: null };
    await service.book({ clinic, lead: leadSemNome, startsAt, endsAt, treatmentName: "Avaliação" });
    expect(calendar.lastCreatedTitle).toBe("Avaliação — Paciente | Clínica Teste");
  });
});

describe("BookingService — double-booking guards", () => {
  it("revalidates the Calendar after reserving and before creating the appointment", async () => {
    const { appointmentRepo, calendar, leadRepo, order, reservations, service } = setup();

    const result = await bookWith(service);

    expect(result.success).toBe(true);
    expect(order).toEqual([
      "reserve",
      "isSlotFree",
      "createAppointment",
      "confirm",
      "saveAppointment",
      "saveLead",
    ]);
    expect(calendar.createAppointmentCalls).toBe(1);
    expect(reservations.confirmedIds).toEqual([reservation.id]);
    expect(appointmentRepo.saved).toHaveLength(1);
    expect(leadRepo.saved[0]?.status).toBe("appointment_scheduled");
  });

  it("returns slot_taken without checking Calendar when the optimistic reservation fails", async () => {
    const { calendar, order, reservations, service } = setup();
    reservations.reservation = null;

    const result = await bookWith(service);

    expect(result).toEqual({ success: false, reason: "slot_taken" });
    expect(order).toEqual(["reserve"]);
    expect(calendar.createAppointmentCalls).toBe(0);
  });

  it("releases the reservation and does not create an event when Calendar says the slot is occupied", async () => {
    const { calendar, order, reservations, service } = setup();
    calendar.isSlotFreeResult = false;

    const result = await bookWith(service);

    expect(result).toEqual({ success: false, reason: "slot_taken" });
    expect(order).toEqual(["reserve", "isSlotFree", "release"]);
    expect(reservations.releasedIds).toEqual([reservation.id]);
    expect(calendar.createAppointmentCalls).toBe(0);
  });

  it("assume slot livre e conclui o booking quando isSlotFree falha (GCal indisponível)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calendar, order, service } = setup();
    calendar.isSlotFreeError = new Error("calendar unavailable");

    const result = await bookWith(service);

    // GCal indisponível: o lock do DB + overlap check são proteção suficiente.
    // O booking prossegue em vez de falhar, para não bloquear agendamentos durante downtime do GCal.
    expect(result.success).toBe(true);
    expect(order).toContain("reserve");
    expect(order).toContain("isSlotFree");
    expect(calendar.createAppointmentCalls).toBe(1);

    consoleError.mockRestore();
  });

  it("saves the appointment without calendarEventId when event creation fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { appointmentRepo, calendar, order, reservations, service } = setup();
    calendar.createAppointmentError = new Error("create failed");

    const result = await bookWith(service);

    // Agendamento é salvo mesmo sem sync com o Google Calendar
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.appointment.calendarEventId).toBeNull();
      expect(result.appointment.calendarEventUrl).toBeNull();
    }
    expect(order).toEqual([
      "reserve", "isSlotFree", "createAppointment",
      "confirm", "saveAppointment", "saveLead",
    ]);
    // Reserva não é liberada — o slot fica bloqueado para o agendamento salvo
    expect(reservations.releasedIds).toEqual([]);
    expect(calendar.createAppointmentCalls).toBe(1);
    expect(appointmentRepo.saved).toHaveLength(1);

    consoleError.mockRestore();
  });
});
