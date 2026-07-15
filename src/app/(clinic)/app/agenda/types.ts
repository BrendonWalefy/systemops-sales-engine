import type { ProfessionalWorkSchedule } from "@/domain/entities/professional";

export type AppointmentEvent = {
  id: string;
  leadId: string;
  leadName: string | null;
  leadPhone: string | null;
  leadTreatmentInterest: string | null;
  professionalId: string | null;
  professionalName: string | null;
  professionalColor: string | null;
  calendarEventId: string | null;
  calendarEventUrl: string | null;
  conversationId: string | null;
  startsAt: string; // ISO string
  endsAt: string;   // ISO string
  description: string | null;
  status: "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show" | "block";
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
  workSchedule?: ProfessionalWorkSchedule | null;
};

export type TreatmentOption = {
  id: string;
  name: string;
  durationMinutes: number;
  // Preço efetivo (campanha ativa já resolvida). null = sem preço cadastrado.
  priceCents: number | null;
  // Sinal abatido do total (ex.: avaliação de R$30). Não soma por cima do procedimento.
  deductible: boolean;
};
