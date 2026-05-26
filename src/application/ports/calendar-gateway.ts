import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";

export type BlockEvent = {
  calendarEventId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
};

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
  listBlockEvents(input: {
    clinicId: string;
    from: Date;
    to: Date;
  }): Promise<BlockEvent[]>;
  createBlockEvent(input: {
    clinicId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
  }): Promise<BlockEvent>;
  deleteBlockEvent(input: {
    calendarEventId: string;
  }): Promise<void>;
};
