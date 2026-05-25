// Thin adapter: normaliza payload Z-API e delega ao ConversationOrchestrator.
// Toda a lógica de negócio, agenda e IA está no Orchestrator.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

export const dynamic = "force-dynamic";

let orchestrator: ConversationOrchestrator | null = null;
function getOrchestrator() {
  if (!orchestrator) orchestrator = new ConversationOrchestrator();
  return orchestrator;
}

// Detecta e registra mensagem enviada pelo operador direto pelo celular (fromMe: true).
// Pausa a IA automaticamente para que o operador assuma o atendimento.
async function handleOperatorMessageFromPhone(
  body: ZApiInboundPayload,
  clinicId: string,
): Promise<void> {
  // body.phone em mensagens fromMe é o destinatário (o lead)
  const leadPhone = body.phone;

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .where(and(eq(conversations.clinicId, clinicId), eq(leads.phone, leadPhone)))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);

  if (!conv) {
    console.log(`[ZApi] fromMe sem conversa ativa para ${leadPhone} — ignorado`);
    return;
  }

  const now = new Date();

  await db.insert(messages).values({
    id: randomUUID(),
    conversationId: conv.id,
    author: "clinic_user",
    body: body.text!.message,
    sentAt: body.momment ? new Date(body.momment) : now,
    externalId: body.messageId,
  });

  await db
    .update(conversations)
    .set({ aiPaused: true, lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conv.id));

  console.log(`[ZApi] Operador enviou mensagem direto pelo celular para ${leadPhone} — IA pausada`);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as ZApiInboundPayload | null;
  if (!body) return new NextResponse("Bad Request", { status: 400 });

  // Ignora grupos e status
  if (body.isGroupMsg || body.isStatusReply) {
    return new NextResponse("OK", { status: 200 });
  }

  // Mensagem enviada pela instância Z-API (fromMe: true)
  // Pode ser: (a) echo da IA enviando via API ou (b) operador digitando no celular
  if (body.fromMe) {
    // Sem texto → mídia, sticker, reação — ignora
    if (!body.text?.message) return new NextResponse("OK", { status: 200 });

    const clinicId = process.env.PILOT_CLINIC_ID;
    if (!clinicId) return new NextResponse("OK", { status: 200 });

    try {
      // 1ª verificação: messageId já está no banco → é echo da IA → ignora
      const [existing] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.externalId, body.messageId))
        .limit(1);

      if (existing) return new NextResponse("OK", { status: 200 });

      // 2ª verificação (race condition): mensagem da IA com mesmo corpo salva nos últimos 30s
      // Cobre o caso onde o echo chega antes do Orchestrator terminar de salvar
      const thirtySecondsAgo = new Date(Date.now() - 30_000);
      const [recentAgent] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.author, "agent"),
            eq(messages.body, body.text.message),
            gte(messages.sentAt, thirtySecondsAgo),
          ),
        )
        .limit(1);

      if (recentAgent) return new NextResponse("OK", { status: 200 });

      // Nenhuma das verificações bateu → é o operador enviando do celular
      await handleOperatorMessageFromPhone(body, clinicId);
    } catch (err) {
      console.error("[ZApi] Erro ao processar mensagem fromMe:", err);
    }

    return new NextResponse("OK", { status: 200 });
  }

  // Mensagem inbound do lead
  if (!body.text?.message) {
    return new NextResponse("OK", { status: 200 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) {
    console.error("[ZApi] PILOT_CLINIC_ID is not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  try {
    // Verifica se auto-reply está habilitado para esta clínica
    const clinicRow = await db
      .select({ autoReplyEnabled: clinics.autoReplyEnabled })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (clinicRow.length > 0 && !clinicRow[0].autoReplyEnabled) {
      return new NextResponse("OK", { status: 200 });
    }

    await getOrchestrator().handle({
      clinicId,
      phone: body.phone,
      messageText: body.text.message,
      messageId: body.messageId,
      senderName: body.senderName || undefined,
      timestamp: body.momment ? new Date(body.momment) : new Date(),
    });

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("[ZApi] Webhook error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
