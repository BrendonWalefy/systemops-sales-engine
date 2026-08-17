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
  isOperatorOutboundPayload,
  isOutboundPayload,
  type AutomationOutboundPayload,
  type ConversationOutboundPayload,
  type OperatorOutboundPayload,
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
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { Message } from "@/domain/entities/conversation";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { areEquivalentWhatsAppPhones } from "@/core/whatsapp/WhatsAppContactIdentity";
import { createLogger } from "@/infrastructure/logging/logger";
import {
  recordDecisionTrace,
  type DecisionTraceSink,
} from "@/core/observability/DecisionTrace";
import { db } from "@/infrastructure/db/client";
import { organizations, messages, followUps, leads, conversations } from "@/infrastructure/db/schema";
import { DrizzleOutboundSafetyContextReader } from "@/infrastructure/repositories/drizzle-outbound-safety-context-reader";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";
import {
  consumeInternalLabDeliveryAuthorization,
  type InternalLabDeliveryAuthorization,
  type InternalLabDeliveryGuard,
} from "@/application/conversation-v2/internal-lab-delivery-guard";
import type { ChannelConfigSnapshot } from "@/application/ports/channel-config-snapshot";

export type SendMessageJobDependencies = {
  outboundMessageStore: OutboundMessageStore;
  conversationRepository?: Pick<ConversationRepository, "appendMessage" | "findMessageById">;
  safetyContextReader?: OutboundSafetyContextReader;
  automationDispatchLifecycle?: AutomationDispatchLifecycle;
  now?: () => Date;
  capJitterMs?: () => number;
  decisionTraceSink?: DecisionTraceSink;
  conversationStateReader?: Pick<ConversationStateMachine, "getCurrentState">;
  outboundBoundary?: Partial<OutboundDeliveryBoundary>;
  delivery?: (input: {
    payload: OutboundPayload;
    clinicId: string;
    conversationId: string;
    internalLabDeliveryAuthorization?: InternalLabDeliveryAuthorization;
  }) => Promise<string | null>;
  internalLabDeliveryGuard?: InternalLabDeliveryGuard;
};

export type OutboundDeliveryBoundary = {
  /** Somente replay E2E em banco isolado: executa o sender real contra adapters de captura. */
  sandboxCaptureEnabled: boolean;
  sendVoiceOrText: typeof sendVoiceOrText;
  sendMediaMessage: typeof sendMediaMessage;
  createDeliveryService: () => OutboundDeliveryService;
  recordSuppressedDelivery: (input: {
    category: "conversation_reply" | "automation";
    to: string;
    content: string;
    intent: string | null;
    reason: "shadow_mode";
  }) => void | Promise<void>;
};

const DEFAULT_OUTBOUND_BOUNDARY: OutboundDeliveryBoundary = {
  sandboxCaptureEnabled: false,
  sendVoiceOrText,
  sendMediaMessage,
  createDeliveryService: () => new OutboundDeliveryService(),
  recordSuppressedDelivery: () => {},
};

