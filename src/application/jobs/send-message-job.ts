import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import {
  evaluateOutboundSafetyGate,
  getOutboundCapWindows,
  isOutboundSafetyGatedCategory,
} from "@/application/channel-safety/outbound-safety-gate";
import type { OutboundMessage, OutboundMessageStore } from "@/application/ports/outbound-message-store";
import type {
  OutboundSafetyContext,
  OutboundSafetyContextReader,
} from "@/application/ports/outbound-safety-context-reader";
import {
  isAutomationOutboundPayload,
  isConversationOutboundPayload,
  isOutboundPayload,
  type AutomationOutboundPayload,
  type ConversationOutboundPayload,
  type OutboundPayload,
} from "@/application/jobs/conversation-outbound-payload";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { scheduleFollowUp } from "@/application/use-cases/leads/schedule-follow-up";
import { sendVoiceOrText } from "@/lib/tts-send";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { sendMediaMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import {
  OutboundDeliveryService,
  type OutboundPart,
  type OutboundMediaPart,
} from "@/infrastructure/adapters/channels/whatsapp/outbound-delivery-service";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { areEquivalentWhatsAppPhones } from "@/core/whatsapp/WhatsAppContactIdentity";
import { createLogger } from "@/infrastructure/logging/logger";
import { db } from "@/infrastructure/db/client";
import { organizations, messages, followUps, leads } from "@/infrastructure/db/schema";
import { DrizzleOutboundSafetyContextReader } from "@/infrastructure/repositories/drizzle-outbound-safety-context-reader";

export type SendMessageJobDependencies = {
  outboundMessageStore: OutboundMessageStore;
  safetyContextReader?: OutboundSafetyContextReader;
  automationDispatchLifecycle?: AutomationDispatchLifecycle;
  now?: () => Date;
  capJitterMs?: () => number;
  delivery?: (input: {
    payload: OutboundPayload;
    clinicId: string;
    conversationId: string;
  }) => Promise<string | null>;
};

export type AutomationDispatchLifecycle = {
  markDelivered(outbound: OutboundMessageForAutomationLifecycle, deliveredAt: Date): Promise<void>;
  markCancelled(outbound: OutboundMessageForAutomationLifecycle, reason: string, cancelledAt: Date): Promise<void>;
};

type OutboundMessageForAutomationLifecycle = {
  category: string;
  dedupeKey: string | null;
  clinicId: string;
  payload: OutboundPayload;
};

export type SendMessageJobProcessResult =
  | "sent"
  | "ignored"
  | "deferred"
  | { status: "deferred"; runAt: Date; reason: string };

export class SendMessageJobHandler {
  private readonly delivery: NonNullable<SendMessageJobDependencies["delivery"]>;
  private readonly safetyContextReader: OutboundSafetyContextReader;
  private readonly automationDispatchLifecycle: AutomationDispatchLifecycle;
  private readonly now: () => Date;
  private readonly capJitterMs: () => number;

  constructor(private readonly deps: SendMessageJobDependencies) {
    this.delivery = deps.delivery ?? deliverOutboundPayload;
    this.safetyContextReader = deps.safetyContextReader ?? new DrizzleOutboundSafetyContextReader();
    this.automationDispatchLifecycle = deps.automationDispatchLifecycle ?? drizzleAutomationDispatchLifecycle;
    this.now = deps.now ?? (() => new Date());
    this.capJitterMs = deps.capJitterMs ?? (() => Math.floor(Math.random() * 30 * 60_000));
  }

  async processJob(job: { id?: string; payload: unknown }): Promise<SendMessageJobProcessResult> {
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
      await this.reconcileTerminalAutomationLifecycle(outbound);
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
    if (!isOutboundPayload(outbound.payload)) {
      throw new Error(`Unsupported outbound payload for ${outbound.id}`);
    }
    const outboundForLifecycle: OutboundMessageForAutomationLifecycle = {
      category: outbound.category,
      dedupeKey: outbound.dedupeKey,
      clinicId: outbound.clinicId,
      payload: outbound.payload,
    };

    let safetyContext: OutboundSafetyContext | null = null;
    if (isAutomationOutboundPayload(outbound.payload)) {
      if (outbound.payload.conversationId !== outbound.conversationId) {
        await this.deps.outboundMessageStore.markOutboundCancelled(
          outbound.id,
          "invalid_automation_context",
        );
        await this.automationDispatchLifecycle.markCancelled(
          outboundForLifecycle,
          "invalid_automation_context",
          this.now(),
        );
        outboundLog.info("job.ignored", {
          reason: "invalid_automation_context",
          durationMs: Date.now() - startedAt,
        });
        return "ignored";
      }

      safetyContext = await this.safetyContextReader.getContext({
        clinicId: outbound.clinicId,
        leadId: outbound.payload.leadId,
        conversationId: outbound.conversationId,
        agentMessageId: outbound.payload.agentMessageId,
      });

      if (!isCompleteAutomationContext(safetyContext)) {
        await this.deps.outboundMessageStore.markOutboundCancelled(
          outbound.id,
          "invalid_automation_context",
        );
        await this.automationDispatchLifecycle.markCancelled(
          outboundForLifecycle,
          "invalid_automation_context",
          this.now(),
        );
        outboundLog.info("job.ignored", {
          reason: "invalid_automation_context",
          durationMs: Date.now() - startedAt,
        });
        return "ignored";
      }

      if (!automationDestinationMatchesLead(outbound.payload.to, safetyContext.lead)) {
        await this.deps.outboundMessageStore.markOutboundCancelled(
          outbound.id,
          "invalid_automation_context",
        );
        await this.automationDispatchLifecycle.markCancelled(
          outboundForLifecycle,
          "invalid_automation_context",
          this.now(),
        );
        outboundLog.info("job.ignored", {
          reason: "invalid_automation_context",
          durationMs: Date.now() - startedAt,
        });
        return "ignored";
      }
    }

    if (isOutboundSafetyGatedCategory(outbound.category)) {
      const context = safetyContext ?? await this.safetyContextReader.getContext({
        clinicId: outbound.clinicId,
        leadId: outbound.payload.leadId,
        conversationId: outbound.conversationId,
        agentMessageId: outbound.payload.agentMessageId,
      });
      if (!context?.lead) {
        await this.deps.outboundMessageStore.markOutboundCancelled(
          outbound.id,
          "invalid_automation_context",
        );
        await this.automationDispatchLifecycle.markCancelled(
          outboundForLifecycle,
          "invalid_automation_context",
          this.now(),
        );
        outboundLog.info("job.ignored", {
          reason: "invalid_automation_context",
          durationMs: Date.now() - startedAt,
        });
        return "ignored";
      }
      const now = this.now();

      if (context.lead?.contactConsentRevokedAt) {
        await this.deps.outboundMessageStore.markOutboundCancelled(outbound.id, "consent_revoked");
        await this.automationDispatchLifecycle.markCancelled(outboundForLifecycle, "consent_revoked", this.now());
        outboundLog.info("job.ignored", {
          reason: "consent_revoked",
          durationMs: Date.now() - startedAt,
        });
        return "ignored";
      }

      const windows = getOutboundCapWindows({ clinic: context.clinic, now });
      const [sentLastHour, sentToday] = await Promise.all([
        this.deps.outboundMessageStore.countSentSince({
          clinicId: outbound.clinicId,
          since: windows.hourlySince,
        }),
        this.deps.outboundMessageStore.countSentSince({
          clinicId: outbound.clinicId,
          since: windows.dailySince,
        }),
      ]);
      const gate = evaluateOutboundSafetyGate({
        category: outbound.category,
        clinic: context.clinic,
        lead: context.lead,
        sentLastHour,
        sentToday,
        now,
        capJitterMs: this.capJitterMs(),
      });

      if (gate.action === "cancel") {
        await this.deps.outboundMessageStore.markOutboundCancelled(outbound.id, gate.reason);
        await this.automationDispatchLifecycle.markCancelled(outboundForLifecycle, gate.reason, this.now());
        outboundLog.info("job.ignored", {
          reason: gate.reason,
          durationMs: Date.now() - startedAt,
        });
        return "ignored";
      }

      if (gate.action === "defer") {
        await this.deps.outboundMessageStore.markOutboundPending(outbound.id, gate.reason);
        outboundLog.info("job.deferred", {
          reason: gate.reason,
          runAt: gate.runAt.toISOString(),
          durationMs: Date.now() - startedAt,
        });
        return { status: "deferred", runAt: gate.runAt, reason: gate.reason };
      }

      const obsoleteReason = getObsoleteAutomationReason(outbound.category, context);
      if (obsoleteReason) {
        await this.deps.outboundMessageStore.markOutboundCancelled(outbound.id, obsoleteReason);
        await this.automationDispatchLifecycle.markCancelled(outboundForLifecycle, obsoleteReason, this.now());
        outboundLog.info("job.ignored", {
          reason: obsoleteReason,
          durationMs: Date.now() - startedAt,
        });
        return "ignored";
      }
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
    await this.automationDispatchLifecycle.markDelivered(outboundForLifecycle, this.now());
    outboundLog.info("job.sent", { durationMs: Date.now() - startedAt, providerMessageId });
    return "sent";
  }

  private async reconcileTerminalAutomationLifecycle(outbound: OutboundMessage | null): Promise<void> {
    if (!outbound || !isOutboundPayload(outbound.payload)) return;
    const lifecycleInput: OutboundMessageForAutomationLifecycle = {
      category: outbound.category,
      dedupeKey: outbound.dedupeKey,
      clinicId: outbound.clinicId,
      payload: outbound.payload,
    };
    if (outbound.status === "sent") {
      await this.automationDispatchLifecycle.markDelivered(
        lifecycleInput,
        outbound.sentAt ?? this.now(),
      );
    }
    if (outbound.status === "cancelled" || outbound.status === "dead") {
      await this.automationDispatchLifecycle.markCancelled(
        lifecycleInput,
        outbound.lastError ?? "cancelled",
        this.now(),
      );
    }
  }
}

const drizzleAutomationDispatchLifecycle: AutomationDispatchLifecycle = {
  async markDelivered(outbound, deliveredAt) {
    if (!isAutomationOutboundPayload(outbound.payload)) return;

    if (outbound.category === "follow_up") {
      const followUpId = parseFollowUpDedupeKey(outbound.dedupeKey);
      if (!followUpId) return;
      await db
        .update(followUps)
        .set({ status: "done", completedAt: deliveredAt, updatedAt: deliveredAt })
        .where(
          and(
            eq(followUps.id, followUpId),
            eq(followUps.clinicId, outbound.clinicId),
            eq(followUps.leadId, outbound.payload.leadId),
          ),
        );
      await db
        .update(leads)
        .set({ status: "in_conversation", updatedAt: deliveredAt })
        .where(and(eq(leads.id, outbound.payload.leadId), eq(leads.clinicId, outbound.clinicId)));
    }
  },

  async markCancelled(outbound, reason, cancelledAt) {
    if (!isAutomationOutboundPayload(outbound.payload)) return;

    if (outbound.category === "follow_up") {
      const followUpId = parseFollowUpDedupeKey(outbound.dedupeKey);
      if (!followUpId) return;
      await db
        .update(followUps)
        .set({ status: "cancelled", updatedAt: cancelledAt })
        .where(
          and(
            eq(followUps.id, followUpId),
            eq(followUps.clinicId, outbound.clinicId),
            eq(followUps.leadId, outbound.payload.leadId),
          ),
        );
    }
  },
};

function parseFollowUpDedupeKey(dedupeKey: string | null): string | null {
  const prefix = "followup:";
  return dedupeKey?.startsWith(prefix) ? dedupeKey.slice(prefix.length) : null;
}

function getObsoleteAutomationReason(
  category: string,
  context: OutboundSafetyContext,
): "automation_obsolete" | null {
  if (category !== "follow_up") return null;
  if (context.lead?.status && ["appointment_scheduled", "lost", "won"].includes(context.lead.status)) {
    return "automation_obsolete";
  }
  if (context.conversation?.aiPaused) return "automation_obsolete";
  if (context.lastMessage && context.lastMessage.author !== "agent") return "automation_obsolete";
  return null;
}

function isCompleteAutomationContext(
  context: OutboundSafetyContext | null,
): context is OutboundSafetyContext {
  return Boolean(context?.clinic && context.lead && context.conversation && context.agentMessage);
}

function automationDestinationMatchesLead(
  to: string,
  lead: OutboundSafetyContext["lead"],
): boolean {
  if (!lead) return false;
  const trimmed = to.trim();
  if (lead.whatsappLid && trimmed === lead.whatsappLid) return true;
  if (lead.phone && trimmed === lead.phone) return true;
  return areEquivalentWhatsAppPhones(trimmed, lead.phone);
}

function getOutboundMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).outboundMessageId;
  return typeof value === "string" && value ? value : null;
}

