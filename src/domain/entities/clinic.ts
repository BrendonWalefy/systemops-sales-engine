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
  treatmentKeyword?: string;
};

export const DEFAULT_MENU_ITEMS: MenuItem[] = [
  { number: 1, label: "Procedimentos", intent: "procedures", enabled: true },
  { number: 2, label: "Agendar horário", intent: "book_appointment", enabled: true },
  { number: 3, label: "Formas de pagamento", intent: "price_inquiry", enabled: true },
  { number: 4, label: "Localização", intent: "location", enabled: true },
  { number: 5, label: "Falar com um especialista", intent: "needs_human", enabled: true },
];

export const CONCIERGE_MENU_ITEMS: MenuItem[] = [
  { number: 1, label: "Conhecer nossos serviços", intent: "procedures", enabled: true },
  { number: 2, label: "Agendar horário", intent: "book_appointment", enabled: true },
  { number: 3, label: "Valores e formas de pagamento", intent: "price_inquiry", enabled: true },
  { number: 4, label: "Endereço e horários", intent: "location", enabled: true },
  { number: 5, label: "Falar com a equipe", intent: "needs_human", enabled: true },
];

export type { TtsConfig, TtsProvider } from "./tts-config";
export { DEFAULT_TTS_CONFIG, TTS_SPEED_DEFAULTS, ttsConfigFromVoice } from "./tts-config";

export type Organization = {
  id: string;
  name: string;
  specialty: string;
  segment: string;
  city: string | null;
  address: string | null;
  timezone: string;
  greetingMessage: string | null;
  menuItems: MenuItem[] | null;
  businessHours: string | null;
  googleCalendarId: string | null;
  calendarMode: "internal" | "google_calendar" | null;
  receptionistPhone: string | null;
  takeoverTtlHours: number;
  postAppointmentBufferMinutes: number;
  defaultAppointmentDurationMinutes: number;
  installmentRates?: { n: number; rate: number; active: boolean }[] | null;
  rateLimitPerHour: number;
  unclearThreshold: number;
  staleConversationHours: number;
  slotOfferTtlMinutes: number;
  maxSlotsToOffer: number;
  slotLookaheadDays: number;
  mediaTakeoverTtlHours: number | null;
  rapidThrottleMs: number;
  messageDebounceMs: number | null;
  // Vocabulário configurável por segmento
  serviceNoun: string;
  bookingNoun: string;
  contactNoun: string;
  agentRole: string;
  businessDescriptor: string | null;
  // Nome do tipo de negócio para UI (ex: "clínica", "barbearia", "ateliê")
  businessNoun: string;
  createdAt: Date;
  updatedAt: Date;
};
