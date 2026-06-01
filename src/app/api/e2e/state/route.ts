import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  appointments,
  conversations,
  conversationStates,
  followUps,
  leads,
  messages,
  slotReservations,
} from "@/infrastructure/db/schema";
import { e2eGuard, E2E_CLINIC_ID } from "../_guard";

// GET /api/e2e/state?runId=...
// Retorna estado completo da clínica E2E: leads, conversas, mensagens,
// slotOffers, appointments e slotReservations.
export async function GET(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  if (!E2E_CLINIC_ID) {
    return NextResponse.json({ error: "E2E_CLINIC_ID not configured" }, { status: 500 });
  }

  const runId = req.nextUrl.searchParams.get("runId") ?? "";

  const clinicConversations = await db
    .select()
    .from(conversations)
    .where(eq(conversations.clinicId, E2E_CLINIC_ID))
    .orderBy(desc(conversations.createdAt));

  const conversationIds = clinicConversations.map((c) => c.id);

  const [clinicLeads, clinicMessages, latestState, clinicAppointments, clinicSlotReservations, clinicFollowUps] =
    await Promise.all([
      db
        .select({ id: leads.id, name: leads.name, phone: leads.phone, status: leads.status })
        .from(leads)
        .where(eq(leads.clinicId, E2E_CLINIC_ID)),

      conversationIds.length > 0
        ? db
            .select({ author: messages.author, body: messages.body, sentAt: messages.sentAt })
            .from(messages)
            .where(inArray(messages.conversationId, conversationIds))
            .orderBy(messages.sentAt)
        : Promise.resolve([]),

      conversationIds.length > 0
        ? db
            .select({ state: conversationStates.state, payload: conversationStates.payload })
            .from(conversationStates)
            .where(eq(conversationStates.conversationId, clinicConversations[0].id))
            .orderBy(desc(conversationStates.createdAt))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),

      db
        .select({
          id: appointments.id,
          leadId: appointments.leadId,
          calendarEventId: appointments.calendarEventId,
          startsAt: appointments.startsAt,
          endsAt: appointments.endsAt,
          status: appointments.status,
        })
        .from(appointments)
        .where(eq(appointments.clinicId, E2E_CLINIC_ID))
        .orderBy(desc(appointments.startsAt)),

      db
        .select({
          id: slotReservations.id,
          leadId: slotReservations.leadId,
          startsAt: slotReservations.startsAt,
          endsAt: slotReservations.endsAt,
          status: slotReservations.status,
        })
        .from(slotReservations)
        .where(eq(slotReservations.clinicId, E2E_CLINIC_ID)),

      db
        .select({
          id: followUps.id,
          leadId: followUps.leadId,
          dueAt: followUps.dueAt,
          status: followUps.status,
          reason: followUps.reason,
        })
        .from(followUps)
        .where(eq(followUps.clinicId, E2E_CLINIC_ID))
        .orderBy(desc(followUps.dueAt)),
    ]);

  const payload = latestState?.payload as Record<string, unknown> | null;
  type SlotPayload = { index: number; startsAt: string; endsAt: string; label: string };
  const slotOffers: SlotPayload[] =
    latestState?.state === "slots_offered" && Array.isArray(payload?.slots)
      ? (payload!.slots as SlotPayload[]).map((s) => ({
          index: s.index,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          label: s.label,
        }))
      : [];

  return NextResponse.json({
    runId,
    leads: clinicLeads,
    conversations: clinicConversations.map((c) => ({
      id: c.id,
      leadId: c.leadId,
      aiPaused: c.aiPaused,
      needsAttention: c.needsAttention,
      attentionReason: c.attentionReason,
    })),
    messages: clinicMessages.map((m) => ({
      // clinic_user = mensagem do operador humano — não conta como resposta da IA
      role: m.author === "lead" ? "user" : m.author === "agent" ? "agent" : "operator",
      text: m.body,
      sentAt: m.sentAt,
    })),
    slotOffers,
    appointments: clinicAppointments.map((a) => ({
      id: a.id,
      leadId: a.leadId,
      calendarEventId: a.calendarEventId,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      status: a.status,
    })),
    slotReservations: clinicSlotReservations.map((r) => ({
      id: r.id,
      leadId: r.leadId,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      status: r.status,
    })),
    followUps: clinicFollowUps.map((f) => ({
      id: f.id,
      leadId: f.leadId,
      dueAt: f.dueAt.toISOString(),
      status: f.status,
      reason: f.reason,
    })),
  });
}
