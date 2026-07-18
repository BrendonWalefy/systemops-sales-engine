// Thin adapter: valida, resolve tenant e persiste a entrada antes de enfileirar.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { organizations, conversations, messages, leads } from "@/infrastructure/db/schema";
import { and, eq, gte } from "drizzle-orm";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import { resolveClinicByZapiInstance } from "@/application/tenancy/resolve-clinic";
import {
  areEquivalentWhatsAppPhones,
  buildContactIdentifiersFromWebhook,
} from "@/core/whatsapp/WhatsAppContactIdentity";
import { isInternalOperationalWhatsAppMessage } from "@/core/whatsapp/InternalWhatsAppOperationalMessage";
import { findConversationByWhatsAppContact } from "@/application/whatsapp/find-conversation-by-whatsapp-contact";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { resolveUnsupportedInboundPlaceholder } from "@/infrastructure/adapters/channels/whatsapp/zapi-webhook-content";
import { persistInboundEventAndEnqueue } from "@/application/whatsapp/persist-inbound-event";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { buildZApiInboundEvent } from "@/infrastructure/adapters/channels/whatsapp/zapi-inbound-event";
import { createLogger } from "@/infrastructure/logging/logger";
import {
  buildHumanReviewDecisionConfirmation,
  buildHumanReviewInvalidReplyMessage,
  parseHumanReviewReply,
} from "@/domain/entities/human-review";
import { DrizzleHumanReviewRequestRepository } from "@/infrastructure/repositories/drizzle-human-review-request-repository";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function resolveWebhookClinic(
  body: ZApiInboundPayload,
  clinicIdOverride: string | null,
): Promise<string | null> {
  if (clinicIdOverride) return clinicIdOverride;
  return resolveClinicByZapiInstance(body.instanceId);
}

type OperatorOutbound =
  | { kind: "text"; body: string }
  | { kind: "media"; body: string; mediaUrl: string; mediaType: "image" | "video" | "document" };

