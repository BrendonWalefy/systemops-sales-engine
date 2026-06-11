// Thin adapter: valida auth, registra mensagem do operador e envia via WhatsApp.
// Toda chamada desta rota pausa a IA automaticamente — operador assumiu o atendimento.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { getSessionClinicId, resolveWhatsappChannelClinicForOutbound } from "@/application/tenancy/resolve-clinic";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  // ── 1. Auth + tenancy ──
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) {
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

  // ── 3. Busca conversa — escopada pela clínica da sessão. Sem este filtro,
  // um usuário de outra clínica enviava mensagem ao lead E pausava a IA daqui. ──
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);

  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // ── 4. Busca TTL configurado para a clínica lógica ──
  const [clinicRow] = await db
    .select({
      takeoverTtlHours: clinics.takeoverTtlHours,
    })
    .from(clinics)
    .where(eq(clinics.id, conv.clinicId))
    .limit(1);
  if (!clinicRow) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 422 });
  }
  const ttlHours = clinicRow?.takeoverTtlHours ?? 4;

  // ── 5. Busca telefone do lead ──
  const [lead] = await db
    .select({ phone: leads.phone, whatsappLid: leads.whatsappLid })
    .from(leads)
    .where(eq(leads.id, conv.leadId))
    .limit(1);

  const channelAddress =
    resolveWhatsAppChannelAddress({
      phone: lead?.phone ?? null,
      whatsappLid: lead?.whatsappLid ?? null,
    }) ?? conv.externalThreadId;
  if (!channelAddress) {
    return NextResponse.json({ error: "Lead WhatsApp identity not found" }, { status: 422 });
  }

  const channelClinicId = await resolveWhatsappChannelClinicForOutbound({
    clinicId: conv.clinicId,
    phone: lead?.phone ?? channelAddress,
  });

  const [channelClinicRow] = await db
    .select({
      channelProvider: clinics.channelProvider,
      zapiInstanceId: clinics.zapiInstanceId,
      zapiToken: clinics.zapiToken,
      zapiClientToken: clinics.zapiClientToken,
      metaPhoneNumberId: clinics.metaPhoneNumberId,
      metaAccessToken: clinics.metaAccessToken,
    })
    .from(clinics)
    .where(eq(clinics.id, channelClinicId))
    .limit(1);

  if (!channelClinicRow) {
    return NextResponse.json({ error: "Clinic channel not configured" }, { status: 422 });
  }
  const channelConfig = resolveChannelConfig(channelClinicRow);

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
    const zapiMessageId = await sendTextMessage(channelAddress, messageText, channelConfig);
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
