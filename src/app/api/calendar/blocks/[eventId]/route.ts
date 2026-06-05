import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { cookies } from "next/headers";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
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
    const clinicId = await getSessionClinicId();
    if (!clinicId) throw new Error("Sem clínica resolvida para a sessão");

    const [clinic] = await db
      .select({ googleCalendarId: clinics.googleCalendarId, calendarMode: clinics.calendarMode, timezone: clinics.timezone, businessHours: clinics.businessHours })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

    const gateway = resolveCalendarGateway({
      clinicId,
      calendarMode: clinic.calendarMode,
      googleCalendarId: clinic.googleCalendarId,
      timezone: new ClinicTimezone(clinic.timezone),
      businessHours: clinic.businessHours,
    });

    await gateway.deleteBlockEvent({ calendarEventId: eventId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[CalendarBlocks DELETE]", err);
    return NextResponse.json({ error: "Falha ao remover bloqueio" }, { status: 500 });
  }
}
