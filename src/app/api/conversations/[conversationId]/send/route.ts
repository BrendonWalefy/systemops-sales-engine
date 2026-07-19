// Thin adapter: valida auth, registra mensagem do operador e envia via WhatsApp.
// Toda chamada desta rota pausa a IA automaticamente — operador assumiu o atendimento.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { head } from "@vercel/blob";
import { db } from "@/infrastructure/db/client";
import { organizations, conversations, leads, messages } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { sendMediaMessage, sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { inspectOperatorAttachment, type OperatorAttachmentInspection } from "@/application/conversations/operator-attachment";

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
  let messageText = "";
  let attachmentInput: { url?: string; fileName?: string } | null = null;
  try {
    const body = await request.json() as {
      message?: string;
      attachment?: { url?: string; fileName?: string };
    };
    messageText = body.message?.trim() ?? "";
    attachmentInput = body.attachment ?? null;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!messageText && !attachmentInput) {
    return NextResponse.json({ error: "Message or attachment is required" }, { status: 400 });
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
      takeoverTtlHours: organizations.takeoverTtlHours,
    })
    .from(organizations)
    .where(eq(organizations.id, conv.clinicId))
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

  const [channelClinicRow] = await db
    .select({
      channelProvider: organizations.channelProvider,
      zapiInstanceId: organizations.zapiInstanceId,
      zapiToken: organizations.zapiToken,
      zapiClientToken: organizations.zapiClientToken,
      metaPhoneNumberId: organizations.metaPhoneNumberId,
      metaAccessToken: organizations.metaAccessToken,
    })
    .from(organizations)
    .where(eq(organizations.id, conv.clinicId))
    .limit(1);

  if (!channelClinicRow) {
    return NextResponse.json({ error: "Clinic channel not configured" }, { status: 422 });
  }
  const channelConfig = resolveChannelConfig(channelClinicRow);

  const now = new Date();
  const msgId = randomUUID();
  let mediaUrl: string | null = null;
  let attachment: OperatorAttachmentInspection | null = null;

  if (attachmentInput) {
    if (!attachmentInput.url || !attachmentInput.fileName) {
      return NextResponse.json({ error: "Attachment metadata is required" }, { status: 400 });
    }
    try {
      const blob = await head(attachmentInput.url);
      const expectedPrefix = `media/inbox/${conversationId}/`;
      if (!blob.pathname.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: "Attachment does not belong to this conversation" }, { status: 403 });
      }
      const inspection = inspectOperatorAttachment({
        name: attachmentInput.fileName,
        type: blob.contentType,
        size: blob.size,
      });
      if ("error" in inspection) {
        return NextResponse.json({ error: inspection.error }, { status: 422 });
      }
      attachment = inspection.value;
      mediaUrl = blob.url;
    } catch (err) {
      console.error("[Operator Send] Attachment validation failed:", err);
      return NextResponse.json({ error: "Anexo inválido ou não encontrado." }, { status: 422 });
    }
  }
  // ── 6. Persiste mensagem do operador antes do envio (auditabilidade) ──
  await db.insert(messages).values({
    id: msgId,
    conversationId,
    author: "clinic_user",
    body: messageText || attachment?.safeFileName || "Anexo",
    mediaUrl,
    mediaType: attachment?.mediaType ?? null,
    sentAt: now,
    externalId: null,
  });

  // ── 7. Envia via WhatsApp e captura messageId para deduplicar echo fromMe ──
  try {
    const zapiMessageId = mediaUrl && attachment
      ? await sendMediaMessage(
          channelAddress,
          mediaUrl,
          attachment.mediaType,
          channelConfig,
          messageText || undefined,
          attachment.safeFileName,
        )
      : await sendTextMessage(channelAddress, messageText, channelConfig);
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

  return NextResponse.json({ ok: true, mediaType: attachment?.mediaType ?? null });
}