export const SHADOW_DELIVERY_SUPPRESSED = "__shadow_delivery_suppressed__";

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
  private readonly conversationStateReader: Pick<
    ConversationStateMachine,
    "getCurrentState"
  >;
  private readonly conversationRepository: Pick<
    ConversationRepository,
    "appendMessage" | "findMessageById"
  >;

  constructor(private readonly deps: SendMessageJobDependencies) {
    const outboundBoundary = {
      ...DEFAULT_OUTBOUND_BOUNDARY,
      ...deps.outboundBoundary,
    };
    this.delivery =
      deps.delivery ??
      ((input) => deliverOutboundPayload(input, outboundBoundary));
    this.safetyContextReader = deps.safetyContextReader ?? new DrizzleOutboundSafetyContextReader();
    this.automationDispatchLifecycle = deps.automationDispatchLifecycle ?? drizzleAutomationDispatchLifecycle;
    this.now = deps.now ?? (() => new Date());
    this.capJitterMs = deps.capJitterMs ?? (() => Math.floor(Math.random() * 30 * 60_000));
    this.conversationStateReader =
      deps.conversationStateReader ?? new ConversationStateMachine();
    this.conversationRepository =
      deps.conversationRepository ?? new DrizzleConversationRepository();
  }

  async processJob(job: { id?: string; payload: unknown }): Promise<SendMessageJobProcessResult> {
    const outboundMessageId = getOutboundMessageId(job.payload);
    if (!outboundMessageId) throw new Error("message.send job has no outboundMessageId");
    const jobTurnId = getTurnId(job.payload);

    const log = createLogger({
      scope: "SendMessageJob",
      jobId: job.id,
      queue: "message.send",
      traceId: jobTurnId ?? outboundMessageId,
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
    const turnId = jobTurnId ?? getTurnId(outbound.payload);
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
    let internalLabDeliveryAuthorization: InternalLabDeliveryAuthorization | undefined;
    if (
      isConversationOutboundPayload(outbound.payload)
      && outbound.payload.agentMessagePersistence === "sender"
    ) {
      internalLabDeliveryAuthorization = await this.deps.internalLabDeliveryGuard?.authorize({
        clinicId: outbound.clinicId,
        binding: outbound.payload.internalLabBinding,
      }) ?? undefined;
      if (!internalLabDeliveryAuthorization) {
        await this.deps.outboundMessageStore.markOutboundCancelled(
          outbound.id,
          "internal_lab_binding_drift",
        );
        outboundLog.warn("job.ignored", {
          reason: "internal_lab_binding_drift",
          durationMs: Date.now() - startedAt,
        });
        return "ignored";
      }
    }

    if (isConversationOutboundPayload(outbound.payload)) {
      const placeholder = {
        id: outbound.payload.agentMessageId,
        conversationId: outbound.conversationId,
        author: "agent",
        body: outbound.payload.replyText,
        mediaUrl: null,
        mediaType: null,
        sentAt: this.now(),
        externalId: null,
        intent: outbound.payload.intent,
        deliveryFormat: null,
      } as const;
      if (outbound.payload.agentMessagePersistence === "sender") {
        const inserted = await this.conversationRepository.appendMessage(placeholder);
        if (!inserted) {
          const existing = await this.conversationRepository.findMessageById(placeholder.id);
          if (!isExactConversationAgentMessage(existing, placeholder)) {
            throw new Error("sender-owned agent message is missing or mismatched");
          }
        }
      } else {
        const existing = await this.conversationRepository.findMessageById(placeholder.id);
        const existedBeforeOutbox = existing !== null &&
          existing.sentAt.getTime() <= outbound.createdAt.getTime();
        if (!existedBeforeOutbox || !isExactConversationAgentMessage(existing, placeholder)) {
          await this.deps.outboundMessageStore.markOutboundCancelled(
            outbound.id,
            "conversation_agent_message_missing",
          );
          outboundLog.warn("job.ignored", {
            reason: "conversation_agent_message_missing",
            durationMs: Date.now() - startedAt,
          });
          return "ignored";
        }
      }
    }

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
      if (!isAutomationOutboundPayload(outbound.payload)) {
        await this.deps.outboundMessageStore.markOutboundCancelled(
          outbound.id,
          "invalid_automation_context",
        );
        outboundLog.warn("job.ignored", {
          reason: "invalid_automation_context",
          durationMs: Date.now() - startedAt,
        });
        return "ignored";
      }
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

    if (turnId) {
      await recordDecisionTrace(this.deps.decisionTraceSink, {
        turnId,
        stage: "delivery.started",
        occurredAt: this.now().toISOString(),
        clinicId: outbound.clinicId,
        conversationId: outbound.conversationId,
        metadata: {
          outboundMessageId: outbound.id,
          attempt: outbound.attempts,
          category: outbound.category,
        },
      });
    }
    let providerMessageId: string | null;
    try {
      providerMessageId = await this.delivery({
        payload: outbound.payload,
        clinicId: outbound.clinicId,
        conversationId: outbound.conversationId,
        internalLabDeliveryAuthorization,
      });
    } catch (error) {
      if (turnId) {
        await recordDecisionTrace(this.deps.decisionTraceSink, {
          turnId,
          stage: "turn.failed",
          occurredAt: this.now().toISOString(),
          clinicId: outbound.clinicId,
          conversationId: outbound.conversationId,
          metadata: {
            phase: "delivery",
            errorName: error instanceof Error ? error.name : "unknown",
          },
        });
      }
      throw error;
    }
    if (providerMessageId === SHADOW_DELIVERY_SUPPRESSED) {
      await this.deps.outboundMessageStore.markOutboundCancelled(
        outbound.id,
        "shadow_mode",
      );
      outboundLog.info("job.ignored", {
        reason: "shadow_mode",
        durationMs: Date.now() - startedAt,
      });
      return "ignored";
    }
    if (turnId && isConversationOutboundPayload(outbound.payload)) {
      const stateAfterDelivery =
        await this.conversationStateReader.getCurrentState(
          outbound.conversationId,
        );
      await recordDecisionTrace(this.deps.decisionTraceSink, {
        turnId,
        stage: "state.after_delivery",
        occurredAt: this.now().toISOString(),
        clinicId: outbound.clinicId,
        conversationId: outbound.conversationId,
        metadata: {
          state: stateAfterDelivery?.state ?? "none",
          pipelineAdvanceApplied:
            outbound.payload.pipelineAdvance?.action ?? "none",
        },
      });
    }
    await this.deps.outboundMessageStore.markOutboundDelivered({
      id: outbound.id,
      providerMessageId,
    });
    await this.automationDispatchLifecycle.markDelivered(outboundForLifecycle, this.now());
    if (turnId) {
      await recordDecisionTrace(this.deps.decisionTraceSink, {
        turnId,
        stage: "delivery.sent",
        occurredAt: this.now().toISOString(),
        clinicId: outbound.clinicId,
        conversationId: outbound.conversationId,
        metadata: {
          outboundMessageId: outbound.id,
          providerAccepted: providerMessageId !== null,
        },
      });
    }
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
      bumpInboxVersion(outbound.clinicId);
    }
    if (outbound.category === "recovery" && outbound.dedupeKey?.startsWith("manual-recovery:")) {
      await db
        .update(conversations)
        .set({ aiPaused: false, takeoverExpiresAt: null, updatedAt: deliveredAt })
        .where(and(
          eq(conversations.id, outbound.payload.conversationId),
          eq(conversations.clinicId, outbound.clinicId),
        ));
      bumpInboxVersion(outbound.clinicId);
      await db
        .insert(followUps)
        .values({
          clinicId: outbound.clinicId,
          leadId: outbound.payload.leadId,
          dueAt: deliveredAt,
          status: "done",
          reason: "recovery_campaign",
          completedAt: deliveredAt,
          updatedAt: deliveredAt,
        })
        .onConflictDoNothing({
          target: [followUps.clinicId, followUps.leadId, followUps.reason, followUps.dueAt],
        });
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

export function getObsoleteAutomationReason(
  category: string,
  context: OutboundSafetyContext,
): "automation_obsolete" | null {
  // Campanha de reativação (ADR-009) tem regra própria, e ela é diferente da do
  // follow-up em dois pontos que importam:
  //  - "lost" NÃO a torna obsoleta: quem não fechou é exatamente o público.
  //  - A última mensagem ser do lead também não: o normal é o lead ter dito
  //    "tá caro" e a conversa ter parado ali. Aplicar a regra do follow-up aqui
  //    cancelaria quase toda campanha.
  // O que a torna obsoleta é o mundo ter mudado desde a montagem: a pessoa
  // agendou/fechou, ou um humano assumiu a conversa.
  if (category === "campaign") {
    if (context.lead?.status && ["appointment_scheduled", "won"].includes(context.lead.status)) {
      return "automation_obsolete";
    }
    if (context.conversation?.aiPaused) return "automation_obsolete";
    return null;
  }

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

function isExactConversationAgentMessage(
  existing: Message | null | undefined,
  expected: Readonly<Pick<
    Message,
    | "id"
    | "conversationId"
    | "author"
    | "body"
    | "intent"
    | "deliveryFormat"
    | "externalId"
    | "mediaUrl"
    | "mediaType"
  >>,
): existing is Message {
  return existing != null &&
    existing.id === expected.id &&
    existing.conversationId === expected.conversationId &&
    existing.author === expected.author &&
    existing.body === expected.body &&
    (existing.intent ?? null) === (expected.intent ?? null) &&
    (existing.deliveryFormat ?? null) === (expected.deliveryFormat ?? null) &&
    (existing.externalId ?? null) === (expected.externalId ?? null) &&
    (existing.mediaUrl ?? null) === (expected.mediaUrl ?? null) &&
    (existing.mediaType ?? null) === (expected.mediaType ?? null);
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

function getTurnId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).turnId;
  return typeof value === "string" && value ? value : null;
}

async function deliverOutboundPayload(input: {
  payload: OutboundPayload;
  clinicId: string;
  conversationId: string;
  internalLabDeliveryAuthorization?: InternalLabDeliveryAuthorization;
}, boundary: OutboundDeliveryBoundary): Promise<string | null> {
  if (isConversationOutboundPayload(input.payload)) {
    return deliverConversationOutbound({
      payload: input.payload,
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      internalLabDeliveryAuthorization: input.internalLabDeliveryAuthorization,
    }, boundary);
  }
  if (isAutomationOutboundPayload(input.payload)) {
    return deliverAutomationOutbound({
      payload: input.payload,
      clinicId: input.clinicId,
      conversationId: input.conversationId,
    }, boundary);
  }
  if (isOperatorOutboundPayload(input.payload)) {
    return deliverOperatorOutbound({
      payload: input.payload,
      clinicId: input.clinicId,
      conversationId: input.conversationId,
    }, boundary);
  }
  throw new Error("Unsupported outbound payload");
}

export async function deliverOperatorOutbound(input: {
  payload: OperatorOutboundPayload;
  clinicId: string;
  conversationId: string;
}, boundary: OutboundDeliveryBoundary): Promise<string | null> {
  const [clinic] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.clinicId))
    .limit(1);
  if (!clinic) throw new Error(`Clinic not found for outbound delivery: ${input.clinicId}`);

  // Shadow mode restringe automação; uma ação humana explícita no inbox continua
  // sendo entregue, preservando o comportamento operacional anterior.
  const config = resolveChannelConfig(clinic);
  let providerMessageId: string | null;
  let deliveryFormat: "text" | "audio" = "text";
  if (input.payload.attachment) {
    providerMessageId = await boundary.sendMediaMessage(
      input.payload.to,
      input.payload.attachment.url,
      input.payload.attachment.mediaType,
      config,
      input.payload.text || undefined,
      input.payload.attachment.fileName,
    );
  } else {
    const result = await boundary.sendVoiceOrText(
      input.payload.to,
      input.payload.text,
      config,
      false,
    );
    providerMessageId = result.msgId;
    deliveryFormat = result.deliveryFormat;
  }

  await db
    .update(messages)
    .set({
      ...(providerMessageId ? { externalId: providerMessageId } : {}),
      deliveryFormat,
    })
    .where(and(
      eq(messages.id, input.payload.operatorMessageId),
      eq(messages.conversationId, input.conversationId),
    ));
  return providerMessageId;
}

async function deliverConversationOutbound(input: {
  payload: ConversationOutboundPayload;
  clinicId: string;
  conversationId: string;
  internalLabDeliveryAuthorization?: InternalLabDeliveryAuthorization;
}, boundary: OutboundDeliveryBoundary): Promise<string | null> {
  const authorizedChannelConfig = input.payload.agentMessagePersistence === "sender"
    ? consumeInternalLabDeliveryAuthorization(input.internalLabDeliveryAuthorization)
    : null;
  if (input.payload.agentMessagePersistence === "sender" && !authorizedChannelConfig) {
    throw new Error("invalid or consumed Internal Lab delivery authorization");
  }
  const [clinic] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.clinicId))
    .limit(1);
  if (!clinic) throw new Error(`Clinic not found for outbound delivery: ${input.clinicId}`);

  // Compatibilidade para uma outbox que tenha sido criada antes de a clínica
  // entrar em observação. Replay sandbox usa adapters de captura e pode seguir.
  if (clinic.shadowModeEnabled && !boundary.sandboxCaptureEnabled) {
    return deliverShadowOutbound(input, boundary);
  }

  const config: ChannelConfigSnapshot = authorizedChannelConfig ?? resolveChannelConfig(clinic);
  const conversationRepository = new DrizzleConversationRepository();
  const appointmentRepository = new DrizzleAppointmentRepository();
  const followUpRepository = new DrizzleFollowUpRepository();
  const delivery = boundary.createDeliveryService();
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
        const result = await boundary.sendVoiceOrText(
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
    const result = await boundary.sendVoiceOrText(
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
        {
          treatmentId: input.payload.pipelineAdvance.expectedTreatmentId,
          stepIndex: input.payload.pipelineAdvance.expectedStepIndex,
        },
      );
    } else {
      await stateMachine.exitTreatmentPipeline(input.conversationId, {
        treatmentId: input.payload.pipelineAdvance.expectedTreatmentId,
        stepIndex: input.payload.pipelineAdvance.expectedStepIndex,
      });
    }
  }

  return firstProviderMessageId;
}

