import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { OutboundMessageStore } from "@/application/ports/outbound-message-store";
import {
  isConversationOutboundPayload,
  type ConversationOutboundPayload,
} from "@/application/jobs/conversation-outbound-payload";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { scheduleFollowUp } from "@/application/use-cases/leads/schedule-follow-up";
import { sendVoiceOrText } from "@/lib/tts-send";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import {
  OutboundDeliveryService,
  type OutboundPart,
  type OutboundMediaPart,
} from "@/infrastructure/adapters/channels/whatsapp/outbound-delivery-service";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { createLogger } from "@/infrastructure/logging/logger";
import { db } from "@/infrastructure/db/client";
import { organizations, messages } from "@/infrastructure/db/schema";

export type SendMessageJobDependencies = {
  outboundMessageStore: OutboundMessageStore;
  delivery?: (input: {
    payload: ConversationOutboundPayload;
    clinicId: string;
    conversationId: string;
  }) => Promise<string | null>;
};

export class SendMessageJobHandler {
  private readonly delivery: NonNullable<SendMessageJobDependencies["delivery"]>;

  constructor(private readonly deps: SendMessageJobDependencies) {
    this.delivery = deps.delivery ?? deliverConversationOutbound;
  }

  async processJob(job: { id?: string; payload: unknown }): Promise<"sent" | "ignored" | "deferred"> {
    const outboundMessageId = getOutboundMessageId(job.payload);
    if (!outboundMessageId) throw new Error("message.send job has no outboundMessageId");

    const log = createLogger({
      scope: "SendMessageJob",
      jobId: job.id,
      queue: "message.send",
      traceId: outboundMessageId,
    });
    const startedAt = Date.now();

    const outbound = await this.deps.outboundMessageStore.findOutboundMessage(outboundMessageId);
    if (!outbound || outbound.status === "sent" || outbound.status === "cancelled" || outbound.status === "dead") {
      log.info("job.ignored", { reason: "outbound_terminal_or_missing", durationMs: Date.now() - startedAt });
      return "ignored";
    }
    const outboundLog = log.child({
      clinicId: outbound.clinicId,
      conversationId: outbound.conversationId,
    });
    if (await this.deps.outboundMessageStore.hasEarlierActiveMessage(outbound)) {
      outboundLog.info("job.deferred", { reason: "earlier_message_active", durationMs: Date.now() - startedAt });
      return "deferred";
    }
    if (!(await this.deps.outboundMessageStore.markOutboundProcessing(outbound.id))) {
      outboundLog.info("job.ignored", { reason: "outbound_claim_lost", durationMs: Date.now() - startedAt });
      return "ignored";
    }
    if (!isConversationOutboundPayload(outbound.payload)) {
      throw new Error(`Unsupported outbound payload for ${outbound.id}`);
    }

    const providerMessageId = await this.delivery({
      payload: outbound.payload,
      clinicId: outbound.clinicId,
      conversationId: outbound.conversationId,
    });
    await this.deps.outboundMessageStore.markOutboundDelivered({
      id: outbound.id,
      providerMessageId,
    });
    outboundLog.info("job.sent", { durationMs: Date.now() - startedAt, providerMessageId });
    return "sent";
  }
}

function getOutboundMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).outboundMessageId;
  return typeof value === "string" && value ? value : null;
}

