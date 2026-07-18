import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { confirmDepositDecision } from "@/application/conversations/confirm-deposit-decision";

export const dynamic = "force-dynamic";

// Operador valida (ou rejeita) o comprovante do sinal pelo painel. A mesma regra
// tambem e usada pela confirmacao via WhatsApp do responsavel.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;

  let body: { action: "confirm" | "reject" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  if (body.action !== "confirm" && body.action !== "reject") {
    return NextResponse.json({ error: "action deve ser 'confirm' ou 'reject'" }, { status: 400 });
  }

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

  const result = await confirmDepositDecision({
    conversationId,
    clinicId: sessionClinicId,
    action: body.action,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, reason: result.reason },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, action: result.action });
}
