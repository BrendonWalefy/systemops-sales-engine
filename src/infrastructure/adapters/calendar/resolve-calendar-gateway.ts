import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { InternalCalendarGateway } from "@/infrastructure/adapters/calendar/internal/internal-calendar-gateway";

export type CalendarMode = "internal" | "google_calendar";

export type CalendarResolutionInput = {
  clinicId: string;
  /** Valor da coluna clinics.calendarMode. Null = derivar de googleCalendarId. */
  calendarMode: CalendarMode | null;
  googleCalendarId: string | null;
  timezone: ClinicTimezone;
  businessHours: string | null;
  postAppointmentBufferMinutes?: number;
};

/**
 * Deriva o modo efetivo. Regra de segurança da migração:
 *  - calendarMode explícito → respeita.
 *  - Senão, clínica COM googleCalendarId → "google_calendar" (preserva legado).
 *  - Senão (sem GCal) → "internal".
 */
export function resolveCalendarMode(input: {
  calendarMode: CalendarMode | null;
  googleCalendarId: string | null;
}): CalendarMode {
  if (input.calendarMode) return input.calendarMode;
  return input.googleCalendarId ? "google_calendar" : "internal";
}

/**
 * Ponto único de instanciação do gateway. Sempre retorna a port CalendarGateway —
 * os consumidores (BookingService, updateAppointment, orchestrator) não conhecem
 * a implementação concreta.
 */
export function resolveCalendarGateway(input: CalendarResolutionInput): CalendarGateway {
  const mode = resolveCalendarMode(input);

  if (mode === "google_calendar") {
    return new GoogleCalendarGateway(
      input.googleCalendarId,
      input.timezone,
      input.businessHours,
      input.postAppointmentBufferMinutes ?? 0,
    );
  }

  return new InternalCalendarGateway({
    timezone: input.timezone,
    businessHours: input.businessHours,
    postAppointmentBufferMinutes: input.postAppointmentBufferMinutes ?? 0,
  });
}