async function deliverConversationOutbound(input: {
  payload: ConversationOutboundPayload;
  clinicId: string;
  conversationId: string;
}): Promise<string | null> {
  const [clinic] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.clinicId))
    .limit(1);
  if (!clinic) throw new Error(`Clinic not found for outbound delivery: ${input.clinicId}`);

  const config = resolveChannelConfig(clinic);
  const conversationRepository = new DrizzleConversationRepository();
  const appointmentRepository = new DrizzleAppointmentRepository();
  const followUpRepository = new DrizzleFollowUpRepository();
  const delivery = new OutboundDeliveryService();
  const log = createLogger({
    scope: "SenderWorker",
    correlationId: input.payload.agentMessageId,
    clinicId: input.clinicId,
    conversationId: input.conversationId,
  });
  let firstProviderMessageId: string | null = null;

  const persistMedia = async ({
    part,
    msgId,
    isFirst = false,
  }: { part: OutboundMediaPart; msgId: string | null; isFirst?: boolean }) => {
    if (isFirst && input.payload.interleavedParts.length > 0) {
      await db
        .update(messages)
        .set({
          body: part.title,
          mediaUrl: part.url,
          mediaType: part.mediaType,
          ...(msgId ? { externalId: msgId } : {}),
          deliveryFormat: "text",
        })
        .where(eq(messages.id, input.payload.agentMessageId));
    } else {
      await conversationRepository.appendMessage({
        id: randomUUID(),
        conversationId: input.conversationId,
        author: "agent",
        body: part.title,
        mediaUrl: part.url,
        mediaType: part.mediaType,
        sentAt: new Date(),
        externalId: msgId,
        intent: input.payload.intent,
        deliveryFormat: "text",
      });
    }
    if (part.mediaType === "video") {
      const activeAppointment = await appointmentRepository
        .findActiveByLeadId(input.payload.leadId)
        .catch(() => null);
      if (!activeAppointment) {
        await scheduleFollowUp({
          clinicId: input.clinicId,
          leadId: input.payload.leadId,
          trigger: "video_sent",
          videoTitle: part.title,
          followUpRepository,
        });
      }
    }
  };

  if (input.payload.interleavedParts.length > 0) {
    await delivery.deliver({
      to: input.payload.to,
      parts: input.payload.interleavedParts as OutboundPart[],
      config,
      log,
      sendText: async (content) => {
        const result = await sendVoiceOrText(
          input.payload.to,
          content,
          config,
          false,
          input.payload.ttsConfig,
          input.clinicId,
        );
        return { msgId: result.msgId, deliveryFormat: result.deliveryFormat };
      },
      onTextSent: async ({ content, msgId, deliveryFormat, isFirst }) => {
        if (isFirst) {
          firstProviderMessageId = msgId;
          await db
            .update(messages)
            .set({
              body: content,
              ...(msgId ? { externalId: msgId } : {}),
              deliveryFormat,
            })
            .where(eq(messages.id, input.payload.agentMessageId));
          return;
        }
        await conversationRepository.appendMessage({
          id: randomUUID(),
          conversationId: input.conversationId,
          author: "agent",
          body: content,
          mediaUrl: null,
          mediaType: null,
          sentAt: new Date(),
          externalId: msgId,
          intent: input.payload.intent,
          deliveryFormat,
        });
      },
      onMediaSent: persistMedia,
    });
  } else {
    const result = await sendVoiceOrText(
      input.payload.to,
      input.payload.replyText,
      config,
      input.payload.useVoice,
      input.payload.ttsConfig,
      input.clinicId,
    );
    firstProviderMessageId = result.msgId;
    await db
      .update(messages)
      .set({
        ...(result.msgId ? { externalId: result.msgId } : {}),
        deliveryFormat: result.deliveryFormat,
        ...(result.blobUrl ? { mediaUrl: result.blobUrl, mediaType: "audio" } : {}),
      })
      .where(eq(messages.id, input.payload.agentMessageId));
  }

  if (input.payload.mediaParts.length > 0) {
    await delivery.deliver({
      to: input.payload.to,
      parts: input.payload.mediaParts as OutboundPart[],
      config,
      log,
      sendText: () => Promise.resolve({ msgId: null, deliveryFormat: "text" as const }),
      onTextSent: async () => {},
      onMediaSent: persistMedia,
    });
  }

  if (input.payload.pipelineAdvance) {
    const stateMachine = new ConversationStateMachine();
    if (input.payload.pipelineAdvance.action === "advance") {
      await stateMachine.advancePipelineStep(
        input.conversationId,
        input.payload.pipelineAdvance.nextStepIndex,
      );
    } else {
      await stateMachine.exitTreatmentPipeline(input.conversationId);
    }
  }

  return firstProviderMessageId;
}
