import type { BlockEvent, CalendarGateway } from "@/application/ports/calendar-gateway";
import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";
import { ClinicTimezone, parseBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { computeAvailableSlots } from "@/core/scheduling/SlotEngine";

// Token cache com Promise singleton para evitar dupla chamada concorrente à Google API
let tokenPromise: Promise<string> | null = null;
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
  // Buffer.from é mais robusto que atob: não lança InvalidCharacterError
  // com chaves que tenham padding irregular ou BOM. Uint8Array.from garante
  // um ArrayBuffer exclusivo (evita pool compartilhado do Node).
  return Uint8Array.from(Buffer.from(lines, "base64")).buffer;
}

async function fetchNewToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set");
  }
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

// Promise singleton: múltiplas requisições simultâneas compartilham o mesmo fetch
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  if (!tokenPromise) {
    tokenPromise = fetchNewToken().finally(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

function getCalendarId(clinicCalendarId?: string | null): string {
  if (!clinicCalendarId) throw new Error("No Google Calendar ID configured for this clinic");
  return clinicCalendarId;
}

export class GoogleCalendarGateway implements CalendarGateway {
  constructor(
    private readonly clinicCalendarId?: string | null,
    private readonly timezone?: ClinicTimezone,
    private readonly clinicBusinessHours?: string | null,
    private readonly postAppointmentBufferMinutes = 0,
  ) {}

  async listAvailableSlots(input: {
    clinicId: string;
    from: Date;
    to: Date;
    slotDurationMinutes: number;
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

    type GCalEvent = {
      summary?: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
    };
    const data = (await res.json()) as { items: GCalEvent[] };

    // Delega cálculo ao SlotEngine (puro, sem I/O)
    const tz = this.timezone ?? new ClinicTimezone("America/Sao_Paulo");
    const bh = parseBusinessHours(this.clinicBusinessHours ?? null);

    const existingEvents: { startsAt: Date; endsAt: Date; appliesPostEventBuffer?: boolean }[] = [];
    for (const e of data.items) {
      if (e.start.dateTime && e.end.dateTime) {
        // Evento com horário (consulta ou bloqueio com hora exata)
        existingEvents.push({
          startsAt: new Date(e.start.dateTime),
          endsAt: new Date(e.end.dateTime),
          appliesPostEventBuffer: !e.summary?.startsWith(GoogleCalendarGateway.BLOCK_PREFIX),
        });
      } else if (e.start.date && e.end.date) {
        // Evento de dia inteiro — bloqueia o dia completo no fuso da clínica.
        // end.date da API do Google é exclusivo (dia seguinte ao último dia bloqueado).
        const [sy, sm, sd] = e.start.date.split("-").map(Number);
        const [ey, em, ed] = e.end.date.split("-").map(Number);
        existingEvents.push({
          startsAt: tz.fromLocalParts(sy, sm - 1, sd, 0, 0),
          endsAt: tz.fromLocalParts(ey, em - 1, ed, 0, 0),
          appliesPostEventBuffer: false,
        });
      }
    }

    return computeAvailableSlots({
      timezone: tz,
      businessHours: bh,
      existingEvents,
      from: input.from,
      to: input.to,
      slotDurationMinutes: input.slotDurationMinutes,
      clinicId: input.clinicId,
      postEventBufferMinutes: this.postAppointmentBufferMinutes,
    });
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

    const event = (await res.json()) as { id: string; htmlLink?: string };
    const now = new Date();

    return {
      id: crypto.randomUUID(),
      clinicId: input.clinicId,
      leadId: input.leadId,
      professionalId: null,
      roomId: null,
      calendarEventId: event.id,
      calendarEventUrl: event.htmlLink ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "scheduled",
      source: "app",
      reminderSentAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async cancelAppointment(input: { calendarEventId: string }): Promise<void> {
    return this.deleteCalendarEvent(input.calendarEventId);
  }

  private async deleteCalendarEvent(calendarEventId: string): Promise<void> {
    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(calendarEventId)}`,
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

  private static readonly BLOCK_PREFIX = "🚫 Bloqueado";

  async listBlockEvents(input: { clinicId: string; from: Date; to: Date }): Promise<BlockEvent[]> {
    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();

    const params = new URLSearchParams({
      timeMin: input.from.toISOString(),
      timeMax: input.to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
      q: GoogleCalendarGateway.BLOCK_PREFIX,
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Calendar listBlockEvents failed: ${err}`);
    }

    type GCalEvent = {
      id: string;
      summary?: string;
      start: { dateTime?: string };
      end: { dateTime?: string };
    };
    const data = (await res.json()) as { items: GCalEvent[] };

    return data.items
      .filter((e) => e.summary?.startsWith(GoogleCalendarGateway.BLOCK_PREFIX) && e.start.dateTime && e.end.dateTime)
      .map((e) => ({
        calendarEventId: e.id,
        startsAt: new Date(e.start.dateTime!),
        endsAt: new Date(e.end.dateTime!),
        reason: e.summary!
          .replace(`${GoogleCalendarGateway.BLOCK_PREFIX} — `, "")
          .replace(GoogleCalendarGateway.BLOCK_PREFIX, "")
          .trim(),
      }));
  }

  async createBlockEvent(input: {
    clinicId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
  }): Promise<BlockEvent> {
    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();

    const summary = input.reason
      ? `${GoogleCalendarGateway.BLOCK_PREFIX} — ${input.reason}`
      : GoogleCalendarGateway.BLOCK_PREFIX;

    const body = {
      summary,
      start: { dateTime: input.startsAt.toISOString() },
      end: { dateTime: input.endsAt.toISOString() },
    };

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Calendar createBlockEvent failed: ${err}`);
    }

    const event = (await res.json()) as { id: string };

    return {
      calendarEventId: event.id,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
    };
  }

  async deleteBlockEvent(input: { calendarEventId: string }): Promise<void> {
    return this.deleteCalendarEvent(input.calendarEventId);
  }

  async updateCalendarEvent(input: {
    calendarEventId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<void> {
    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.calendarEventId)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { dateTime: input.startsAt.toISOString() },
          end: { dateTime: input.endsAt.toISOString() },
        }),
      },
    );

    if (!res.ok && res.status !== 404 && res.status !== 410) {
      const err = await res.text();
      throw new Error(`Google Calendar updateEvent failed: ${err}`);
    }
  }

  async setupWatch(input: {
    channelId: string;
    webhookUrl: string;
    token: string;
  }): Promise<{ resourceId: string; expiration: Date }> {
    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: input.channelId,
          type: "web_hook",
          address: input.webhookUrl,
          token: input.token,
        }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Calendar setupWatch failed: ${err}`);
    }

    const data = (await res.json()) as { resourceId: string; expiration: string };
    return { resourceId: data.resourceId, expiration: new Date(Number(data.expiration)) };
  }

  // Retorna IDs de eventos cancelados desde o último sync e o novo syncToken.
  // Se syncToken for null, faz sync inicial (retorna todos os eventos deletados).
  // Um syncToken pode ser invalidado pelo Google (HTTP 410 Gone, ex.: mais de
  // ~1 semana sem sincronizar) — nesse caso o método se auto-recupera refazendo
  // o sync inicial, em vez de congelar a sincronização para sempre.
  async syncCancelledEventIds(syncToken: string | null): Promise<{
    cancelledIds: string[];
    nextSyncToken: string;
  }> {
    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();

    const params = new URLSearchParams({ showDeleted: "true", maxResults: "250" });
    if (syncToken) {
      params.set("syncToken", syncToken);
    } else {
      // Sync inicial: apenas eventos recentes (180 dias) para evitar payloads enormes
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180);
      params.set("timeMin", sixMonthsAgo.toISOString());
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (res.status === 410 && syncToken) {
      console.warn(JSON.stringify({
        level: "warn",
        scope: "GoogleCalendarGateway",
        msg: "syncToken invalidado pelo Google (410 Gone) — refazendo sync inicial",
        calendarId,
      }));
      return this.syncCancelledEventIds(null);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Calendar syncCancelledEventIds failed: ${err}`);
    }

    type GCalEvent = { id: string; status: string };
    const data = (await res.json()) as { items?: GCalEvent[]; nextSyncToken?: string };
    const cancelledIds = (data.items ?? [])
      .filter((e) => e.status === "cancelled")
      .map((e) => e.id);

    if (!data.nextSyncToken) throw new Error("Google Calendar sync returned no nextSyncToken");

    return { cancelledIds, nextSyncToken: data.nextSyncToken };
  }

  // Verifica em tempo real se o slot está livre no Google Calendar.
  // Usado pelo BookingService antes de criar o evento para detectar conflitos com
  // agendamentos manuais feitos pelo operador após a oferta ao lead.
  async isSlotFree(input: {
    clinicId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<boolean> {
    const durationMinutes = (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000;
    if (durationMinutes <= 0) return false;

    const calendarId = getCalendarId(this.clinicCalendarId);
    const token = await getAccessToken();
    const bufferLookbackMs = Math.max(0, this.postAppointmentBufferMinutes) * 60_000;
    const from = new Date(input.startsAt.getTime() - bufferLookbackMs);

    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: input.endsAt.toISOString(),
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
      throw new Error(`Google Calendar isSlotFree check failed: ${err}`);
    }

    type GCalEvent = {
      summary?: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
    };
    const data = (await res.json()) as { items: GCalEvent[] };

    const tz = this.timezone ?? new ClinicTimezone("America/Sao_Paulo");
    const bh = parseBusinessHours(this.clinicBusinessHours ?? null);
    const existingEvents: { startsAt: Date; endsAt: Date; appliesPostEventBuffer?: boolean }[] = [];

    for (const e of data.items) {
      if (e.start.dateTime && e.end.dateTime) {
        existingEvents.push({
          startsAt: new Date(e.start.dateTime),
          endsAt: new Date(e.end.dateTime),
          appliesPostEventBuffer: !e.summary?.startsWith(GoogleCalendarGateway.BLOCK_PREFIX),
        });
      } else if (e.start.date && e.end.date) {
        const [sy, sm, sd] = e.start.date.split("-").map(Number);
        const [ey, em, ed] = e.end.date.split("-").map(Number);
        existingEvents.push({
          startsAt: tz.fromLocalParts(sy, sm - 1, sd, 0, 0),
          endsAt: tz.fromLocalParts(ey, em - 1, ed, 0, 0),
          appliesPostEventBuffer: false,
        });
      }
    }

    return computeAvailableSlots({
      timezone: tz,
      businessHours: bh,
      existingEvents,
      from: input.startsAt,
      to: input.endsAt,
      slotDurationMinutes: durationMinutes,
      clinicId: input.clinicId,
      postEventBufferMinutes: this.postAppointmentBufferMinutes,
      maxSlots: 1,
    }).some(
      (slot) =>
        slot.startsAt.getTime() === input.startsAt.getTime() &&
        slot.endsAt.getTime() === input.endsAt.getTime(),
    );
  }
}