// Persiste mensagem do operador (texto ou mídia) e pausa a IA com TTL.
async function saveOperatorOutbound(
  body: ZApiInboundPayload,
  convId: string,
  ttlHours: number,
  msg: OperatorOutbound,
): Promise<void> {
  const now = new Date();

  await db.insert(messages).values({
    id: randomUUID(),
    conversationId: convId,
    author: "clinic_user",
    body: msg.body,
    ...(msg.kind === "media" ? { mediaUrl: msg.mediaUrl, mediaType: msg.mediaType } : {}),
    sentAt: body.momment ? new Date(body.momment) : now,
    externalId: body.messageId,
  });

  const takeoverExpiresAt =
    ttlHours > 0 ? new Date(now.getTime() + ttlHours * 60 * 60_000) : null;

  await db
    .update(conversations)
    .set({
      aiPaused: true,
      takeoverExpiresAt,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
      lastMessageAt: now,
      updatedAt: now,
    })
    .where(eq(conversations.id, convId));

  console.log(
    `[ZApi] Operador enviou ${msg.kind} pelo celular (conv=${convId}) — IA pausada até ${takeoverExpiresAt?.toISOString() ?? "indefinidamente"}`,
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
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

  const body = (await request
    .json()
    .catch(() => null)) as ZApiInboundPayload | null;
  if (!body) return new NextResponse("Bad Request", { status: 400 });
  const log = createLogger({
    scope: "ZApiWebhook",
    route: "/api/whatsapp/zapi",
    traceId: body.messageId || randomUUID(),
    correlationId: body.messageId || undefined,
  });

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
    log.error("webhook.rejected", new Error("clinic_not_resolved"), {
      durationMs: Date.now() - startedAt,
      instanceId: body.instanceId ?? "missing",
      phone: body.phone ?? "unknown",
      hint: "Verifique se o instanceId da instância Z-API está cadastrado em organizations.zapi_instance_id. Rode o script de onboarding: npx tsx scripts/create-clinic.ts ./nova-clinica.json",
    });
    return new NextResponse("Server misconfigured", { status: 500 });
  }
  const clinicId = resolution;
  const clinicLog = log.child({ clinicId });

  const [clinicRow] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);

  if (!clinicRow) {
    clinicLog.error("webhook.rejected", new Error("clinic_not_found"), { durationMs: Date.now() - startedAt });
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  if (
    areEquivalentWhatsAppPhones(body.phone, clinicRow.receptionistPhone) &&
    body.text?.message
  ) {
    const parsedReviewReply = parseHumanReviewReply(body.text.message);
    const shouldRejectBareDecision = /^[1-4]$/.test(body.text.message.trim());
    const shouldRejectMalformedCaseReply = /^caso\b/i.test(body.text.message.trim());
    const channelConfig = resolveChannelConfig(clinicRow);
    const reviewRepo = new DrizzleHumanReviewRequestRepository();

    if (parsedReviewReply) {
      const pendingReview = await reviewRepo.findPendingByCode({
        clinicId,
        reviewCode: parsedReviewReply.reviewCode,
      });

      if (!pendingReview) {
        await sendTextMessage(
          body.phone,
          `Não encontrei um caso pendente com o número ${parsedReviewReply.reviewCode}. Confira a mensagem do caso e responda novamente.`,
          channelConfig,
        ).catch((err) => console.warn("[HumanReview] confirmação de erro falhou:", err));
        return new NextResponse("OK", { status: 200 });
      }

      const decidedReview = await reviewRepo.applyDecision({
        id: pendingReview.id,
        decision: parsedReviewReply.decision,
        source: "whatsapp",
        reviewerPhone: body.phone,
      });

      if (!decidedReview) {
        await sendTextMessage(
          body.phone,
          `O Caso ${parsedReviewReply.reviewCode} já foi decidido ou não está mais pendente.`,
          channelConfig,
        ).catch((err) => console.warn("[HumanReview] confirmação de caso decidido falhou:", err));
        return new NextResponse("OK", { status: 200 });
      }

      const [conversationRow] = await db
        .select({ leadId: conversations.leadId })
        .from(conversations)
        .where(eq(conversations.id, pendingReview.conversationId))
        .limit(1);
      let leadName = "paciente";
      if (conversationRow) {
        const [lead] = await db
          .select({ name: leads.name })
          .from(leads)
          .where(eq(leads.id, conversationRow.leadId))
          .limit(1);
        leadName = lead?.name ?? "paciente";
      }

      await sendTextMessage(
        body.phone,
        buildHumanReviewDecisionConfirmation({
          reviewCode: decidedReview.reviewCode,
          leadName,
          decision: parsedReviewReply.decision,
        }),
        channelConfig,
      ).catch((err) => console.warn("[HumanReview] confirmação falhou:", err));

      if (
        parsedReviewReply.decision === "approved_direct_booking" ||
        parsedReviewReply.decision === "needs_evaluation"
      ) {
        await new ConversationOrchestrator().resumeAfterHumanReviewDecision({
          clinicId,
          reviewRequestId: decidedReview.id,
          decision: parsedReviewReply.decision,
        });
      }

      return new NextResponse("OK", { status: 200 });
    }

    if (shouldRejectBareDecision || shouldRejectMalformedCaseReply) {
      await sendTextMessage(
        body.phone,
        buildHumanReviewInvalidReplyMessage(),
        channelConfig,
      ).catch((err) => console.warn("[HumanReview] resposta inválida falhou:", err));
      return new NextResponse("OK", { status: 200 });
    }
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
  // Pode ser: (a) echo da IA enviando via API ou (b) operador enviando do celular (texto ou mídia)
  if (body.fromMe) {
    // Sticker, reação, ou payload sem conteúdo reconhecível → ignora
    const hasText = Boolean(body.text?.message);
    const hasMedia =
      Boolean(body.video?.videoUrl) ||
      Boolean(body.image?.imageUrl) ||
      Boolean(body.document?.documentUrl);
    const operatorPlaceholder = resolveUnsupportedInboundPlaceholder(body, "operator");

    if (!hasText && !hasMedia && !operatorPlaceholder) return new NextResponse("OK", { status: 200 });

    try {
      // 1ª verificação: messageId já registrado → echo ou mensagem duplicada → ignora
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
      const ttlHours = clinicRow?.takeoverTtlHours ?? 4;

      // Mensagem de texto fromMe: verifica se é echo da IA ou operador digitando
      if (hasText) {
        // 2ª verificação (race condition): echo da IA chegou antes do Orchestrator salvar.
        // Filtrado pela conversa específica para evitar falsos positivos.
        const tenSecondsAgo = new Date(Date.now() - 10_000);
        const [recentAgent] = await db
          .select({ id: messages.id, externalId: messages.externalId })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conv.id),
              eq(messages.author, "agent"),
              eq(messages.body, body.text!.message),
              gte(messages.sentAt, tenSecondsAgo),
            ),
          )
          .limit(1);

        if (recentAgent) {
          if (!recentAgent.externalId) {
            await db
              .update(messages)
              .set({ externalId: body.messageId })
              .where(eq(messages.id, recentAgent.id));
          }
          return new NextResponse("OK", { status: 200 });
        }

        // Nenhuma verificação bateu → operador enviando texto do celular
        await saveOperatorOutbound(body, conv.id, ttlHours, {
          kind: "text",
          body: body.text!.message,
        });
        return new NextResponse("OK", { status: 200 });
      }

      // Mídia fromMe (vídeo, imagem, documento) → sempre é do operador, nunca echo da IA
      // (a IA envia mídia por URL direta na Z-API, não gera payload fromMe de mídia)
      let operatorMedia: OperatorOutbound | null = null;
      if (body.video?.videoUrl) {
        operatorMedia = {
          kind: "media",
          body: body.video.caption?.trim() || "[vídeo enviado pelo operador]",
          mediaUrl: body.video.videoUrl,
          mediaType: "video",
        };
      } else if (body.image?.imageUrl) {
        operatorMedia = {
          kind: "media",
          body: body.image.caption?.trim() || "[imagem enviada pelo operador]",
          mediaUrl: body.image.imageUrl,
          mediaType: "image",
        };
      } else if (body.document?.documentUrl) {
        operatorMedia = {
          kind: "media",
          body: `[documento] ${body.document.fileName ?? "arquivo"}`,
          mediaUrl: body.document.documentUrl,
          mediaType: "document",
        };
      }

      if (operatorMedia) {
        await saveOperatorOutbound(body, conv.id, ttlHours, operatorMedia);
      } else if (operatorPlaceholder) {
        await saveOperatorOutbound(body, conv.id, ttlHours, {
          kind: "text",
          body: operatorPlaceholder,
        });
      }
    } catch (err) {
      console.error("[ZApi] Erro ao processar mensagem fromMe:", err);
    }

    return new NextResponse("OK", { status: 200 });
  }

  if (!body.messageId) {
    console.error("[ZApi] Payload inbound sem messageId");
    return new NextResponse("Bad Request", { status: 400 });
  }

  try {
    const result = await persistInboundEventAndEnqueue(
      buildZApiInboundEvent({ clinicId, payload: body }),
      {
        inboundEventStore: new DrizzleInboundEventStore(),
        jobQueue: new DrizzleJobQueue(),
      },
    );
    clinicLog.info("webhook.enqueued", {
      inboundEventId: result.inboundEventId,
      eventWasNew: result.eventWasNew,
      jobWasNew: result.jobWasNew,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    // Returning an error asks Z-API to retry. A duplicate event retries only
    // the idempotent enqueue, repairing a prior persistence/enqueue split.
    clinicLog.error("webhook.enqueue.failed", error, { durationMs: Date.now() - startedAt });
    return new NextResponse("Internal Server Error", { status: 500 });
  }

  return new NextResponse("OK", { status: 200 });
}
