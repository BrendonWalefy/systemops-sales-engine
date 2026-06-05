// Thin adapter: normaliza payload Z-API e delega ao ConversationOrchestrator.
// Toda a lógica de negócio, agenda e IA está no Orchestrator.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import {
  resolveClinicByZapiInbound,
  type ZapiClinicResolution,
} from "@/application/tenancy/resolve-clinic";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
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

function overrideResolution(clinicId: string): ZapiClinicResolution {
  return {
    clinicId,
    channelClinicId: clinicId,
    sourceClinicId: clinicId,
    isQaRoute: false,
    routeLabel: null,
  };
}

async function resolveWebhookClinic(
  body: ZApiInboundPayload,
  clinicIdOverride: string | null,
): Promise<ZapiClinicResolution | null> {
  if (clinicIdOverride) return overrideResolution(clinicIdOverride);
  return resolveClinicByZapiInbound({ instanceId: body.instanceId, phone: body.phone });
}

function logQaRoute(resolution: ZapiClinicResolution, phone: string): void {
  if (!resolution.isQaRoute) return;
  console.log(
    `[ZApi] QA route ${resolution.routeLabel ?? phone}: canal=${resolution.sourceClinicId} -> clínica=${resolution.clinicId}`,
  );
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

  // Roteamento E2E via query param ?clinicId=<id>
  const url = new URL(request.url);
  const clinicIdOverride = url.searchParams.get("clinicId");
  if (clinicIdOverride) {
    if (process.env.E2E_MODE !== "true") {
      return NextResponse.json({ error: "not available" }, { status: 404 });
    }
    if (clinicIdOverride !== process.env.E2E_CLINIC_ID) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Ignora grupos e status
  if (body.isGroupMsg || body.isStatusReply) {
    return new NextResponse("OK", { status: 200 });
  }

  // Mensagem enviada pela instância Z-API (fromMe: true)
  // Pode ser: (a) echo da IA enviando via API ou (b) operador digitando no celular
  if (body.fromMe) {
    // Sem texto → mídia, sticker, reação — ignora
    if (!body.text?.message) return new NextResponse("OK", { status: 200 });

    const resolution = await resolveWebhookClinic(body, clinicIdOverride);
    if (!resolution) return new NextResponse("OK", { status: 200 });
    logQaRoute(resolution, body.phone);
    const clinicId = resolution.clinicId;

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

  const resolution = await resolveWebhookClinic(body, clinicIdOverride);
  if (!resolution) {
    console.error("[ZApi] Nenhuma clínica resolvida para a instância");
    return new NextResponse("Server misconfigured", { status: 500 });
  }
  logQaRoute(resolution, body.phone);

  const clinicId = resolution.clinicId;

  const [clinicRow] = await db
    .select({
      autoReplyEnabled: clinics.autoReplyEnabled,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  if (!clinicRow) {
    console.error("[ZApi] Clínica de destino não encontrada");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

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
    .where(eq(clinics.id, resolution.channelClinicId))
    .limit(1);

  const channelConfig = channelClinicRow ? resolveChannelConfig(channelClinicRow) : null;
  const replyEnabled = clinicRow?.autoReplyEnabled !== false;

  // Mensagem inbound do lead: texto digitado ou áudio transcrito.
  let messageText: string | null = null;

  if (body.text?.message) {
    messageText = body.text.message;
  } else if (body.audio?.audioUrl) {
    if (!replyEnabled) {
      messageText = "[áudio recebido]";
    } else {
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
        if (!channelConfig) return new NextResponse("OK", { status: 200 });
        await sendTextMessage(body.phone, "Não consegui ouvir seu áudio. Pode me escrever? 😊", channelConfig).catch(
          (e) => console.error("[ZApi] Erro ao enviar fallback de áudio:", e),
        );
        return new NextResponse("OK", { status: 200 });
      }
    }
  } else {
    // Mídia não suportada (imagem, sticker, vídeo, reação)
    return new NextResponse("OK", { status: 200 });
  }

  const WEBHOOK_TIMEOUT_MS = 55_000;

  try {
    await Promise.race([
      getOrchestrator().handle({
        clinicId,
        phone: body.phone,
        messageText,
        messageId: body.messageId,
        senderName: body.senderName || undefined,
        timestamp: body.momment ? new Date(body.momment) : new Date(),
        replyEnabled,
        channelClinicId: resolution.channelClinicId,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Webhook timeout após ${WEBHOOK_TIMEOUT_MS / 1000}s`)),
          WEBHOOK_TIMEOUT_MS,
        ),
      ),
    ]);

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("[ZApi] Webhook error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