async function deliverAutomationOutbound(input: {
  payload: AutomationOutboundPayload;
  clinicId: string;
  conversationId: string;
}, boundary: OutboundDeliveryBoundary): Promise<string | null> {
  const [clinic] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.clinicId))
    .limit(1);
  if (!clinic) throw new Error(`Clinic not found for outbound delivery: ${input.clinicId}`);

  if (clinic.shadowModeEnabled && !boundary.sandboxCaptureEnabled) {
    await boundary.recordSuppressedDelivery({
      category: "automation",
      to: input.payload.to,
      content: input.payload.text,
      intent: null,
      reason: "shadow_mode",
    });
    await db
      .update(messages)
      .set({ simulated: true, deliveryFormat: "text" })
      .where(
        and(
          eq(messages.id, input.payload.agentMessageId),
          eq(messages.conversationId, input.conversationId),
        ),
      );
    return SHADOW_DELIVERY_SUPPRESSED;
  }

  const config = resolveChannelConfig(clinic);
  const result = await boundary.sendVoiceOrText(
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
        const mediaMsgId = await boundary.sendMediaMessage(
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
 * Compatibilidade para outboxes shadow criadas antes do modo observation-only:
 * persiste a resposta composta, mas nunca chama Z-API/TTS nem aplica lifecycle.
 * Mensagens ficam marcadas simulated=true, externalId=null — a inbox exibe
 * um badge para deixar claro que nada chegou ao lead de verdade.
 */
async function deliverShadowOutbound(input: {
  payload: ConversationOutboundPayload;
  clinicId: string;
  conversationId: string;
}, boundary: OutboundDeliveryBoundary): Promise<string | null> {
  const conversationRepository = new DrizzleConversationRepository();
  const log = createLogger({
    scope: "SenderWorker",
    correlationId: input.payload.agentMessageId,
    clinicId: input.clinicId,
    conversationId: input.conversationId,
  });
  log.info("shadow_mode.delivery_suppressed", { intent: input.payload.intent });
  await boundary.recordSuppressedDelivery({
    category: "conversation_reply",
    to: input.payload.to,
    content: input.payload.replyText,
    intent: input.payload.intent,
    reason: "shadow_mode",
  });

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

  return SHADOW_DELIVERY_SUPPRESSED;
}
