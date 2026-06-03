import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { cookies } from "next/headers";
import { and, between, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, clinics, conversations, leads, professionals } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { BookingService } from "@/core/scheduling/BookingService";

export const dynamic = "force-dynamic";

async function requireAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? verifyToken(token) : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Sem clínica resolvida para a sessão" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "from e to são obrigatórios (ISO 8601)" }, { status: 400 });
  }

  try {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const rows = await db
      .select({
        id: appointments.id,
        leadId: appointments.leadId,
        leadName: leads.name,
        leadPhone: leads.phone,
        professionalId: appointments.professionalId,
        professionalName: professionals.name,
        professionalColor: professionals.color,
        calendarEventId: appointments.calendarEventId,
        calendarEventUrl: appointments.calendarEventUrl,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        source: appointments.source,
        createdAt: appointments.createdAt,
      })
      .from(appointments)
      .innerJoin(leads, eq(appointments.leadId, leads.id))
      .leftJoin(professionals, eq(appointments.professionalId, professionals.id))
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          between(appointments.startsAt, fromDate, toDate),
        ),
      )
      .orderBy(appointments.startsAt);

    // Resolve conversationId por leadId evitando duplicatas (um lead pode ter N conversas)
    const leadIds = [...new Set(rows.map((r) => r.leadId))];
    const convMap = new Map<string, string>();
    if (leadIds.length > 0) {
      const convRows = await db
        .select({ leadId: conversations.leadId, id: conversations.id })
        .from(conversations)
        .where(inArray(conversations.leadId, leadIds))
        .orderBy(desc(conversations.createdAt));
      for (const c of convRows) {
        if (!convMap.has(c.leadId)) convMap.set(c.leadId, c.id);
      }
    }

    const result = rows.map((r) => ({ ...r, conversationId: convMap.get(r.leadId) ?? null }));
    return NextResponse.json({ appointments: result });
  } catch (err) {
    console.error("[appointments GET]", err);
    return NextResponse.json({ error: "Falha ao buscar agendamentos" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    leadId: string;
    date: string;
    time: string;
    durationMinutes?: number;
    professionalId?: string;
    treatmentName?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  if (!body.leadId || !body.date || !body.time) {
    return NextResponse.json({ error: "leadId, date e time são obrigatórios" }, { status: 400 });
  }

  try {
    const clinicId = await getSessionClinicId();
    if (!clinicId) throw new Error("Sem clínica resolvida para a sessão");

    const [clinicRow] = await db
      .select()
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (!clinicRow) return NextResponse.json({ error: "Clínica não encontrada" }, { status: 404 });

    const leadRepo = new DrizzleLeadRepository();
    const lead = await leadRepo.findById(body.leadId);
    if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

    const timezone = new ClinicTimezone(clinicRow.timezone);
    const durationMinutes = body.durationMinutes ?? clinicRow.defaultAppointmentDurationMinutes ?? 60;

    const [year, month, day] = body.date.split("-").map(Number);
    const [hour, minute] = body.time.split(":").map(Number);
    const startsAt = timezone.fromLocalParts(year, month - 1, day, hour, minute);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

    const apptRepo = new DrizzleAppointmentRepository();
    const gateway = new GoogleCalendarGateway(
      clinicRow.googleCalendarId,
      timezone,
      clinicRow.businessHours,
      clinicRow.postAppointmentBufferMinutes,
    );

    const bookingService = new BookingService(gateway, apptRepo, leadRepo);
    const result = await bookingService.book({
      clinic: {
        id: clinicRow.id,
        name: clinicRow.name,
        specialty: clinicRow.specialty,
        city: clinicRow.city,
        address: clinicRow.address,
        timezone: clinicRow.timezone,
        toneOfVoice: clinicRow.toneOfVoice,
        commercialPolicy: clinicRow.commercialPolicy,
        playbook: clinicRow.playbook,
        greetingMessage: clinicRow.greetingMessage,
        menuItems: clinicRow.menuItems,
        businessHours: clinicRow.businessHours,
        googleCalendarId: clinicRow.googleCalendarId,
        receptionistPhone: clinicRow.receptionistPhone ?? null,
        takeoverTtlHours: clinicRow.takeoverTtlHours,
        postAppointmentBufferMinutes: clinicRow.postAppointmentBufferMinutes,
        defaultAppointmentDurationMinutes: clinicRow.defaultAppointmentDurationMinutes,
        createdAt: clinicRow.createdAt,
        updatedAt: clinicRow.updatedAt,
      },
      lead,
      startsAt,
      endsAt,
      treatmentName: body.treatmentName,
    });

    if (!result.success) {
      const statusCode = result.reason === "slot_taken" ? 409 : 500;
      const message =
        result.reason === "slot_taken"
          ? "Horário não disponível"
          : "Erro ao criar agendamento";
      return NextResponse.json({ error: message, reason: result.reason }, { status: statusCode });
    }

    // Atualiza professionalId se fornecido
    if (body.professionalId) {
      await apptRepo.save({
        ...result.appointment,
        professionalId: body.professionalId,
        updatedAt: new Date(),
      });
    }

    return NextResponse.json({ appointment: result.appointment }, { status: 201 });
  } catch (err) {
    console.error("[appointments POST]", err);
    return NextResponse.json({ error: "Falha ao criar agendamento" }, { status: 500 });
  }
}
