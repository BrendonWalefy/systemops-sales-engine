import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { cookies } from "next/headers";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

export const dynamic = "force-dynamic";

async function resolveGateway(clinicId: string) {
  const [clinic] = await db
    .select({
      googleCalendarId: organizations.googleCalendarId,
      calendarMode: organizations.calendarMode,
      timezone: organizations.timezone,
      businessHours: organizations.businessHours,
    })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);

  if (!clinic) return null;

  return {
    clinic,
    gateway: resolveCalendarGateway({
      clinicId,
      calendarMode: clinic.calendarMode,
      googleCalendarId: clinic.googleCalendarId,
      timezone: new ClinicTimezone(clinic.timezone),
      businessHours: clinic.businessHours,
    }),
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await params;

  try {
    const body = await request.json() as { date?: string; startTime?: string; endTime?: string; reason?: string };
    const { date, startTime, endTime, reason = "" } = body;

    if (!date || !startTime || !endTime) {
      return NextResponse.json({ error: "date, startTime e endTime são obrigatórios" }, { status: 400 });
    }

    const clinicId = await getSessionClinicId();
    if (!clinicId) throw new Error("Sem clínica resolvida para a sessão");

    const resolved = await resolveGateway(clinicId);
    if (!resolved) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

    const clinicTz = new ClinicTimezone(resolved.clinic.timezone);
    const [y, mo, d] = date.split("-").map(Number);
    const [sh, sm]   = startTime.split(":").map(Number);
    const [eh, em]   = endTime.split(":").map(Number);

    const startsAt = clinicTz.fromLocalParts(y, mo, d, sh, sm);
    const endsAt   = clinicTz.fromLocalParts(y, mo, d, eh, em);

    if (endsAt <= startsAt) {
      return NextResponse.json({ error: "Horário de fim deve ser após o início" }, { status: 400 });
    }

    const updated = await resolved.gateway.updateBlockEvent({ calendarEventId: eventId, startsAt, endsAt, reason });
    return NextResponse.json({ block: updated });
  } catch (err) {
    console.error("[CalendarBlocks PATCH]", err);
    return NextResponse.json({ error: "Falha ao editar bloqueio" }, { status: 500 });
  }
}

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

    const resolved = await resolveGateway(clinicId);
    if (!resolved) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

    await resolved.gateway.deleteBlockEvent({ calendarEventId: eventId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[CalendarBlocks DELETE]", err);
    return NextResponse.json({ error: "Falha ao remover bloqueio" }, { status: 500 });
  }
}
