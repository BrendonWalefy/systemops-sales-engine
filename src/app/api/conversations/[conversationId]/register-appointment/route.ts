import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;

  let body: {
    date: string;          // "YYYY-MM-DD"
    time: string;          // "HH:MM"
    durationMinutes?: number;
    calendarEventId?: string;
    calendarEventUrl?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  if (!body.date || !body.time) {
    return NextResponse.json({ error: "date e time são obrigatórios" }, { status: 400 });
  }

  try {
    const [conv] = await db
      .select({ leadId: conversations.leadId, clinicId: conversations.clinicId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

    const [clinic] = await db
      .select()
      .from(clinics)
      .where(eq(clinics.id, conv.clinicId ?? (process.env.PILOT_CLINIC_ID ?? "")))
      .limit(1);

    if (!clinic) return NextResponse.json({ error: "Clínica não encontrada" }, { status: 404 });

    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, conv.leadId))
      .limit(1);

    if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

    const timezone = new ClinicTimezone(clinic.timezone);
    const durationMinutes = body.durationMinutes ?? clinic.defaultAppointmentDurationMinutes ?? 60;

    const [year, month, day] = body.date.split("-").map(Number);
    const [hour, minute] = body.time.split(":").map(Number);
    const startsAt = timezone.fromLocalParts(year, month - 1, day, hour, minute);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

    let calendarEventId = body.calendarEventId ?? null;
    let calendarEventUrl = body.calendarEventUrl ?? null;

    // Cria evento no Google Calendar quando não foi fornecido um já existente
    if (!calendarEventId && clinic.googleCalendarId) {
      const gateway = new GoogleCalendarGateway(
        clinic.googleCalendarId,
        timezone,
        clinic.businessHours,
        clinic.postAppointmentBufferMinutes,
      );

      const leadName = lead.name ?? "Paciente";
      const appt = await gateway.createAppointment({
        clinicId: clinic.id,
        leadId: lead.id,
        startsAt,
        endsAt,
        title: `Consulta — ${leadName} | ${clinic.name}`,
      });

      calendarEventId = appt.calendarEventId;
      calendarEventUrl = appt.calendarEventUrl;
    }

    const apptRepo = new DrizzleAppointmentRepository();

    // Cancela qualquer agendamento ativo anterior do lead nesta clínica
    const existing = await apptRepo.findActiveByLeadId(lead.id);
    if (existing) {
      await apptRepo.save({ ...existing, status: "cancelled", updatedAt: new Date() });
    }

    const now = new Date();
    await apptRepo.save({
      id: crypto.randomUUID(),
      clinicId: clinic.id,
      leadId: lead.id,
      calendarEventId,
      calendarEventUrl,
      startsAt,
      endsAt,
      status: "scheduled",
      reminderSentAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const leadRepo = new DrizzleLeadRepository();
    await leadRepo.save({ ...lead, status: "appointment_scheduled", updatedAt: now });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[register-appointment]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
