// Saga de agendamento com compensação.
// Garante atomicidade entre banco de dados e o gateway de calendario efetivo.
//
// Fluxo:
//   1. reserve()                  → lock otimista (chama releaseExpired internamente; falha se slot tomado)
//   2. isSlotFree()               → revalida conflito/manual no CalendarGateway
//   3. createAppointment()        → cria evento externo ou appointment interno
//      → se falhar: reserva expira por TTL automaticamente (sem rollback manual)
//   4. confirm()                  → marca reserva como confirmada
//   5. save(appointment) no DB    → persiste agendamento
//   6. updateLead status          → "appointment_scheduled"
//   7. Retorna appointment

import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import type { Organization } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { Appointment, AppointmentOrigin } from "@/domain/entities/calendar-slot";
import { SlotReservationService, type SlotReservation } from "./SlotReservationService";
import { cancelPendingFollowUps } from "@/application/use-cases/leads/cancel-pending-follow-ups";
import {
  calculateFollowUpDueAt,
  scheduleFollowUp,
} from "@/application/use-cases/leads/schedule-follow-up";

export type BookingResult =
  | { success: true; appointment: Appointment }
  | { success: false; reason: "slot_taken" | "calendar_error" | "db_error" };

export type AppointmentConfirmationResult =
  | { success: true; appointment: Appointment }
  | {
      success: false;
      reason: "invalid_binding" | "appointment_not_active" | "db_error";
    };

