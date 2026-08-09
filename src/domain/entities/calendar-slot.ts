export type CalendarSlot = {
  id: string;
  clinicId: string;
  professionalId: string | null;
  startsAt: Date;
  endsAt: Date;
  source: "google_calendar" | "manual";
};

// Quem produziu o agendamento. `source` não distingue: "app" cobre IA, operador
// (inbox e agenda) e fluxo de sinal, o que impede medir a conversão de cada um.
// Ver docs/architecture/current.md (Agenda).
export type AppointmentOrigin =
  | "ai_conversation"
  | "operator_inbox"
  | "operator_agenda"
  | "deposit_flow"
  | "gcal_import";

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
  // null = agendamento anterior à instrumentação; não contar como conversão.
  origin: AppointmentOrigin | null;
  reminderSentAt: Date | null;
  treatmentId: string | null;
  valueCents: number | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};
