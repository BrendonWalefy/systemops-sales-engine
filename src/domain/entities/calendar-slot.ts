export type CalendarSlot = {
  id: string;
  clinicId: string;
  professionalId: string | null;
  startsAt: Date;
  endsAt: Date;
  source: "google_calendar" | "manual";
};

export type Appointment = {
  id: string;
  clinicId: string;
  leadId: string;
  calendarEventId: string | null;
  calendarEventUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  status: "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";
  reminderSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

