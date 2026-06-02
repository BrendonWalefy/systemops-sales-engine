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
  professionalId: string | null;
  roomId: string | null;
  calendarEventId: string | null;
  calendarEventUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  status: "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";
  source: "app" | "gcal_import";
  reminderSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

