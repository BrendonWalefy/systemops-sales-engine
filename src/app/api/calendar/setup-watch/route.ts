import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

export const dynamic = "force-dynamic";

// Registra (ou renova) o canal de push notifications do Google Calendar para a clínica.
// Chamar uma vez após o deploy ou quando o canal expirar (canais expiram em ≤7 dias).
// A URL do webhook deve estar acessível publicamente.
//
// POST /api/calendar/setup-watch
// Body: { clinicId?: string }  — omitir usa PILOT_CLINIC_ID
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!appUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_APP_URL ou VERCEL_URL não definido" },
      { status: 500 },
    );
  }

  const webhookSecret = process.env.CRON_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "CRON_SECRET não definido" }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const clinicId: string = body.clinicId ?? process.env.PILOT_CLINIC_ID ?? "";
    if (!clinicId) return NextResponse.json({ error: "clinicId ausente" }, { status: 400 });

    const [clinic] = await db
      .select()
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (!clinic) return NextResponse.json({ error: "Clínica não encontrada" }, { status: 404 });
    if (!clinic.googleCalendarId) {
      return NextResponse.json({ error: "Clínica sem googleCalendarId" }, { status: 400 });
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

    // Sync inicial para obter o primeiro syncToken
    const { nextSyncToken } = await gateway.syncCancelledEventIds(null);

    await db
      .update(clinics)
      .set({ calendarChannelId: channelId, calendarSyncToken: nextSyncToken })
      .where(eq(clinics.id, clinicId));

    return NextResponse.json({
      ok: true,
      channelId,
      webhookUrl,
      expiration: expiration.toISOString(),
    });
  } catch (err) {
    console.error("[calendar/setup-watch]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
