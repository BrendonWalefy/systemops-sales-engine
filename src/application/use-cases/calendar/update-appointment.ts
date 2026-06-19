import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import { cancelPendingFollowUps } from "@/application/use-cases/leads/cancel-pending-follow-ups";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import { scheduleFollowUp } from "@/application/use-cases/leads/schedule-follow-up";

export type UpdateAppointmentInput = {
  appointmentId: string;
  clinicId: string;
  status?: "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";
  startsAt?: Date;
  endsAt?: Date;
  professionalId?: string | null;
  roomId?: string | null;
  treatmentId?: string | null;
  valueCents?: number | null;
};

export async function updateAppointment(
  input: UpdateAppointmentInput,
  deps: {
    appointmentRepository: AppointmentRepository;
    calendarGateway: CalendarGateway;
    leadRepository?: LeadRepository;
    followUpRepository?: FollowUpRepository;
  },
): Promise<{ success: boolean; reason?: string }> {
  const existing = await deps.appointmentRepository.findById(input.appointmentId);

  if (!existing || existing.clinicId !== input.clinicId) {
    return { success: false, reason: "not_found" };
  }

  // Verificar disponibilidade antes de mover o evento
  if (input.startsAt && input.endsAt) {
    const slotFree = await deps.calendarGateway.isSlotFree({
      clinicId: input.clinicId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    if (!slotFree) {
      return { success: false, reason: "slot_taken" };
    }
  }

  // Sincronizar novo horário no Google Calendar (drag-and-drop)
  if (input.startsAt && input.endsAt && existing.calendarEventId) {
    try {
      await deps.calendarGateway.updateCalendarEvent({
        calendarEventId: existing.calendarEventId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      });
    } catch (err) {
      console.error("[updateAppointment] GCal update failed:", err);
      // Não bloquear o operador: salva no DB mesmo se GCal falhar
    }
  }

  await deps.appointmentRepository.save({
    ...existing,
    ...(input.status && { status: input.status }),
    ...(input.startsAt && { startsAt: input.startsAt }),
    ...(input.endsAt && { endsAt: input.endsAt }),
    ...(input.professionalId !== undefined && { professionalId: input.professionalId }),
    ...(input.roomId !== undefined && { roomId: input.roomId }),
    ...(input.treatmentId !== undefined && { treatmentId: input.treatmentId }),
    ...(input.valueCents !== undefined && { valueCents: input.valueCents }),
    updatedAt: new Date(),
  });

  if ((input.status === "scheduled" || input.status === "confirmed") && deps.followUpRepository) {
    try {
      await cancelPendingFollowUps({
        leadId: existing.leadId,
        followUpRepository: deps.followUpRepository,
      });
    } catch (err) {
      console.error("[updateAppointment] Failed to cancel pending follow-ups:", err);
    }
  }

  // Efeitos de status: atualizar lead + agendar follow-up
  if (input.status && deps.leadRepository) {
    try {
      const lead = await deps.leadRepository.findById(existing.leadId);
      if (lead) {
        if (input.status === "completed") {
          await deps.leadRepository.save({ ...lead, status: "won", updatedAt: new Date() });
          if (deps.followUpRepository) {
            await scheduleFollowUp({
              clinicId: existing.clinicId,
              leadId: existing.leadId,
              trigger: "appointment_completed",
              referenceDate: existing.startsAt,
              followUpRepository: deps.followUpRepository,
            });
          }
        } else if (input.status === "no_show") {
          await deps.leadRepository.save({ ...lead, status: "in_conversation", updatedAt: new Date() });
          if (deps.followUpRepository) {
            await scheduleFollowUp({
              clinicId: existing.clinicId,
              leadId: existing.leadId,
              trigger: "no_show",
              referenceDate: new Date(),
              followUpRepository: deps.followUpRepository,
            });
          }
        }
      }
    } catch (err) {
      // Não-crítico: o status do appointment já foi salvo
      console.error("[updateAppointment] Side-effect failed:", err);
    }
  }

  return { success: true };
}
