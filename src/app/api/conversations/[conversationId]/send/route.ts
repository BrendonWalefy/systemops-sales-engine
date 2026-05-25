// Thin adapter: valida auth, registra mensagem do operador e envia via WhatsApp.
// Toda chamada desta rota pausa a IA automaticamente — operador assumiu o atendimento.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, messages } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  // ── 1. Auth ──
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;

  // ── 2. Valida payload ──
  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const messageText = body.message?.trim();
  if (!messageText) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // ── 3. Busca conversa ──
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // ── 4. Busca telefone do lead ──
  const [lead] = await db
    .select({ phone: leads.phone })
    .from(leads)
    .where(eq(leads.id, conv.leadId))
    .limit(1);

  // externalThreadId é o telefone — usa como fallback se lead.phone não estiver preenchido
  const phone = lead?.phone ?? conv.externalThreadId;
  if (!phone) {
    return NextResponse.json({ error: "Lead phone not found" }, { status: 422 });
  }

  const now = new Date();

  // ── 5. Persiste mensagem do operador ──
  await db.insert(messages).values({
    id: randomUUID(),
    conversationId,
    author: "clinic_user",
    body: messageText,
    sentAt: now,
    externalId: null,
  });

  // ── 6. Envia via WhatsApp ──
  try {
    await sendTextMessage(phone, messageText);
  } catch (err) {
    console.error("[Operator Send] WhatsApp send failed:", err);
    // Mensagem já salva no banco — operador sabe que foi registrada.
    // Retorna 502 para o cliente mostrar erro, mas sem reverter (auditabilidade).
    return NextResponse.json({ error: "WhatsApp send failed — mensagem salva mas não entregue" }, { status: 502 });
  }

  // ── 7. Pausa IA + atualiza lastMessageAt ──
  await db
    .update(conversations)
    .set({ aiPaused: true, lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conversationId));

  return NextResponse.json({ ok: true });
}
