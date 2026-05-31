import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, messages, appointments, conversationStates } from "@/infrastructure/db/schema";
import { e2eGuard, E2E_CLINIC_ID } from "../_guard";

// GET /api/e2e/state?runId=...
// Retorna o estado atual da clínica E2E: última conversa, mensagens, appointments e slot offers.
export async function GET(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  if (!E2E_CLINIC_ID) {
    return NextResponse.json({ error: "E2E_CLINIC_ID not configured" }, { status: 500 });
  }

  const latestConversation = await db
    .select()
    .from(conversations)
    .where(eq(conversations.clinicId, E2E_CLINIC_ID))
    .orderBy(desc(conversations.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!latestConversation) {
    return NextResponse.json({ messages: [], appointments: [], slotOffers: [] });
  }

  const [conversationMessages, clinicAppointments, latestState] = await Promise.all([
    db
      .select({ author: messages.author, body: messages.body, sentAt: messages.sentAt })
      .from(messages)
      .where(eq(messages.conversationId, latestConversation.id))
      .orderBy(messages.sentAt),

    db
      .select({ status: appointments.status, startsAt: appointments.startsAt })
      .from(appointments)
      .where(eq(appointments.clinicId, E2E_CLINIC_ID))
      .orderBy(desc(appointments.startsAt))
      .limit(10),

    db
      .select({ state: conversationStates.state, payload: conversationStates.payload })
      .from(conversationStates)
      .where(eq(conversationStates.conversationId, latestConversation.id))
      .orderBy(desc(conversationStates.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const payload = latestState?.payload as Record<string, unknown> | null;
  const slotOffers: Array<{ index: number; label: string }> =
    latestState?.state === "slots_offered" && Array.isArray(payload?.slots)
      ? (payload!.slots as Array<{ index: number; label: string }>).map((s) => ({
          index: s.index,
          label: s.label,
        }))
      : [];

  return NextResponse.json({
    messages: conversationMessages.map((m) => ({
      role: m.author === "lead" ? "user" : "agent",
      text: m.body,
      sentAt: m.sentAt,
    })),
    appointments: clinicAppointments.map((a) => ({
      status: a.status,
      label: a.startsAt.toISOString(),
    })),
    slotOffers,
  });
}
