import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";

export type CalendarGateway = {
  listAvailableSlots(input: {
    clinicId: string;
    from: Date;
    to: Date;
    professionalId?: string;
  }): Promise<CalendarSlot[]>;
  createAppointment(input: {
    clinicId: string;
    leadId: string;
    startsAt: Date;
    endsAt: Date;
    title: string;
  }): Promise<Appointment>;
  cancelAppointment(input: {
    calendarEventId: string;
  }): Promise<void>;
};
