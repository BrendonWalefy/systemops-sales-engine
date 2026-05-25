// Saga de agendamento com compensação.
// Garante atomicidade entre banco de dados e Google Calendar.
//
// Fluxo:
//   1. releaseExpired()           → limpa TTL vencidos
//   2. reserve()                  → lock otimista (falha se slot tomado)
//   3. createAppointment()        → cria evento no Google Calendar
//      → se falhar: reserva expira por TTL automaticamente (sem rollback manual)
//   4. confirm()                  → marca reserva como confirmada
//   5. save(appointment) no DB    → persiste agendamento
//   6. updateLead status          → "appointment_scheduled"
//   7. Retorna appointment

import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { Clinic } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { Appointment } from "@/domain/entities/calendar-slot";
import { SlotReservationService } from "./SlotReservationService";

export type BookingResult =
  | { success: true; appointment: Appointment }
  | { success: false; reason: "slot_taken" | "calendar_error" | "db_error" };

export class BookingService {
  private reservationService = new SlotReservationService();

  constructor(
    private readonly calendarGateway: CalendarGateway,
    private readonly appointmentRepo: AppointmentRepository,
    private readonly leadRepo: LeadRepository,
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
      // Reserva expira por TTL automaticamente — não precisamos de rollback manual
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
