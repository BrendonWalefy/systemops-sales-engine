// Atribuição de origem do agendamento.
//
// `source` não distingue quem agendou: os 4 chamadores do BookingService (IA pela
// conversa, operador pelo inbox, operador pela agenda, fluxo de sinal) gravavam
// todos "app". Sem distinguir, é impossível medir a conversão da IA — foi o que o
// diagnóstico histórico mostrou; contrato atual em docs/architecture/current.md.
//
// Estes testes travam o contrato: o `origin` recebido no input SEMPRE vence o que o
// gateway devolveu, inclusive no caminho de fallback (gateway indisponível).

import { describe, expect, it } from "vitest";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { Organization } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { Appointment, AppointmentOrigin } from "@/domain/entities/calendar-slot";
import type { SlotReservation } from "@/core/scheduling/SlotReservationService";
import { BookingService, type BookingReservationService } from "@/core/scheduling/BookingService";

const startsAt = new Date("2026-01-05T13:00:00.000Z");
const endsAt = new Date("2026-01-05T14:00:00.000Z");

const clinic = {
  id: "clinic-1",
  name: "Clínica Teste",
  timezone: "America/Sao_Paulo",
  calendarMode: "internal",
} as unknown as Organization;

const lead = { id: "lead-1", clinicId: "clinic-1", name: "Maria" } as unknown as Lead;

const reservation = { id: "res-1", status: "pending", leadId: "lead-1" } as unknown as SlotReservation;

function harness(opts: { gatewayFails?: boolean } = {}) {
  const saved: Appointment[] = [];

  const gateway = {
    async isSlotFree() { return true; },
    async createAppointment(input: Parameters<CalendarGateway["createAppointment"]>[0]): Promise<Appointment> {
      if (opts.gatewayFails) throw new Error("calendar unavailable");
      const now = new Date();
      return {
        id: "appt-1",
        clinicId: input.clinicId,
        leadId: input.leadId,
        professionalId: null,
        roomId: null,
        description: null,
        calendarEventId: "evt-1",
        calendarEventUrl: null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: "scheduled",
        source: "app",
        // O gateway não conhece o chamador — devolve null de propósito.
        origin: null,
        reminderSentAt: null,
        treatmentId: null,
        valueCents: null,
        createdAt: now,
        updatedAt: now,
      };
    },
    async cancelAppointment() {},
    async updateCalendarEvent() {},
    async listAvailableSlots() { return []; },
    async listBlockEvents() { return []; },
    async createBlockEvent() { throw new Error("not used"); },
    async deleteBlockEvent() {},
  } as unknown as CalendarGateway;

  const apptRepo = {
    async save(a: Appointment) { saved.push(a); },
    async findById() { return null; },
    async findByLeadId() { return null; },
    async findActiveByLeadId() { return null; },
    async findAllActiveByLeadId() { return []; },
    async findByPeriod() { return []; },
    async findDueReminders() { return []; },
    async findByCalendarEventId() { return null; },
  } as unknown as AppointmentRepository;

  const leadRepo = {
    async save() {},
    async findById() { return null; },
  } as unknown as LeadRepository;

  const reservationSvc = {
    async releaseExpired() {},
    async reserve() { return reservation; },
    async findById() { return null; },
    async confirm() {},
    async release() {},
    async releaseBySlot() {},
  } as unknown as BookingReservationService;

  return { service: new BookingService(gateway, apptRepo, leadRepo, reservationSvc), saved };
}

describe("atribuição de origem do agendamento", () => {
  const origens: AppointmentOrigin[] = [
    "ai_conversation",
    "operator_inbox",
    "operator_agenda",
    "deposit_flow",
  ];

  it.each(origens)("persiste origin=%s exatamente como recebido", async (origin) => {
    const { service, saved } = harness();
    const result = await service.book({ clinic, lead, startsAt, endsAt, origin });

    expect(result.success).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].origin).toBe(origin);
  });

  it("origin do input vence o null devolvido pelo gateway", async () => {
    const { service, saved } = harness();
    await service.book({ clinic, lead, startsAt, endsAt, origin: "ai_conversation" });

    // O gateway devolveu origin: null; quem manda é o input do BookingService.
    expect(saved[0].origin).toBe("ai_conversation");
    expect(saved[0].calendarEventId).toBe("evt-1"); // veio mesmo do gateway
  });

  it("preserva a origem no fallback quando o gateway falha", async () => {
    const { service, saved } = harness({ gatewayFails: true });
    const result = await service.book({ clinic, lead, startsAt, endsAt, origin: "operator_inbox" });

    expect(result.success).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].calendarEventId).toBeNull(); // caminho de fallback
    expect(saved[0].origin).toBe("operator_inbox");
  });

  it("origin nunca fica null quando o booking passa pelo serviço", async () => {
    const { service, saved } = harness();
    await service.book({ clinic, lead, startsAt, endsAt, origin: "deposit_flow" });

    // null é reservado para linhas anteriores à instrumentação — um agendamento
    // criado pelo serviço sempre precisa saber de onde veio.
    expect(saved[0].origin).not.toBeNull();
  });
});
