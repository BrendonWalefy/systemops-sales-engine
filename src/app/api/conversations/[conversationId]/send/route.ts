// Thin adapter: valida auth, registra mensagem do operador e envia via WhatsApp.
// Toda chamada desta rota pausa a IA automaticamente — operador assumiu o atendimento.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";

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

  // ── 4. Busca TTL configurado para a clínica ──
  const [clinicRow] = await db
    .select({
      takeoverTtlHours: clinics.takeoverTtlHours,
      channelProvider: clinics.channelProvider,
      zapiInstanceId: clinics.zapiInstanceId,
      zapiToken: clinics.zapiToken,
      zapiClientToken: clinics.zapiClientToken,
      metaPhoneNumberId: clinics.metaPhoneNumberId,
      metaAccessToken: clinics.metaAccessToken,
    })
    .from(clinics)
    .where(eq(clinics.id, conv.clinicId))
    .limit(1);
  if (!clinicRow) {
    return NextResponse.json({ error: "Clinic channel not configured" }, { status: 422 });
  }
  const ttlHours = clinicRow?.takeoverTtlHours ?? 4;
  const channelConfig = resolveChannelConfig(clinicRow);

  // ── 5. Busca telefone do lead ──
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
  const msgId = randomUUID();

  // ── 6. Persiste mensagem do operador antes do envio (auditabilidade) ──
  await db.insert(messages).values({
    id: msgId,
    conversationId,
    author: "clinic_user",
    body: messageText,
    sentAt: now,
    externalId: null,
  });

  // ── 7. Envia via WhatsApp e captura messageId para deduplicar echo fromMe ──
  try {
    const zapiMessageId = await sendTextMessage(phone, messageText, channelConfig);
    // Salva o messageId retornado pelo Z-API para que o webhook fromMe identifique
    // este envio como nosso e não crie uma mensagem duplicada na conversa.
    if (zapiMessageId) {
      await db.update(messages).set({ externalId: zapiMessageId }).where(eq(messages.id, msgId));
    }
  } catch (err) {
    console.error("[Operator Send] WhatsApp send failed:", err);
    return NextResponse.json({ error: "WhatsApp send failed — mensagem salva mas não entregue" }, { status: 502 });
  }

  // ── 8. Pausa IA com TTL + limpa flag de atenção (operador assumiu) ──
  const takeoverExpiresAt = ttlHours > 0
    ? new Date(now.getTime() + ttlHours * 60 * 60_000)
    : null;
  await db
    .update(conversations)
    .set({ aiPaused: true, takeoverExpiresAt, needsAttention: false, attentionReason: null, consecutiveUnclearCount: 0, lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conversationId));

  return NextResponse.json({ ok: true });
}
