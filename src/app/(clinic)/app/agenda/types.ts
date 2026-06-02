export type AppointmentEvent = {
  id: string;
  leadId: string;
  leadName: string | null;
  leadPhone: string | null;
  professionalId: string | null;
  professionalName: string | null;
  professionalColor: string | null;
  calendarEventId: string | null;
  calendarEventUrl: string | null;
  conversationId: string | null;
  startsAt: string; // ISO string
  endsAt: string;   // ISO string
  status: "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";
  source: "app" | "gcal_import";
};

export type BlockEvent = {
  calendarEventId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
};

export type Professional = {
  id: string;
  name: string;
  color: string;
  specialty: string | null;
  isActive?: boolean;
};