export type BookingReservationService = {
  releaseExpired(): Promise<void>;
  reserve(clinicId: string, leadId: string, startsAt: Date, endsAt: Date, ttlMinutes?: number): Promise<SlotReservation | null>;
  confirm(reservationId: string, calendarEventId: string | null): Promise<void>;
  release(reservationId: string): Promise<void>;
  releaseBySlot(clinicId: string, startsAt: Date): Promise<void>;
  findById?(reservationId: string): Promise<SlotReservation | null>;
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
    clinic: Organization;
    lead: Lead;
    startsAt: Date;
    endsAt: Date;
    treatmentName?: string;
    treatmentId?: string | null;
    valueCents?: number | null;
    // Reserva provisória já feita (fluxo de sinal). Reaproveita o hold do próprio lead
    // em vez de tentar reservar de novo e colidir consigo mesmo (slot_taken falso).
    heldReservationId?: string | null;
    // Obrigatório: sem isso não há como medir a conversão da IA — os 4 chamadores
    // deste serviço gravavam todos `source: "app"`, tornando a origem indistinguível.
    // Ver docs/architecture/current.md (Agenda).
    origin: AppointmentOrigin;
  }): Promise<BookingResult> {
    const { clinic, lead, startsAt, endsAt, treatmentName, treatmentId = null, valueCents = null, heldReservationId = null, origin } = params;

    // Passo 1: Lock otimista — previne double-booking. Se veio um hold do fluxo de
    // sinal ainda pendente para o mesmo lead/slot, reaproveita-o; senão, reserva do zero.
    let reservation: SlotReservation | null = null;
    if (heldReservationId && this.reservationService.findById) {
      const held = await this.reservationService.findById(heldReservationId);
      if (
        held &&
        held.status === "pending" &&
        held.leadId === lead.id &&
        held.startsAt.getTime() === startsAt.getTime()
      ) {
        reservation = held;
      }
    }
    if (!reservation) {
      reservation = await this.reservationService.reserve(clinic.id, lead.id, startsAt, endsAt);
    }

    if (!reservation) {
      return { success: false, reason: "slot_taken" };
    }

    // Passo 1.5: Verifica a tabela de appointments para agendamentos criados
    // por outro fluxo e não cobertos pelo lock de reserva.
    const candidates = await this.appointmentRepo.findByPeriod(
      clinic.id,
      startsAt,
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

    // Passo 2.5: Re-verifica disponibilidade no gateway efetivo em tempo real.
    // O lock otimista (Passo 2) protege contra concorrência entre dois leads,
    // mas não detecta eventos ou bloqueios adicionados manualmente após a oferta.
    let slotStillFree: boolean;
    try {
      slotStillFree = await this.calendarGateway.isSlotFree({
        clinicId: clinic.id,
        startsAt,
        endsAt,
      });
    } catch (err) {
      // Gateway indisponível — fail-open consciente: assume slot livre e prossegue.
      // A reserva no DB (Passo 1, com exclusion constraint de overlap) e o check
      // de appointments (Passo 1.5) protegem contra double-booking interno; o que
      // fica descoberto são eventos criados MANUALMENTE no calendar externo.
      console.warn(JSON.stringify({
        level: "warn",
        scope: "BookingService",
        msg: "isSlotFree falhou — prosseguindo fail-open (verificar conflitos manuais no calendar)",
        clinicId: clinic.id,
        startsAt: startsAt.toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
      slotStillFree = true;
    }

    if (!slotStillFree) {
      await this.reservationService.release(reservation.id);
      return { success: false, reason: "slot_taken" };
    }

    // Passo 3: Cria o appointment via gateway efetivo.
    // Se o gateway externo falhar, o agendamento é salvo sem calendarEventId.
    const leadName = lead.name ?? "Paciente";
    const procedureLabel = treatmentName ?? "Consulta";
    let appointment: Appointment;
    const now = new Date();
    try {
      const created = await this.calendarGateway.createAppointment({
        clinicId: clinic.id,
        leadId: lead.id,
        startsAt,
        endsAt,
        title: `${procedureLabel} — ${leadName} | ${clinic.name}`,
      });
      // O gateway devolve origin: null (não conhece o chamador); a origem real é a
      // que veio no input deste serviço.
      appointment = { ...created, treatmentId, valueCents, origin };
    } catch (err) {
      console.error("[BookingService] CalendarGateway createAppointment failed:", err);
      appointment = {
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        leadId: lead.id,
        professionalId: null,
        roomId: null, description: null,
        calendarEventId: null,
        calendarEventUrl: null,
        startsAt,
        endsAt,
        status: "scheduled",
        source: "app",
        origin,
        reminderSentAt: null,
        treatmentId,
        valueCents,
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
      console.error("[BookingService] Failed to save appointment to DB:", err);
      return { success: false, reason: "db_error" };
    }

    // Passo 6: Atualiza status do lead
    try {
      await this.leadRepo.save({
        ...lead,
        status: "appointment_scheduled",
        nextActionAt: null,
        updatedAt: new Date(),
      });
    } catch (err) {
      // Não-crítico — appointment existe, lead só fica com status desatualizado
      console.error("[BookingService] Failed to update lead status:", err);
    }

    // Passo 7: lead acabou de reengajar e/ou agendar — follow-ups pendentes
    // anteriores ficam obsoletos e não devem disparar depois do booking.
    if (this.followUpRepository) {
      try {
        await cancelPendingFollowUps({
          leadId: lead.id,
          followUpRepository: this.followUpRepository,
        });
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

  async confirmAppointment(params: {
    clinic: Organization;
    lead: Lead;
    appointment: Appointment;
  }): Promise<AppointmentConfirmationResult> {
    const { clinic, lead, appointment } = params;
    if (
      lead.clinicId !== clinic.id ||
      appointment.clinicId !== clinic.id ||
      appointment.leadId !== lead.id
    ) {
      return { success: false, reason: "invalid_binding" };
    }
    if (appointment.status === "confirmed") {
      return { success: true, appointment };
    }
    if (appointment.status !== "scheduled") {
      return { success: false, reason: "appointment_not_active" };
    }

    const confirmed = {
      ...appointment,
      status: "confirmed" as const,
      updatedAt: new Date(),
    };
    try {
      await this.appointmentRepo.save(confirmed);
    } catch (err) {
      console.error("[BookingService] Failed to confirm appointment in DB:", err);
      return { success: false, reason: "db_error" };
    }
    return { success: true, appointment: confirmed };
  }

  async cancel(params: {
    lead: Lead;
    appointment: Appointment;
  }): Promise<{ success: boolean; reason?: string }> {
    const { lead, appointment } = params;

    // Cancela no gateway externo quando houver evento remoto. O banco é sempre
    // atualizado independentemente para manter a agenda interna coerente.
    if (appointment.calendarEventId) {
      try {
        await this.calendarGateway.cancelAppointment({
          calendarEventId: appointment.calendarEventId,
        });
      } catch (err) {
        console.error("[BookingService] CalendarGateway cancelAppointment failed — prosseguindo com cancelamento no banco:", err);
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
      status: "follow_up_due",
      nextActionAt: this.followUpRepository
        ? calculateFollowUpDueAt("appointment_cancelled", new Date())
        : new Date(),
      updatedAt: new Date(),
    });

    if (this.followUpRepository) {
      try {
        await cancelPendingFollowUps({
          leadId: lead.id,
          followUpRepository: this.followUpRepository,
        });
        await scheduleFollowUp({
          clinicId: appointment.clinicId,
          leadId: lead.id,
          trigger: "appointment_cancelled",
          referenceDate: new Date(),
          followUpRepository: this.followUpRepository,
        });
      } catch (err) {
        console.error("[BookingService] Failed to schedule cancellation follow-up:", err);
      }
    }

    return { success: true };
  }
}
