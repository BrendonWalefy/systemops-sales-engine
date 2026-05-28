import type { CalendarGateway } from "@/application/ports/calendar-gateway";

export type SuggestAppointmentSlotsDependencies = {
  calendarGateway: CalendarGateway;
};

export class SuggestAppointmentSlots {
  constructor(private readonly deps: SuggestAppointmentSlotsDependencies) {}

  async execute(input: {
    clinicId: string;
    from: Date;
    to: Date;
    slotDurationMinutes: number;
    professionalId?: string;
  }) {
    return this.deps.calendarGateway.listAvailableSlots(input);
  }
}

