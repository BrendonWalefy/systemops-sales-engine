// Thin adapter: normaliza payload Z-API e delega ao ConversationOrchestrator.
// Toda a lógica de negócio, agenda e IA está no Orchestrator.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import { sendZApiTextMessage } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import { WhisperGateway } from "@/infrastructure/adapters/ai/whisper-gateway";

export const dynamic = "force-dynamic";

let orchestrator: ConversationOrchestrator | null = null;
function getOrchestrator() {
  if (!orchestrator) orchestrator = new ConversationOrchestrator();
  return orchestrator;
}

let whisperGateway: WhisperGateway | null = null;
function getWhisperGateway() {
  if (!whisperGateway) whisperGateway = new WhisperGateway();
  return whisperGateway;
}

// Detecta e registra mensagem enviada pelo operador direto pelo celular (fromMe: true).
// Pausa a IA com TTL configurável por clínica — retoma automaticamente se o operador
// não voltar ao lead dentro desse período.
async function handleOperatorMessageFromPhone(
  body: ZApiInboundPayload,
  clinicId: string,
  ttlHours: number,
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

  const takeoverExpiresAt = ttlHours > 0
    ? new Date(now.getTime() + ttlHours * 60 * 60_000)
    : null;

  await db
    .update(conversations)
    .set({ aiPaused: true, takeoverExpiresAt, needsAttention: false, attentionReason: null, consecutiveUnclearCount: 0, lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conv.id));

  console.log(`[ZApi] Operador enviou mensagem pelo celular para ${leadPhone} — IA pausada até ${takeoverExpiresAt?.toISOString() ?? "indefinidamente"}`);
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

      // 2ª verificação (race condition): mensagem da IA com mesmo corpo salva nos últimos 10s
      // Cobre o caso onde o echo chega antes do Orchestrator terminar de salvar.
      // 10s é suficiente — echoes Z-API chegam em <3s e o Orchestrator salva em <5s.
      // Janela maior causa falso positivo: operador enviando mesmo texto que a IA enviou
      // nos últimos segundos seria classificado como echo e a pausa nunca aconteceria.
      const tenSecondsAgo = new Date(Date.now() - 10_000);
      const [recentAgent] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.author, "agent"),
            eq(messages.body, body.text.message),
            gte(messages.sentAt, tenSecondsAgo),
          ),
        )
        .limit(1);

      if (recentAgent) return new NextResponse("OK", { status: 200 });

      // Nenhuma das verificações bateu → é o operador enviando do celular
      const [clinicRow] = await db
        .select({ takeoverTtlHours: clinics.takeoverTtlHours })
        .from(clinics)
        .where(eq(clinics.id, clinicId))
        .limit(1);
      const ttlHours = clinicRow?.takeoverTtlHours ?? 4;
      await handleOperatorMessageFromPhone(body, clinicId, ttlHours);
    } catch (err) {
      console.error("[ZApi] Erro ao processar mensagem fromMe:", err);
    }

    return new NextResponse("OK", { status: 200 });
  }

  // Mensagem inbound do lead
  // Determina o texto da mensagem: texto digitado ou áudio transcrito
  let messageText: string | null = null;

  if (body.text?.message) {
    messageText = body.text.message;
  } else if (body.audio?.audioUrl) {
    try {
      const audioRes = await fetch(body.audio.audioUrl, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!audioRes.ok) throw new Error(`Audio download failed (${audioRes.status})`);
      const audioBuffer = await audioRes.arrayBuffer();
      const transcription = await getWhisperGateway().transcribe(audioBuffer, body.audio.mimeType);
      messageText = `[áudio] ${transcription}`;
    } catch (err) {
      console.error("[ZApi] Falha ao transcrever áudio:", err);
      await sendZApiTextMessage(body.phone, "Não consegui ouvir seu áudio. Pode me escrever? 😊").catch(
        (e) => console.error("[ZApi] Erro ao enviar fallback de áudio:", e),
      );
      return new NextResponse("OK", { status: 200 });
    }
  } else {
    // Mídia não suportada (imagem, sticker, vídeo, reação)
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
      messageText,
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