async function deliverOutboundPayload(input: {
  payload: OutboundPayload;
  clinicId: string;
  conversationId: string;
}): Promise<string | null> {
  if (isConversationOutboundPayload(input.payload)) {
    return deliverConversationOutbound({
      payload: input.payload,
      clinicId: input.clinicId,
      conversationId: input.conversationId,
    });
  }
  if (isAutomationOutboundPayload(input.payload)) {
    return deliverAutomationOutbound({
      payload: input.payload,
      clinicId: input.clinicId,
      conversationId: input.conversationId,
    });
  }
  throw new Error("Unsupported outbound payload");
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

  // Shadow mode: já compôs a resposta e avançou o pipeline normalmente — aqui
  // só suprimimos o envio real (Z-API/TTS), persistindo tudo como "simulated".
  if (clinic.shadowModeEnabled) {
    return deliverShadowOutbound(input);
  }

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

async function deliverAutomationOutbound(input: {
  payload: AutomationOutboundPayload;
  clinicId: string;
  conversationId: string;
}): Promise<string | null> {
  const [clinic] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.clinicId))
    .limit(1);
  if (!clinic) throw new Error(`Clinic not found for outbound delivery: ${input.clinicId}`);

  if (clinic.shadowModeEnabled) {
    await db
      .update(messages)
      .set({ simulated: true, deliveryFormat: "text" })
      .where(
        and(
          eq(messages.id, input.payload.agentMessageId),
          eq(messages.conversationId, input.conversationId),
        ),
      );
    return null;
  }

  const config = resolveChannelConfig(clinic);
  const result = await sendVoiceOrText(
    input.payload.to,
    input.payload.text,
    config,
    input.payload.useVoice ?? false,
    input.payload.ttsConfig,
    input.clinicId,
  );
  await db
    .update(messages)
    .set({
      body: input.payload.text,
      sentAt: new Date(),
      ...(result.msgId ? { externalId: result.msgId } : {}),
      deliveryFormat: result.deliveryFormat,
      ...(result.blobUrl ? { mediaUrl: result.blobUrl, mediaType: "audio" } : {}),
    })
    .where(
      and(
        eq(messages.id, input.payload.agentMessageId),
        eq(messages.conversationId, input.conversationId),
      ),
    );

  // Anexos (régua de pós-atendimento): enviados após o texto, em ordem. Cada um
  // vira uma mensagem própria no inbox. Falha de mídia não derruba o texto já
  // entregue — apenas loga (comportamento do fluxo de conversa).
  const mediaParts = input.payload.mediaParts ?? [];
  if (mediaParts.length > 0) {
    const conversationRepository = new DrizzleConversationRepository();
    const mediaLog = createLogger({
      scope: "SenderWorker",
      correlationId: input.payload.agentMessageId,
      clinicId: input.clinicId,
      conversationId: input.conversationId,
    });
    for (const part of mediaParts) {
      if (part.type !== "media") continue;
      try {
        const mediaMsgId = await sendMediaMessage(
          input.payload.to,
          part.url,
          part.mediaType,
          config,
          part.caption,
        );
        await conversationRepository.appendMessage({
          id: randomUUID(),
          conversationId: input.conversationId,
          author: "agent",
          body: part.title,
          mediaUrl: part.url,
          mediaType: part.mediaType,
          sentAt: new Date(),
          externalId: mediaMsgId,
          intent: null,
          deliveryFormat: "text",
        });
      } catch (err) {
        mediaLog.error("falha ao enviar mídia da automação — segue", err, {
          mediaId: part.mediaId,
          title: part.title,
        });
      }
    }
  }

  return result.msgId;
}

