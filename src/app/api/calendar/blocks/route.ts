import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId, requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { cookies } from "next/headers";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

export const dynamic = "force-dynamic";

async function getGateway() {
  const clinicId = await getSessionClinicId();
  if (!clinicId) throw new Error("Sem clínica resolvida para a sessão");

  const [clinic] = await db
    .select({ googleCalendarId: organizations.googleCalendarId, calendarMode: organizations.calendarMode, timezone: organizations.timezone, businessHours: organizations.businessHours })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);

  if (!clinic) throw new Error("Clinic not found");

  const tz = new ClinicTimezone(clinic.timezone);
  return {
    tz,
    gateway: resolveCalendarGateway({
      clinicId,
      calendarMode: clinic.calendarMode,
      googleCalendarId: clinic.googleCalendarId,
      timezone: tz,
      businessHours: clinic.businessHours,
    }),
  };
}

async function requireAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? verifyToken(token) : null;
}

export async function GET(): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { gateway } = await getGateway();
    const clinicId = await requireSessionClinicId();
    const from = new Date();
    const to = new Date(Date.now() + 150 * 24 * 60 * 60_000); // próximos 150 dias

    const blocks = await gateway.listBlockEvents({ clinicId, from, to });
    return NextResponse.json({ blocks });
  } catch (err) {
    console.error("[CalendarBlocks GET]", err);
    return NextResponse.json({ error: "Falha ao buscar bloqueios" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { date?: string; startTime?: string; endTime?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { date, startTime, endTime, reason } = body;
  if (!date || !startTime || !endTime) {
    return NextResponse.json({ error: "date, startTime e endTime são obrigatórios" }, { status: 422 });
  }

  try {
    const { tz, gateway } = await getGateway();
    const clinicId = await requireSessionClinicId();

    const [year, month, day] = date.split("-").map(Number);
    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);

    if (!year || !month || !day || isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) {
      return NextResponse.json({ error: "Data ou horário inválido" }, { status: 422 });
    }

    const startsAt = tz.fromLocalParts(year, month - 1, day, startH, startM);
    const endsAt = tz.fromLocalParts(year, month - 1, day, endH, endM);

    if (endsAt <= startsAt) {
      return NextResponse.json({ error: "Horário de fim deve ser após o início" }, { status: 422 });
    }

    const block = await gateway.createBlockEvent({
      clinicId,
      startsAt,
      endsAt,
      reason: reason?.trim() ?? "",
    });

    return NextResponse.json({ block }, { status: 201 });
  } catch (err) {
    console.error("[CalendarBlocks POST]", err);
    return NextResponse.json({ error: "Falha ao criar bloqueio" }, { status: 500 });
  }
}
