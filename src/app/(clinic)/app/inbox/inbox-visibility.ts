export const APPOINTMENT_BADGE_WINDOW_MS = 24 * 60 * 60 * 1000;

type DateLike = Date | string | null | undefined;

function toTime(value: DateLike): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function isConversationUnreadByClinic(params: {
  lastAuthor: string | null | undefined;
  lastMessageAt: DateLike;
  lastReadAt: DateLike;
}): boolean {
  if (params.lastAuthor !== "lead") return false;

  const lastMessageTime = toTime(params.lastMessageAt);
  if (lastMessageTime === null) return false;

  const lastReadTime = toTime(params.lastReadAt);
  if (lastReadTime === null) return true;

  return lastMessageTime > lastReadTime;
}

export function getAppointmentBadgeWindow(now: Date = new Date()): {
  startsAtFrom: Date;
  startsAtTo: Date;
} {
  return {
    startsAtFrom: new Date(now.getTime() - APPOINTMENT_BADGE_WINDOW_MS),
    startsAtTo: new Date(now.getTime() + APPOINTMENT_BADGE_WINDOW_MS),
  };
}

export function shouldShowAppointmentBadge(startsAt: DateLike, now: Date = new Date()): boolean {
  const appointmentTime = toTime(startsAt);
  if (appointmentTime === null) return false;

  return Math.abs(appointmentTime - now.getTime()) <= APPOINTMENT_BADGE_WINDOW_MS;
}
