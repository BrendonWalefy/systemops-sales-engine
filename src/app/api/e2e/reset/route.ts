import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  messages,
  conversationStates,
  followUps,
  slotReservations,
  appointments,
  conversations,
  leads,
} from "@/infrastructure/db/schema";
import { e2eGuard, E2E_CLINIC_ID } from "../_guard";

// POST /api/e2e/reset
// Body: { runId: string } — aceito para compatibilidade de contrato com omniQA.
// Schema não tem coluna runId: limpa todos os dados de E2E_CLINIC_ID.
// Isolamento paralelo requer migration futura.
export async function POST(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  if (!E2E_CLINIC_ID) {
    return NextResponse.json({ error: "E2E_CLINIC_ID not configured" }, { status: 500 });
  }

  const clinicConversations = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.clinicId, E2E_CLINIC_ID));

  const conversationIds = clinicConversations.map((c) => c.id);

  if (conversationIds.length > 0) {
    await db.delete(messages).where(inArray(messages.conversationId, conversationIds));
    await db.delete(conversationStates).where(inArray(conversationStates.conversationId, conversationIds));
  }

  await db.delete(followUps).where(eq(followUps.clinicId, E2E_CLINIC_ID));
  await db.delete(slotReservations).where(eq(slotReservations.clinicId, E2E_CLINIC_ID));
  await db.delete(appointments).where(eq(appointments.clinicId, E2E_CLINIC_ID));
  await db.delete(conversations).where(eq(conversations.clinicId, E2E_CLINIC_ID));
  await db.delete(leads).where(eq(leads.clinicId, E2E_CLINIC_ID));

  return NextResponse.json({ ok: true });
}
