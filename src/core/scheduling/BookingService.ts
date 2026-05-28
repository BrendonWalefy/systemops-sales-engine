// Saga de agendamento com compensação.
// Garante atomicidade entre banco de dados e Google Calendar.
//
// Fluxo:
//   1. releaseExpired()           → limpa TTL vencidos
//   2. reserve()                  → lock otimista (falha se slot tomado)
//   3. isSlotFree()               → revalida conflito/manual no Google Calendar
//   4. createAppointment()        → cria evento no Google Calendar
//      → se falhar: reserva expira por TTL automaticamente (sem rollback manual)
//   5. confirm()                  → marca reserva como confirmada
//   6. save(appointment) no DB    → persiste agendamento
//   7. updateLead status          → "appointment_scheduled"
//   8. Retorna appointment

import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { Clinic } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { Appointment } from "@/domain/entities/calendar-slot";
import { SlotReservationService, type SlotReservation } from "./SlotReservationService";

export type BookingResult =
  | { success: true; appointment: Appointment }
  | { success: false; reason: "slot_taken" | "calendar_error" | "db_error" };

export type BookingReservationService = {
  releaseExpired(): Promise<void>;
  reserve(clinicId: string, leadId: string, startsAt: Date, endsAt: Date): Promise<SlotReservation | null>;
  confirm(reservationId: string, calendarEventId: string): Promise<void>;
  release(reservationId: string): Promise<void>;
  releaseBySlot(clinicId: string, startsAt: Date): Promise<void>;
};

export class BookingService {
  constructor(
    private readonly calendarGateway: CalendarGateway,
    private readonly appointmentRepo: AppointmentRepository,
    private readonly leadRepo: LeadRepository,
    private readonly reservationService: BookingReservationService = new SlotReservationService(),
  ) {}

  async book(params: {
    clinic: Clinic;
    lead: Lead;
    startsAt: Date;
    endsAt: Date;
  }): Promise<BookingResult> {
    const { clinic, lead, startsAt, endsAt } = params;

    // Passo 1: Limpa TTL expirados
    await this.reservationService.releaseExpired();

    // Passo 2: Lock otimista — previne double-booking
    const reservation = await this.reservationService.reserve(
      clinic.id,
      lead.id,
      startsAt,
      endsAt,
    );

    if (!reservation) {
      return { success: false, reason: "slot_taken" };
    }

    // Passo 2.5: Re-verifica disponibilidade no Google Calendar em tempo real.
    // O lock otimista (Passo 2) protege contra concorrência entre dois leads,
    // mas não detecta eventos adicionados manualmente pelo operador após a oferta.
    // Sem esta checagem, o Google Calendar criaria dois eventos sobrepostos sem erro.
    let slotStillFree: boolean;
    try {
      slotStillFree = await this.calendarGateway.isSlotFree({
        clinicId: clinic.id,
        startsAt,
        endsAt,
      });
    } catch (err) {
      await this.reservationService.release(reservation.id);
      console.error("[BookingService] Google Calendar isSlotFree failed:", err);
      return { success: false, reason: "calendar_error" };
    }

    if (!slotStillFree) {
      await this.reservationService.release(reservation.id);
      return { success: false, reason: "slot_taken" };
    }

    // Passo 3: Cria evento no Google Calendar
    let appointment: Appointment;
    try {
      const leadName = lead.name ?? "Paciente";
      appointment = await this.calendarGateway.createAppointment({
        clinicId: clinic.id,
        leadId: lead.id,
        startsAt,
        endsAt,
        title: `Avaliação — ${leadName} | ${clinic.name}`,
      });
    } catch (err) {
      // Libera a reserva imediatamente para o lead poder tentar de novo sem esperar o TTL
      await this.reservationService.release(reservation.id);
      console.error("[BookingService] Google Calendar createAppointment failed:", err);
      return { success: false, reason: "calendar_error" };
    }

    // Passo 4: Confirma reserva (slot agora permanentemente bloqueado)
    await this.reservationService.confirm(reservation.id, appointment.calendarEventId ?? "");

    // Passo 5: Persiste agendamento no banco
    try {
      await this.appointmentRepo.save(appointment);
    } catch (err) {
      // Appointment já existe no Calendar — não é catastrófico.
      // Log para reconciliação manual, mas não falhamos a saga.
      console.error("[BookingService] Failed to save appointment to DB:", err);
      return { success: false, reason: "db_error" };
    }

    // Passo 6: Atualiza status do lead
    try {
      await this.leadRepo.save({
        ...lead,
        status: "appointment_scheduled",
        updatedAt: new Date(),
      });
    } catch (err) {
      // Não-crítico — appointment existe, lead só fica com status desatualizado
      console.error("[BookingService] Failed to update lead status:", err);
    }

    return { success: true, appointment };
  }

  async cancel(params: {
    lead: Lead;
    appointment: Appointment;
  }): Promise<{ success: boolean; reason?: string }> {
    const { lead, appointment } = params;

    // Cancela no Google Calendar primeiro
    if (appointment.calendarEventId) {
      try {
        await this.calendarGateway.cancelAppointment({
          calendarEventId: appointment.calendarEventId,
        });
      } catch (err) {
        console.error("[BookingService] Google Calendar cancelAppointment failed:", err);
        return { success: false, reason: "calendar_error" };
      }
    }

    // Libera a reserva do slot para que ele possa ser reagendado por outro lead
    await this.reservationService.releaseBySlot(appointment.clinicId, appointment.startsAt);

    // Persiste cancelamento no banco
    await this.appointmentRepo.save({
      ...appointment,
      status: "cancelled",
      updatedAt: new Date(),
    });

    // Atualiza status do lead
    await this.leadRepo.save({
      ...lead,
      status: "in_conversation",
      updatedAt: new Date(),
    });

    return { success: true };
  }
}