/**
 * Shadow mode: persiste a resposta composta e avança o pipeline exatamente
 * como o fluxo real (deliverConversationOutbound), mas nunca chama Z-API/TTS.
 * Mensagens ficam marcadas simulated=true, externalId=null — a inbox exibe
 * um badge para deixar claro que nada chegou ao lead de verdade.
 */
async function deliverShadowOutbound(input: {
  payload: ConversationOutboundPayload;
  clinicId: string;
  conversationId: string;
}): Promise<string | null> {
  const conversationRepository = new DrizzleConversationRepository();
  const log = createLogger({
    scope: "SenderWorker",
    correlationId: input.payload.agentMessageId,
    clinicId: input.clinicId,
    conversationId: input.conversationId,
  });
  log.info("shadow_mode.delivery_suppressed", { intent: input.payload.intent });

  await db
    .update(messages)
    .set({ simulated: true, deliveryFormat: "text" })
    .where(eq(messages.id, input.payload.agentMessageId));

  const allParts = [...input.payload.interleavedParts, ...input.payload.mediaParts];
  for (const part of allParts) {
    if (part.type === "text") {
      await conversationRepository.appendMessage({
        id: randomUUID(),
        conversationId: input.conversationId,
        author: "agent",
        body: part.content,
        mediaUrl: null,
        mediaType: null,
        sentAt: new Date(),
        externalId: null,
        intent: input.payload.intent,
        deliveryFormat: "text",
        simulated: true,
      });
    } else {
      await conversationRepository.appendMessage({
        id: randomUUID(),
        conversationId: input.conversationId,
        author: "agent",
        body: part.title,
        mediaUrl: part.url,
        mediaType: part.mediaType,
        sentAt: new Date(),
        externalId: null,
        intent: input.payload.intent,
        deliveryFormat: "text",
        simulated: true,
      });
    }
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

  return null;
}
