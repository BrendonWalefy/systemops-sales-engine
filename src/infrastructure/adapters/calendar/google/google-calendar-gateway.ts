import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";

// In-memory token cache — reused across requests in the same serverless instance
let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(input: string | ArrayBuffer): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const lines = pem
    .replace(/-----BEGIN .*-----|-----END .*-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(lines);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set");
  }
  // Handle escaped newlines from Vercel env var storage
  const pemKey = rawKey.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const headerB64 = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payloadB64 = base64url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/calendar",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );

  const signingInput = `${headerB64}.${payloadB64}`;
  const der = pemToDer(pemKey);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const jwt = `${signingInput}.${base64url(signatureBuffer)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Failed to get Google access token: ${err}`);
  }

  const data = (await tokenRes.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

function getCalendarId(clinicCalendarId?: string | null): string {
  const id = clinicCalendarId ?? process.env.GOOGLE_CALENDAR_ID;
  if (!id) throw new Error("No Google Calendar ID configured for this clinic");
  return id;
}

// Clinic timezone offset in milliseconds (BRT = UTC-3)
// TODO: make this configurable per clinic
const CLINIC_TZ_OFFSET_MS = -3 * 60 * 60 * 1000;

function toClinicLocal(utcDate: Date): Date {
  return new Date(utcDate.getTime() + CLINIC_TZ_OFFSET_MS);
}

// Returns free 1-hour slots within business hours (08–18h Mon–Fri) in clinic timezone
export class GoogleCalendarGateway implements CalendarGateway {
  constructor(private readonly clinicCalendarId?: string | null) {}

  async listAvailableSlots(input: {
    clinicId: string;
    from: Date;
    to: Date;
    professionalId?: string;
  }): Promise<CalendarSlot[]> {
    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();

    const params = new URLSearchParams({
      timeMin: input.from.toISOString(),
      timeMax: input.to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Calendar listEvents failed: ${err}`);
    }

    type GCalEvent = { start: { dateTime?: string }; end: { dateTime?: string } };
    const data = (await res.json()) as { items: GCalEvent[] };
    const busyRanges = data.items
      .filter((e) => e.start.dateTime && e.end.dateTime)
      .map((e) => ({
        start: new Date(e.start.dateTime!).getTime(),
        end: new Date(e.end.dateTime!).getTime(),
      }));

    const slots: CalendarSlot[] = [];
    const cursor = new Date(input.from);
    cursor.setMinutes(0, 0, 0);

    while (cursor < input.to && slots.length < 100) {
      // Check business hours in clinic local timezone (BRT)
      const local = toClinicLocal(cursor);
      const dow = local.getUTCDay(); // 0=Sun, 6=Sat in local time
      const hour = local.getUTCHours();

      if (dow === 0 || dow === 6 || hour < 8 || hour >= 18) {
        cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
        continue;
      }

      const slotStart = cursor.getTime();
      const slotEnd = slotStart + 60 * 60 * 1000;

      const isBusy = busyRanges.some((r) => r.start < slotEnd && r.end > slotStart);
      if (!isBusy) {
        slots.push({
          id: `${input.clinicId}-${slotStart}`,
          clinicId: input.clinicId,
          professionalId: null,
          startsAt: new Date(slotStart),
          endsAt: new Date(slotEnd),
          source: "google_calendar",
        });
      }

      cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
    }

    return slots;
  }

  async createAppointment(input: {
    clinicId: string;
    leadId: string;
    startsAt: Date;
    endsAt: Date;
    title: string;
  }): Promise<Appointment> {
    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();

    const body = {
      summary: input.title,
      start: { dateTime: input.startsAt.toISOString() },
      end: { dateTime: input.endsAt.toISOString() },
    };

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Calendar createEvent failed: ${err}`);
    }

    const event = (await res.json()) as { id: string };
    const now = new Date();

    return {
      id: crypto.randomUUID(),
      clinicId: input.clinicId,
      leadId: input.leadId,
      calendarEventId: event.id,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    };
  }

  async cancelAppointment(input: { calendarEventId: string }): Promise<void> {
    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.calendarEventId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok && res.status !== 404 && res.status !== 410) {
      const err = await res.text();
      throw new Error(`Google Calendar deleteEvent failed: ${err}`);
    }
  }
}
