import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await params;

  try {
    const clinicId = process.env.PILOT_CLINIC_ID;
    if (!clinicId) throw new Error("PILOT_CLINIC_ID not set");

    const [clinic] = await db
      .select({ googleCalendarId: clinics.googleCalendarId, timezone: clinics.timezone, businessHours: clinics.businessHours })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

    const gateway = new GoogleCalendarGateway(
      clinic.googleCalendarId,
      new ClinicTimezone(clinic.timezone),
      clinic.businessHours,
    );

    await gateway.deleteBlockEvent({ calendarEventId: eventId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[CalendarBlocks DELETE]", err);
    return NextResponse.json({ error: "Falha ao remover bloqueio" }, { status: 500 });
  }
}
