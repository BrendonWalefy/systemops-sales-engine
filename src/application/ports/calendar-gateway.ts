import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";
import type { TreatmentBookingWindow } from "@/domain/entities/treatment";

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
    slotDurationMinutes: number;
    professionalId?: string;
    // Janelas de início do tratamento (ex.: lentes 09:00/16:00). Ver SlotEngine.
    allowedStartWindows?: TreatmentBookingWindow[] | null;
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
  updateBlockEvent(input: {
    calendarEventId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
  }): Promise<BlockEvent>;
  isSlotFree(input: {
    clinicId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<boolean>;
  updateCalendarEvent(input: {
    calendarEventId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<void>;
};
