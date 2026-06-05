export type MenuItemIntent =
  | "procedures"
  | "book_appointment"
  | "price_inquiry"
  | "location"
  | "needs_human";

export type ConversationExperience = "menu_first" | "concierge";

export const DEFAULT_CONVERSATION_EXPERIENCE: ConversationExperience = "menu_first";

export type MenuItem = {
  number: number;
  label: string;
  intent: MenuItemIntent;
  enabled: boolean;
};

export const DEFAULT_MENU_ITEMS: MenuItem[] = [
  { number: 1, label: "Procedimentos", intent: "procedures", enabled: true },
  { number: 2, label: "Agendar horário", intent: "book_appointment", enabled: true },
  { number: 3, label: "Formas de pagamento", intent: "price_inquiry", enabled: true },
  { number: 4, label: "Localização", intent: "location", enabled: true },
  { number: 5, label: "Falar com um especialista", intent: "needs_human", enabled: true },
];

export const CONCIERGE_MENU_ITEMS: MenuItem[] = [
  { number: 1, label: "Transformar meu sorriso / lentes", intent: "procedures", enabled: true },
  { number: 2, label: "Agendar avaliação", intent: "book_appointment", enabled: true },
  { number: 3, label: "Valores e formas de pagamento", intent: "price_inquiry", enabled: true },
  { number: 4, label: "Endereço e horários", intent: "location", enabled: true },
  { number: 5, label: "Falar com a equipe", intent: "needs_human", enabled: true },
];

export type Clinic = {
  id: string;
  name: string;
  specialty: string;
  city: string | null;
  address: string | null;
  timezone: string;
  conversationExperience: ConversationExperience;
  greetingMessage: string | null;
  menuItems: MenuItem[] | null;
  businessHours: string | null;
  googleCalendarId: string | null;
  calendarMode: "internal" | "google_calendar" | null;
  receptionistPhone: string | null;
  takeoverTtlHours: number;
  postAppointmentBufferMinutes: number;
  defaultAppointmentDurationMinutes: number;
  createdAt: Date;
  updatedAt: Date;
};
