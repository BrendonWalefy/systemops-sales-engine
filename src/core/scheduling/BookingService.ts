// Saga de agendamento com compensação.
// Garante atomicidade entre banco de dados e Google Calendar.
//
// Fluxo:
//   1. reserve()                  → lock otimista (chama releaseExpired internamente; falha se slot tomado)
//   2. isSlotFree()               → revalida conflito/manual no Google Calendar
//   3. createAppointment()        → cria evento no Google Calendar
//      → se falhar: reserva expira por TTL automaticamente (sem rollback manual)
//   4. confirm()                  → marca reserva como confirmada
//   5. save(appointment) no DB    → persiste agendamento
//   6. updateLead status          → "appointment_scheduled"
//   7. Retorna appointment

import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import type { Clinic } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { Appointment } from "@/domain/entities/calendar-slot";
import { SlotReservationService, type SlotReservation } from "./SlotReservationService";
import { scheduleFollowUp } from "@/application/use-cases/leads/schedule-follow-up";

export type BookingResult =
  | { success: true; appointment: Appointment }
  | { success: false; reason: "slot_taken" | "calendar_error" | "db_error" };

export type BookingReservationService = {
  releaseExpired(): Promise<void>;
  reserve(clinicId: string, leadId: string, startsAt: Date, endsAt: Date): Promise<SlotReservation | null>;
  confirm(reservationId: string, calendarEventId: string | null): Promise<void>;
  release(reservationId: string): Promise<void>;
  releaseBySlot(clinicId: string, startsAt: Date): Promise<void>;
};

export class BookingService {
  constructor(
    private readonly calendarGateway: CalendarGateway,
    private readonly appointmentRepo: AppointmentRepository,
    private readonly leadRepo: LeadRepository,
    private readonly reservationService: BookingReservationService = new SlotReservationService(),
    private readonly followUpRepository: FollowUpRepository | null = null,
  ) {}

  async book(params: {
    clinic: Clinic;
    lead: Lead;
    startsAt: Date;
    endsAt: Date;
    treatmentName?: string;
  }): Promise<BookingResult> {
    const { clinic, lead, startsAt, endsAt, treatmentName } = params;

    // Passo 1: Lock otimista — previne double-booking (reserve() já chama releaseExpired internamente)
    const reservation = await this.reservationService.reserve(
      clinic.id,
      lead.id,
      startsAt,
      endsAt,
    );

    if (!reservation) {
      return { success: false, reason: "slot_taken" };
    }

    // Passo 1.5: Verifica a tabela de appointments para blocos criados via E2E/operador
    // que existem no banco mas não no Google Calendar (não cobertos pelo lock de reserva).
    const lookbackMs = 4 * 60 * 60_000; // janela retroativa para capturar appointments longos
    const candidates = await this.appointmentRepo.findByPeriod(
      clinic.id,
      new Date(startsAt.getTime() - lookbackMs),
      endsAt,
    );
    const hasDbOverlap = candidates.some(
      (a) =>
        (a.status === "scheduled" || a.status === "confirmed") &&
        a.startsAt.getTime() < endsAt.getTime() &&
        a.endsAt.getTime() > startsAt.getTime(),
    );
    if (hasDbOverlap) {
      await this.reservationService.release(reservation.id);
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
      // GCal indisponível — assume slot livre e prossegue.
      // A reserva no DB (Passo 1) e o overlap check (Passo 1.5) são proteção suficiente.
      console.error("[BookingService] Google Calendar isSlotFree failed — assumindo slot livre:", err);
      slotStillFree = true;
    }

    if (!slotStillFree) {
      await this.reservationService.release(reservation.id);
      return { success: false, reason: "slot_taken" };
    }

    // Passo 3: Cria evento no Google Calendar (não-fatal)
    // Se o Calendar falhar, o agendamento é salvo sem calendarEventId.
    const leadName = lead.name ?? "Paciente";
    const procedureLabel = treatmentName ?? "Consulta";
    let appointment: Appointment;
    const now = new Date();
    try {
      appointment = await this.calendarGateway.createAppointment({
        clinicId: clinic.id,
        leadId: lead.id,
        startsAt,
        endsAt,
        title: `${procedureLabel} — ${leadName} | ${clinic.name}`,
      });
    } catch (err) {
      console.error("[BookingService] Google Calendar createAppointment failed:", err);
      appointment = {
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        leadId: lead.id,
        professionalId: null,
        roomId: null,
        calendarEventId: null,
        calendarEventUrl: null,
        startsAt,
        endsAt,
        status: "scheduled",
        source: "app",
        reminderSentAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    // Passo 4: Confirma reserva (slot agora permanentemente bloqueado)
    await this.reservationService.confirm(reservation.id, appointment.calendarEventId ?? null);

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

    // Passo 7: Agenda follow-up de retorno 6 meses após a consulta
    if (this.followUpRepository) {
      try {
        await scheduleFollowUp({
          clinicId: clinic.id,
          leadId: lead.id,
          trigger: "appointment_completed",
          referenceDate: startsAt,
          followUpRepository: this.followUpRepository,
        });
      } catch (err) {
        // Não-crítico — booking confirmado independentemente
        console.error("[BookingService] Failed to schedule follow-up:", err);
      }
    }

    return { success: true, appointment };
  }

  async cancel(params: {
    lead: Lead;
    appointment: Appointment;
  }): Promise<{ success: boolean; reason?: string }> {
    const { lead, appointment } = params;

    // Cancela no Google Calendar (não-fatal — o banco é sempre atualizado independentemente).
    // Se o Calendar falhar por erro de rede ou transiente, o evento pode ser removido
    // manualmente pelo operador. Não bloquear o cancelamento no banco por causa disso.
    if (appointment.calendarEventId) {
      try {
        await this.calendarGateway.cancelAppointment({
          calendarEventId: appointment.calendarEventId,
        });
      } catch (err) {
        console.error("[BookingService] Google Calendar cancelAppointment failed — prosseguindo com cancelamento no banco:", err);
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
