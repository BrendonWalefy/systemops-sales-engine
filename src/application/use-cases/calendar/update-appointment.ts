import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";

export type UpdateAppointmentInput = {
  appointmentId: string;
  clinicId: string;
  status?: "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";
  startsAt?: Date;
  endsAt?: Date;
  professionalId?: string | null;
  roomId?: string | null;
};

export async function updateAppointment(
  input: UpdateAppointmentInput,
  deps: {
    appointmentRepository: AppointmentRepository;
    calendarGateway: CalendarGateway;
  },
): Promise<{ success: boolean; reason?: string }> {
  const existing = await deps.appointmentRepository.findById(input.appointmentId);

  if (!existing || existing.clinicId !== input.clinicId) {
    return { success: false, reason: "not_found" };
  }

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

  await deps.appointmentRepository.save({
    ...existing,
    ...(input.status && { status: input.status }),
    ...(input.startsAt && { startsAt: input.startsAt }),
    ...(input.endsAt && { endsAt: input.endsAt }),
    ...(input.professionalId !== undefined && { professionalId: input.professionalId }),
    ...(input.roomId !== undefined && { roomId: input.roomId }),
    updatedAt: new Date(),
  });

  return { success: true };
}
