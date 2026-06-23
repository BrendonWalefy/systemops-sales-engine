import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, clinics, conversations } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

export const dynamic = "force-dynamic";

const MAX_SLOTS = 8;
const LOOKAHEAD_DAYS = 7;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [clinic] = await db
    .select()
    .from(clinics)
    .where(eq(clinics.id, sessionClinicId))
    .limit(1);
  if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

  const timezone = new ClinicTimezone(clinic.timezone);

  const calendarGateway = resolveCalendarGateway({
    clinicId: clinic.id,
    calendarMode: clinic.calendarMode,
    googleCalendarId: clinic.googleCalendarId,
    timezone,
    businessHours: clinic.businessHours,
    postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes,
  });

  const from = new Date();
  const to = new Date(from.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60_000);
  const durationMinutes = clinic.defaultAppointmentDurationMinutes;

  let slots = await calendarGateway.listAvailableSlots({
    clinicId: clinic.id,
    from,
    to,
    slotDurationMinutes: durationMinutes,
  });

  // Remove slots com conflicts de appointments locais
  const localAppointments = await db
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinic.id),
        inArray(appointments.status, ["scheduled", "confirmed"]),
        lt(appointments.startsAt, to),
        gte(appointments.endsAt, from),
      ),
    );

  if (localAppointments.length > 0) {
    const bufferMs = (clinic.postAppointmentBufferMinutes ?? 0) * 60_000;
    slots = slots.filter(
      (slot) =>
        !localAppointments.some(
          (a) =>
            a.startsAt.getTime() < slot.endsAt.getTime() &&
            (a.endsAt.getTime() + bufferMs) > slot.startsAt.getTime(),
        ),
    );
  }

  const topSlots = slots.slice(0, MAX_SLOTS);

  if (topSlots.length === 0) {
    return NextResponse.json({ text: "Não encontrei horários disponíveis nos próximos 7 dias. Verifique a agenda diretamente." });
  }

  const formatted = topSlots.map((slot, i) => {
    const label = new Intl.DateTimeFormat("pt-BR", {
      timeZone: clinic.timezone,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(slot.startsAt);
    return `${i + 1}. ${label.replace(",", "")}`;
  });

  const text = `Aqui estão nossos próximos horários disponíveis:\n\n${formatted.join("\n")}\n\nQual desses funciona melhor para você?`;

  return NextResponse.json({ text });
}
