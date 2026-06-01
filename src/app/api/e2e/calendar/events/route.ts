import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, leads } from "@/infrastructure/db/schema";
import { e2eGuard, E2E_CLINIC_ID } from "../../_guard";

// GET /api/e2e/calendar/events?runId=...
// Retorna appointments com calendarEventId preenchido (confirmados ou blocos E2E).
export async function GET(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  if (!E2E_CLINIC_ID) {
    return NextResponse.json({ error: "E2E_CLINIC_ID not configured" }, { status: 500 });
  }

  const rows = await db
    .select({
      calendarEventId: appointments.calendarEventId,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
    })
    .from(appointments)
    .where(and(eq(appointments.clinicId, E2E_CLINIC_ID), isNotNull(appointments.calendarEventId)));

  return NextResponse.json({
    events: rows.map((r) => ({
      calendarEventId: r.calendarEventId!,
      summary: r.startsAt.toISOString(),
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
    })),
  });
}

// POST /api/e2e/calendar/events
// Body: { runId, startsAt, endsAt, summary, type?: 'appointment' | 'block' }
// Cria um appointment no DB com calendarEventId sintético para simular bloqueio de slot.
// O slot finder do core verifica appointments status='scheduled' como conflito.
export async function POST(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  if (!E2E_CLINIC_ID) {
    return NextResponse.json({ error: "E2E_CLINIC_ID not configured" }, { status: 500 });
  }

  const body = await req.json();
  const { startsAt, endsAt, summary } = body as {
    runId: string;
    startsAt: string;
    endsAt: string;
    summary: string;
    type?: "appointment" | "block";
  };

  // Obtém ou cria lead-sistema para blocos E2E (sem número real de WhatsApp).
  const existing = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.clinicId, E2E_CLINIC_ID), eq(leads.phone, "e2e-system-block")))
    .limit(1);

  let leadId: string;
  if (existing.length > 0) {
    leadId = existing[0].id;
  } else {
    const [created] = await db
      .insert(leads)
      .values({ clinicId: E2E_CLINIC_ID, phone: "e2e-system-block", channel: "whatsapp", status: "new" })
      .returning({ id: leads.id });
    leadId = created.id;
  }

  const fakeEventId = `e2e-block-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const [event] = await db
    .insert(appointments)
    .values({
      clinicId: E2E_CLINIC_ID,
      leadId,
      calendarEventId: fakeEventId,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      status: "scheduled",
    })
    .returning();

  return NextResponse.json({
    event: {
      calendarEventId: event.calendarEventId!,
      summary,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
    },
  });
}
