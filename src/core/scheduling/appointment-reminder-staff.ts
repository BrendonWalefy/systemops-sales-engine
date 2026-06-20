import type { Appointment } from "@/domain/entities/calendar-slot";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

type PendingCompletionCandidate = Pick<Appointment, "status" | "endsAt">;

export function getStaffReminderWindows(
  timezone: ClinicTimezone,
  now: Date,
): {
  startOfToday: Date;
  startOfTomorrow: Date;
  startOfDayAfterTomorrow: Date;
} {
  const parts = timezone.toLocalParts(now);

  return {
    startOfToday: timezone.fromLocalParts(parts.year, parts.month, parts.day, 0, 0),
    startOfTomorrow: timezone.fromLocalParts(parts.year, parts.month, parts.day + 1, 0, 0),
    startOfDayAfterTomorrow: timezone.fromLocalParts(parts.year, parts.month, parts.day + 2, 0, 0),
  };
}

export function isPendingCompletionAppointment(
  appointment: PendingCompletionCandidate,
  now: Date,
): boolean {
  if (appointment.status !== "scheduled" && appointment.status !== "confirmed") {
    return false;
  }

  return appointment.endsAt < now;
}
