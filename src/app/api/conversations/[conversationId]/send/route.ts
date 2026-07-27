// Thin adapter: valida auth, registra mensagem do operador e envia via WhatsApp.
// Toda chamada desta rota pausa a IA automaticamente — operador assumiu o atendimento.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { head } from "@vercel/blob";
import { db } from "@/infrastructure/db/client";
import { organizations, conversations, leads, messages } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { inspectOperatorAttachment, type OperatorAttachmentInspection } from "@/application/conversations/operator-attachment";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";

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
  let clientMessageId = "";
  try {
    const body = await request.json() as {
      message?: string;
      attachment?: { url?: string; fileName?: string };
      clientMessageId?: string;
    };
    messageText = body.message?.trim() ?? "";
    attachmentInput = body.attachment ?? null;
    clientMessageId = body.clientMessageId?.trim() ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!messageText && !attachmentInput) {
    return NextResponse.json({ error: "Message or attachment is required" }, { status: 400 });
  }
  if (clientMessageId && !UUID_PATTERN.test(clientMessageId)) {
    return NextResponse.json({ error: "Invalid clientMessageId" }, { status: 400 });
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

  const now = new Date();
  const msgId = clientMessageId || randomUUID();
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
  // ── 6. Persiste a intenção humana com idempotência. Se a resposta HTTP se
  // perder, o cliente repete o mesmo UUID e apenas repara o enqueue. ──
  const messageBody = messageText || attachment?.safeFileName || "Anexo";
  const [insertedMessage] = await db
    .insert(messages)
    .values({
      id: msgId,
      conversationId,
      author: "clinic_user",
      body: messageBody,
      mediaUrl,
      mediaType: attachment?.mediaType ?? null,
      sentAt: now,
      externalId: null,
    })
    .onConflictDoNothing({ target: messages.id })
    .returning({ id: messages.id });
  if (!insertedMessage) {
    const [existingMessage] = await db
      .select({
        conversationId: messages.conversationId,
        body: messages.body,
        mediaUrl: messages.mediaUrl,
        mediaType: messages.mediaType,
      })
      .from(messages)
      .where(eq(messages.id, msgId))
      .limit(1);
    const sameIntent = existingMessage?.conversationId === conversationId
      && existingMessage.body === messageBody
      && existingMessage.mediaUrl === mediaUrl
      && existingMessage.mediaType === (attachment?.mediaType ?? null);
    if (!sameIntent) {
      return NextResponse.json({ error: "clientMessageId already used" }, { status: 409 });
    }
  }

  // ── 7. Pausa IA antes de tornar o envio elegível para o worker. ──
  const takeoverExpiresAt = ttlHours > 0
    ? new Date(now.getTime() + ttlHours * 60 * 60_000)
    : null;
  await db
    .update(conversations)
    .set({ aiPaused: true, takeoverExpiresAt, needsAttention: false, attentionReason: null, consecutiveUnclearCount: 0, lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conversationId));

  // ── 8. Outbox durável e ordenada por conversa. Retry não chama o provedor
  // nesta rota e não recompõe conteúdo. ──
  const enqueueResult = await enqueueOutboundMessage(
    {
      clinicId: conv.clinicId,
      conversationId,
      channel: "whatsapp",
      deliveryKind: attachment?.mediaType ?? "text",
      category: "reply",
      dedupeKey: `operator:${msgId}`,
      payload: {
        version: 1,
        kind: "operator_message",
        to: channelAddress,
        operatorMessageId: msgId,
        text: messageText,
        ...(mediaUrl && attachment
          ? {
              attachment: {
                url: mediaUrl,
                mediaType: attachment.mediaType,
                fileName: attachment.safeFileName,
              },
            }
          : {}),
      },
    },
    {
      outboundMessageStore: new DrizzleOutboundMessageStore(),
      jobQueue: new DrizzleJobQueue(),
    },
  );

  return NextResponse.json({
    ok: true,
    queued: true,
    outboundMessageId: enqueueResult.outboundMessageId,
    mediaType: attachment?.mediaType ?? null,
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
