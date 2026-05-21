import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";

export class GoogleCalendarGateway implements CalendarGateway {
  async listAvailableSlots(input: {
    clinicId: string;
    from: Date;
    to: Date;
    professionalId?: string;
  }): Promise<CalendarSlot[]> {
    void input;
    throw new Error("Google Calendar availability adapter not implemented yet");
  }

  async createAppointment(input: {
    clinicId: string;
    leadId: string;
    startsAt: Date;
    endsAt: Date;
    title: string;
  }): Promise<Appointment> {
    void input;
    throw new Error("Google Calendar create appointment adapter not implemented yet");
  }
}

