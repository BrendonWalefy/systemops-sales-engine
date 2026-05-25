import type { CalendarSlot } from "@/domain/entities/calendar-slot";

const CLINIC_TZ_OFFSET_MS = -3 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export type CalendarConversationIntent =
  | "list_appointments"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "schedule_exact"
  | "ask_availability"
  | "none";

export type CalendarRequest = {
  intent: CalendarConversationIntent;
  requestedDate: Date | null;
  requestedHour: number | null;
  period: "morning" | "afternoon" | null;
};

export function parseCalendarRequest(text: string, now = new Date()): CalendarRequest {
  const normalized = normalize(text);
  const requestedDate = parseRequestedDate(normalized, now);
  const requestedHour = parseRequestedHour(normalized);
  const period = normalized.includes("tarde")
    ? "afternoon"
    : normalized.includes("manha") || normalized.includes("manhã")
      ? "morning"
      : null;

  if (/\b(cancel|cancele|cancelar|desmarca|desmarcar|desmarque)\b/.test(normalized)) {
    return { intent: "cancel_appointment", requestedDate, requestedHour, period };
  }

  if (/\b(remarca|remarcar|remarque|troca|trocar|muda|mudar|altera|alterar)\b/.test(normalized)) {
    return { intent: "reschedule_appointment", requestedDate, requestedHour, period };
  }

  if (
    /\b(tenho|meus|minhas|mostrar|mostra|ver)\b/.test(normalized) &&
    /\b(agend|horario|horarios|consulta|consultas)\b/.test(normalized)
  ) {
    return { intent: "list_appointments", requestedDate, requestedHour, period };
  }

  const asksAvailability =
    /\b(disponivel|disponiveis|disponibilidade|horario|horarios|agenda|vago|vagos)\b/.test(normalized);
  const asksScheduling =
    /\b(agende|agenda|agendar|marque|marcar|reserve|reservar|confirme|confirmar)\b/.test(normalized);

  if (asksScheduling && (requestedHour !== null || requestedDate || period)) {
    return { intent: "schedule_exact", requestedDate, requestedHour, period };
  }

  if (asksAvailability || requestedDate || period) {
    return { intent: "ask_availability", requestedDate, requestedHour, period };
  }

  return { intent: "none", requestedDate, requestedHour, period };
}

export function filterSlotsByRequest(slots: CalendarSlot[], request: CalendarRequest): CalendarSlot[] {
  return slots.filter((slot) => {
    if (request.requestedDate && !isSameClinicDate(slot.startsAt, request.requestedDate)) return false;

    const local = toClinicLocalParts(slot.startsAt);
    if (request.requestedHour !== null && local.hour !== request.requestedHour) return false;
    if (request.period === "morning" && (local.hour < 8 || local.hour >= 12)) return false;
    if (request.period === "afternoon" && (local.hour < 12 || local.hour >= 18)) return false;
    return true;
  });
}

export function formatSlotPt(date: Date): string {
  const local = toClinicLocalParts(date);
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const dow = weekdays[local.weekday] ?? "";
  const day = String(local.day).padStart(2, "0");
  const month = String(local.month + 1).padStart(2, "0");
  const hour = String(local.hour).padStart(2, "0");
  return `${dow} ${day}/${month} às ${hour}h`;
}

export function formatDatePt(date: Date): string {
  const local = toClinicLocalParts(date);
  const day = String(local.day).padStart(2, "0");
  const month = String(local.month + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function parseRequestedDate(normalizedText: string, now: Date): Date | null {
  const today = startOfClinicDay(now);

  if (/\b(amanha|amanhã)\b/.test(normalizedText)) {
    return new Date(today.getTime() + 24 * HOUR_MS);
  }

  if (/\b(hoje)\b/.test(normalizedText)) {
    return today;
  }

  const explicit = normalizedText.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!explicit) return null;

  const day = Number(explicit[1]);
  const month = Number(explicit[2]) - 1;
  const current = toClinicLocalParts(now);
  let year = explicit[3] ? Number(explicit[3]) : current.year;
  if (year < 100) year += 2000;

  const candidate = fromClinicLocalParts(year, month, day, 0);
  if (!explicit[3] && candidate.getTime() < today.getTime()) {
    return fromClinicLocalParts(year + 1, month, day, 0);
  }
  return candidate;
}

function parseRequestedHour(normalizedText: string): number | null {
  const explicit = normalizedText.match(/\b(?:as|às|para|pras|pelas?)\s*(\d{1,2})(?:[:h](\d{2}))?\b/);
  if (explicit) {
    const hour = Number(explicit[1]);
    const minute = explicit[2] ? Number(explicit[2]) : 0;
    if (hour >= 0 && hour <= 23 && minute === 0) return hour;
  }

  const compact = normalizedText.match(/\b(\d{1,2})h\b/);
  if (compact) {
    const hour = Number(compact[1]);
    if (hour >= 0 && hour <= 23) return hour;
  }

  return null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSameClinicDate(a: Date, b: Date): boolean {
  const left = toClinicLocalParts(a);
  const right = toClinicLocalParts(b);
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

function startOfClinicDay(date: Date): Date {
  const local = toClinicLocalParts(date);
  return fromClinicLocalParts(local.year, local.month, local.day, 0);
}

function toClinicLocalParts(date: Date) {
  const local = new Date(date.getTime() + CLINIC_TZ_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    hour: local.getUTCHours(),
  };
}

function fromClinicLocalParts(year: number, month: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, month, day, hour) - CLINIC_TZ_OFFSET_MS);
}
