import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, leads } from "@/infrastructure/db/schema";
import { e2eGuard, E2E_CLINIC_ID } from "../_guard";

// POST /api/e2e/appointments
// Body: { runId, startsAt, endsAt }
// Cria um appointment no DB diretamente vinculado ao lead E2E (phone = e2e-{runId}).
// Cria o lead se ainda não existir.
// Usado para simular paciente com consulta pré-agendada sem passar pelo fluxo de agendamento.
export async function POST(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  if (!E2E_CLINIC_ID) {
    return NextResponse.json({ error: "E2E_CLINIC_ID not configured" }, { status: 500 });
  }

  const body = await req.json();
  const { runId, startsAt, endsAt } = body as {
    runId: string;
    startsAt: string;
    endsAt: string;
  };

  if (!runId || !startsAt || !endsAt) {
    return NextResponse.json({ error: "runId, startsAt e endsAt são obrigatórios" }, { status: 400 });
  }

  const phone = `e2e-${runId}`;

  const existing = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.clinicId, E2E_CLINIC_ID), eq(leads.phone, phone)))
    .limit(1);

  let leadId: string;
  if (existing.length > 0) {
    leadId = existing[0].id;
  } else {
    const [created] = await db
      .insert(leads)
      .values({
        clinicId: E2E_CLINIC_ID,
        phone,
        name: `[E2E:${runId}] Lead QA`,
        channel: "whatsapp",
        status: "appointment_scheduled",
      })
      .returning({ id: leads.id });
    leadId = created.id;
  }

  const [appointment] = await db
    .insert(appointments)
    .values({
      clinicId: E2E_CLINIC_ID,
      leadId,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      status: "scheduled",
    })
    .returning();

  return NextResponse.json({
    appointment: {
      id: appointment.id,
      leadId,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      status: appointment.status,
    },
  });
}
