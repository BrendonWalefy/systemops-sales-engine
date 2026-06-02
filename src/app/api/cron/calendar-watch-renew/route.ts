import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

export const dynamic = "force-dynamic";

// Registra ou renova o canal de push notifications do Google Calendar.
// Executado semanalmente via Vercel Cron — canais expiram em ≤7 dias.
// Também usado no primeiro deploy para criar o canal inicial.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!appUrl) {
    console.error("[calendar-watch-renew] NEXT_PUBLIC_APP_URL não definido");
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL não definido" }, { status: 500 });
  }

  const webhookSecret = process.env.CRON_SECRET!;
  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) {
    return NextResponse.json({ error: "PILOT_CLINIC_ID não definido" }, { status: 500 });
  }

  try {
    const [clinic] = await db
      .select()
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (!clinic?.googleCalendarId) {
      console.warn("[calendar-watch-renew] Clínica sem googleCalendarId — pulando");
      return NextResponse.json({ ok: true, skipped: true });
    }

    const gateway = new GoogleCalendarGateway(
      clinic.googleCalendarId,
      new ClinicTimezone(clinic.timezone),
      clinic.businessHours,
    );

    const channelId = `gcal-${clinicId}`;
    const webhookUrl = `${appUrl}/api/webhooks/google-calendar`;

    const { expiration } = await gateway.setupWatch({
      channelId,
      webhookUrl,
      token: webhookSecret,
    });

    // Obtém syncToken atualizado (ou inicial na primeira execução)
    const { nextSyncToken } = await gateway.syncCancelledEventIds(
      clinic.calendarSyncToken ?? null,
    );

    await db
      .update(clinics)
      .set({ calendarChannelId: channelId, calendarSyncToken: nextSyncToken })
      .where(eq(clinics.id, clinicId));

    console.info(
      `[calendar-watch-renew] Canal renovado — expira em ${expiration.toISOString()}`,
    );

    return NextResponse.json({ ok: true, channelId, expiration: expiration.toISOString() });
  } catch (err) {
    console.error("[calendar-watch-renew]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
