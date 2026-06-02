import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { BookingService } from "@/core/scheduling/BookingService";
import { updateAppointment } from "@/application/use-cases/calendar/update-appointment";

export const dynamic = "force-dynamic";

async function requireAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? verifyToken(token) : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: {
    status?: "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";
    date?: string;
    time?: string;
    durationMinutes?: number;
    professionalId?: string | null;
    roomId?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  try {
    const clinicId = process.env.PILOT_CLINIC_ID;
    if (!clinicId) throw new Error("PILOT_CLINIC_ID not set");

    const [clinicRow] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
    if (!clinicRow) return NextResponse.json({ error: "Clínica não encontrada" }, { status: 404 });

    const timezone = new ClinicTimezone(clinicRow.timezone);
    const apptRepo = new DrizzleAppointmentRepository();
    const gateway = new GoogleCalendarGateway(
      clinicRow.googleCalendarId,
      timezone,
      clinicRow.businessHours,
      clinicRow.postAppointmentBufferMinutes,
    );

    let startsAt: Date | undefined;
    let endsAt: Date | undefined;

    if (body.date && body.time) {
      const [year, month, day] = body.date.split("-").map(Number);
      const [hour, minute] = body.time.split(":").map(Number);
      startsAt = timezone.fromLocalParts(year, month - 1, day, hour, minute);
      const duration = body.durationMinutes ?? clinicRow.defaultAppointmentDurationMinutes ?? 60;
      endsAt = new Date(startsAt.getTime() + duration * 60_000);
    }

    const result = await updateAppointment(
      {
        appointmentId: id,
        clinicId,
        status: body.status,
        startsAt,
        endsAt,
        professionalId: body.professionalId,
        roomId: body.roomId,
      },
      { appointmentRepository: apptRepo, calendarGateway: gateway },
    );

    if (!result.success) {
      const status = result.reason === "not_found" ? 404 : result.reason === "slot_taken" ? 409 : 500;
      return NextResponse.json({ error: result.reason }, { status });
    }

    const updated = await apptRepo.findById(id);
    return NextResponse.json({ appointment: updated });
  } catch (err) {
    console.error("[appointments PATCH]", err);
    return NextResponse.json({ error: "Falha ao atualizar agendamento" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const clinicId = process.env.PILOT_CLINIC_ID;
    if (!clinicId) throw new Error("PILOT_CLINIC_ID not set");

    const [clinicRow] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
    if (!clinicRow) return NextResponse.json({ error: "Clínica não encontrada" }, { status: 404 });

    const apptRepo = new DrizzleAppointmentRepository();
    const leadRepo = new DrizzleLeadRepository();
    const timezone = new ClinicTimezone(clinicRow.timezone);
    const gateway = new GoogleCalendarGateway(
      clinicRow.googleCalendarId,
      timezone,
      clinicRow.businessHours,
      clinicRow.postAppointmentBufferMinutes,
    );

    const appt = await apptRepo.findById(id);
    if (!appt || appt.clinicId !== clinicId) {
      return NextResponse.json({ error: "Agendamento não encontrado" }, { status: 404 });
    }

    const lead = await leadRepo.findById(appt.leadId);
    if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

    const bookingService = new BookingService(gateway, apptRepo, leadRepo);
    const result = await bookingService.cancel({ lead, appointment: appt });

    if (!result.success) {
      return NextResponse.json({ error: result.reason }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[appointments DELETE]", err);
    return NextResponse.json({ error: "Falha ao cancelar agendamento" }, { status: 500 });
  }
}
