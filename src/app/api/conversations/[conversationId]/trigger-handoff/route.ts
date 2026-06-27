// Acionamento de atendimento especializado pelo operador via dashboard.
// Pausa a IA e levanta needs_attention sem enviar mensagem ao lead.
// O operador decide se e o que vai digitar depois — a IA não fala nada sozinha aqui.
// Diferente de /send: aqui o operador está encaminhando para um especialista, não assumindo.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);

  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  await db
    .update(conversations)
    .set({
      aiPaused: true,
      takeoverExpiresAt: null,
      needsAttention: true,
      attentionReason: "Operador acionou atendimento especializado",
      consecutiveUnclearCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  return NextResponse.json({ ok: true });
}
