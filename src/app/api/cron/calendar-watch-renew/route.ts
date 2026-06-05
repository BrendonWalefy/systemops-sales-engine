import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { resolveCalendarMode } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";

export const dynamic = "force-dynamic";

// Registra ou renova o canal de push do Google Calendar para TODAS as clínicas.
async function renewForClinic(
  clinicId: string,
  appUrl: string,
  webhookSecret: string,
): Promise<{ clinicId: string; ok: boolean; skipped?: boolean; expiration?: string; error?: string }> {
  try {
    const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
    if (
      !clinic?.googleCalendarId ||
      resolveCalendarMode({
        calendarMode: clinic.calendarMode,
        googleCalendarId: clinic.googleCalendarId,
      }) !== "google_calendar"
    ) {
      return { clinicId, ok: true, skipped: true };
    }

    const gateway = new GoogleCalendarGateway(
      clinic.googleCalendarId,
      new ClinicTimezone(clinic.timezone),
      clinic.businessHours,
    );

    const channelId = `gcal-${clinicId}`;
    const webhookUrl = `${appUrl}/api/webhooks/google-calendar`;

    const { expiration } = await gateway.setupWatch({ channelId, webhookUrl, token: webhookSecret });
    const { nextSyncToken } = await gateway.syncCancelledEventIds(clinic.calendarSyncToken ?? null);

    await db
      .update(clinics)
      .set({ calendarChannelId: channelId, calendarSyncToken: nextSyncToken })
      .where(eq(clinics.id, clinicId));

    return { clinicId, ok: true, expiration: expiration.toISOString() };
  } catch (err) {
    console.error("[calendar-watch-renew]", clinicId, err);
    return { clinicId, ok: false, error: String(err) };
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL não definido" }, { status: 500 });
  }

  const webhookSecret = process.env.CRON_SECRET!;
  const clinicIds = await listAllClinicIds();
  const results = [];
  for (const clinicId of clinicIds) {
    results.push(await renewForClinic(clinicId, appUrl, webhookSecret));
  }

  return NextResponse.json({ clinics: results.length, results });
}
