// Thin adapter: normaliza payload Z-API e delega ao ConversationOrchestrator.
// Toda a lógica de negócio, agenda e IA está no Orchestrator.

import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, messages } from "@/infrastructure/db/schema";
import { and, eq, gte } from "drizzle-orm";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import {
  resolveClinicByZapiInbound,
  type ZapiClinicResolution,
} from "@/application/tenancy/resolve-clinic";
import { WhisperGateway } from "@/infrastructure/adapters/ai/whisper-gateway";
import { buildContactIdentifiersFromWebhook } from "@/core/whatsapp/WhatsAppContactIdentity";
import { isInternalOperationalWhatsAppMessage } from "@/core/whatsapp/InternalWhatsAppOperationalMessage";
import { findConversationByWhatsAppContact } from "@/application/whatsapp/find-conversation-by-whatsapp-contact";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// Registra mensagem do operador enviada direto pelo celular (fromMe: true) e pausa a IA.
async function handleOperatorMessageFromPhone(
  body: ZApiInboundPayload,
  convId: string,
  ttlHours: number,
): Promise<void> {
  const now = new Date();

  await db.insert(messages).values({
    id: randomUUID(),
    conversationId: convId,
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
    .where(eq(conversations.id, convId));

  console.log(`[ZApi] Operador enviou mensagem pelo celular (conv=${convId}) — IA pausada até ${takeoverExpiresAt?.toISOString() ?? "indefinidamente"}`);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Validação de origem: a Z-API não assina webhooks, então o contrato é um
  // secret compartilhado embutido na URL configurada no painel
  // (.../api/whatsapp/zapi?secret=<ZAPI_WEBHOOK_SECRET>). Só é exigido quando
  // a env está definida — permite rollout sem derrubar o webhook atual:
  // 1) adiciona ?secret= na URL do painel Z-API, 2) define a env no Vercel.
  const webhookSecret = process.env.ZAPI_WEBHOOK_SECRET;
  if (webhookSecret) {
    const provided =
      new URL(request.url).searchParams.get("secret") ??
      request.headers.get("x-webhook-secret");
    if (provided !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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
      receptionistPhone: clinics.receptionistPhone,
      takeoverTtlHours: clinics.takeoverTtlHours,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  if (!clinicRow) {
    console.error("[ZApi] Clínica de destino não encontrada");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  if (
    isInternalOperationalWhatsAppMessage({
      senderPhone: body.phone,
      receptionistPhone: clinicRow.receptionistPhone,
      messageText: body.text?.message ?? null,
    })
  ) {
    console.log(
      `[ZApi] Mensagem operacional interna ignorada (clinicId=${clinicId}, phone=${body.phone})`,
    );
    return new NextResponse("OK", { status: 200 });
  }

  // Mensagem enviada pela instância Z-API (fromMe: true)
  // Pode ser: (a) echo da IA enviando via API ou (b) operador digitando no celular
  // QA routes são excluídas: o testador envia do próprio número (fromMe=true) mas
  // deve ser tratado como lead — não pausa a IA.
  if (body.fromMe) {
    // Sem texto → mídia, sticker, reação — ignora
    if (!body.text?.message) return new NextResponse("OK", { status: 200 });

    // QA route: não trata como operador — cai no fluxo de lead abaixo
    if (!resolution.isQaRoute) {
      try {
        // 1ª verificação: messageId já está no banco → echo já registrado → ignora
        const [existing] = await db
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.externalId, body.messageId))
          .limit(1);

        if (existing) return new NextResponse("OK", { status: 200 });

        // Busca conversa pelo identificador WhatsApp (telefone e/ou @lid).
        const contactIdentifiers = buildContactIdentifiersFromWebhook({
          phone: body.phone,
          chatLid: body.chatLid,
        });
        const leadRepo = new DrizzleLeadRepository();
        const conversationRepo = new DrizzleConversationRepository();
        const match = await findConversationByWhatsAppContact({
          clinicId,
          identifiers: contactIdentifiers,
          senderName: body.senderName,
          senderPhoto: body.senderPhoto ?? null,
          channel: "whatsapp",
          leadRepository: leadRepo,
          conversationRepository: conversationRepo,
          idGenerator: randomUUID,
          now: new Date(),
        });

        if (!match) {
          console.log(
            `[ZApi] fromMe sem conversa ativa — clinicId=${clinicId} phone=${body.phone} chatLid=${body.chatLid ?? "—"}`,
          );
          return new NextResponse("OK", { status: 200 });
        }

        const conv = { id: match.conversation.id };

        // 2ª verificação (race condition): echo da IA chegou antes do Orchestrator salvar.
        // Filtrado pela conversa específica para evitar falsos positivos com textos idênticos
        // em conversas de outros leads (ex: dois leads recebem "Olá!" em <10s).
        const tenSecondsAgo = new Date(Date.now() - 10_000);
        const [recentAgent] = await db
          .select({ id: messages.id, externalId: messages.externalId })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conv.id),
              eq(messages.author, "agent"),
              eq(messages.body, body.text.message),
              gte(messages.sentAt, tenSecondsAgo),
            ),
          )
          .limit(1);

        if (recentAgent) {
          // Atualiza o externalId do agente se ainda não foi preenchido (race condition)
          if (!recentAgent.externalId) {
            await db
              .update(messages)
              .set({ externalId: body.messageId })
              .where(eq(messages.id, recentAgent.id));
          }
          return new NextResponse("OK", { status: 200 });
        }

        // Nenhuma verificação bateu → é o operador enviando do celular
        const ttlHours = clinicRow?.takeoverTtlHours ?? 4;
        await handleOperatorMessageFromPhone(body, conv.id, ttlHours);
      } catch (err) {
        console.error("[ZApi] Erro ao processar mensagem fromMe:", err);
      }

      return new NextResponse("OK", { status: 200 });
    }
  }

  const replyEnabled = clinicRow?.autoReplyEnabled !== false;

  // Dedup: messageId já registrado no banco (ex: echo de mensagem enviada pelo dispatcher)
  if (body.messageId) {
    const [dup] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.externalId, body.messageId))
      .limit(1);
    if (dup) return new NextResponse("OK", { status: 200 });
  }

  // Mensagem inbound do lead: texto digitado, áudio transcrito, ou mídia (imagem/vídeo/documento).
  let messageText: string | null = null;
  let inboundMediaUrl: string | null = null;
  let inboundMediaType: "image" | "video" | "audio" | "document" | null = null;

  if (body.text?.message) {
    messageText = body.text.message;
  } else if (body.audio?.audioUrl) {
    inboundMediaUrl = body.audio.audioUrl;
    inboundMediaType = "audio";
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
        messageText = "[áudio] Transcrição automática indisponível. O lead enviou um áudio, mas não foi possível baixar ou transcrever. Peça para ele escrever a mensagem.";
      }
    }
  } else if (body.image?.imageUrl) {
    inboundMediaUrl = body.image.imageUrl;
    inboundMediaType = "image";
    messageText = body.image.caption?.trim() || "[imagem recebida]";
  } else if (body.video?.videoUrl) {
    inboundMediaUrl = body.video.videoUrl;
    inboundMediaType = "video";
    messageText = body.video.caption?.trim() || "[vídeo recebido]";
  } else if (body.document?.documentUrl) {
    inboundMediaUrl = body.document.documentUrl;
    inboundMediaType = "document";
    messageText = `[documento] ${body.document.fileName ?? "arquivo recebido"}`;
  } else {
    // Sticker, reação ou tipo não suportado — ignora silenciosamente
    return new NextResponse("OK", { status: 200 });
  }

  // Retorna 200 imediatamente para o Z-API não retentar (timeout curto de resposta).
  // `after` garante que o pipeline complete dentro do mesmo invocation serverless.
  after(
    getOrchestrator().handle({
      clinicId,
      phone: body.phone,
      whatsappLid: body.chatLid ?? null,
      messageText,
      messageId: body.messageId,
      senderName: body.senderName || undefined,
      senderPhoto: body.senderPhoto ?? null,
      timestamp: body.momment ? new Date(body.momment) : new Date(),
      replyEnabled,
      channelClinicId: resolution.channelClinicId,
      mediaUrl: inboundMediaUrl ?? undefined,
      mediaType: inboundMediaType ?? undefined,
    }).catch((error) => console.error("[ZApi] Webhook error:", error)),
  );

  return new NextResponse("OK", { status: 200 });
}
