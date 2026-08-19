import { createHash } from "node:crypto";
import type {
  LiveTurnContext,
  LiveTurnLifecycle,
  LiveTurnSnapshot,
} from "@/application/conversation/live-turn-lifecycle";
import { createDentalLiveAdapters, type DentalLiveAdapterDependencies } from "@/application/conversation-v2/dental-live-adapters";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import type { JobQueue } from "@/application/ports/job-queue";
import type { OutboundMessageStore } from "@/application/ports/outbound-message-store";
import type {
  ConversationHandler,
  ConversationHandleInput,
  ConversationHandleResult,
} from "@/application/ports/conversation-handler";
import type { ConversationState } from "@/conversation-core/capability/contract";
import type { ComposerStyle } from "@/conversation-core/composer/contract";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import type { SpeakerProfile, VerbalizationOutcome } from "@/conversation-core/composer/verbalization";
import type { ActionResult } from "@/conversation-core/decision";
import type { TurnGateInput } from "@/conversation-core/gate";
import type { InternalLabDeliveryBinding } from "@/application/conversation-v2/internal-lab-delivery-guard";
import { completeTurnPipeline, prepareTurnPipeline } from "@/conversation-core/turn-pipeline";
import { resolveStopContactDecision, type StopContactDecision } from "@/application/channel-safety/stop-contact-policy";
import { takeRecentConversationHistory } from "@/core/intelligence/ConversationHistoryWindow";
import {
  recordDecisionTrace,
  type DecisionTraceSink,
} from "@/core/observability/DecisionTrace";
import type { TtsConfig } from "@/domain/entities/tts-config";
import type { Treatment } from "@/domain/entities/treatment";
import {
  createDentalPack,
  DENTAL_OUTCOME_SCHEMA,
  type DentalPolicy,
} from "@/domain-packs/dental";
import { dentalEffectDecisionIdentity } from "@/application/conversation-v2/dental-intended-effects";
import { classifyUnderstandingFailure } from "@/application/conversation-v2/understanding-failure-code";
import {
  V2_SAFE_FAILURE_REPLY_TEXT,
  shouldEnqueueSafeFailureReply,
} from "@/application/conversation-v2/v2-safe-failure-reply";
import {
  assertRegisteredLiveDentalUnderstanding,
  type LiveDentalUnderstanding,
} from "@/infrastructure/adapters/ai/live-dental-understanding";
import {
  assertRegisteredLiveResponseVerbalizer,
  type LiveResponseVerbalizer,
} from "@/infrastructure/adapters/ai/live-response-verbalizer";

export type V2SafeFailureReason =
  | "duplicate"
  | "conversation_busy"
  | "understanding_failed"
  | "decision_failed"
  | "action_failed"
  | "response_validation_failed"
  | "outbox_failed";

export type V2LiveTurnConfiguration = Readonly<{
  gateInput: TurnGateInput;
  policy: DentalPolicy;
  style: ComposerStyle;
  speaker: SpeakerProfile;
  useVoice: boolean;
  ttsConfig: TtsConfig;
  deliveryBinding: InternalLabDeliveryBinding;
}>;

type DynamicDentalDependencies =
  | "clinic"
  | "lead"
  | "leadId"
  | "conversation"
  | "conversationId"
  | "turnId"
  | "now"
  | "effectLifecycle";

export type V2LiveConversationHandlerDependencies = Readonly<{
  lifecycle: Pick<LiveTurnLifecycle, "begin" | "loadSnapshot" | "complete" | "fail">;
  understanding: LiveDentalUnderstanding;
  /**
   * Ausente, a resposta sai com a frase determinística do plano. Presente, o
   * modelo reescreve essa mesma frase e o validador decide se ela pode sair.
   */
  verbalizer?: LiveResponseVerbalizer;
  dental: Omit<DentalLiveAdapterDependencies, DynamicDentalDependencies>;
  resolveTurnConfiguration(input: Readonly<{
    context: LiveTurnContext;
    snapshot: LiveTurnSnapshot;
    turnInput: ConversationHandleInput;
    now: Date;
  }>): V2LiveTurnConfiguration | Promise<V2LiveTurnConfiguration>;
  outbound: Readonly<{
    outboundMessageStore: OutboundMessageStore;
    jobQueue: JobQueue;
  }>;
  decisionTraceSink?: DecisionTraceSink;
  persistStopContact(input: Readonly<{
    leadId: string;
    conversationId: string;
    clinicId: string;
    decision: StopContactDecision;
  }>): Promise<void>;
  now?: () => Date;
}>;

type FailurePhase = "understanding" | "decision" | "action" | "response" | "outbox";

function deterministicUuid(input: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(input).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function coreState(snapshot: LiveTurnSnapshot): ConversationState {
  return Object.freeze({
    phase: snapshot.currentState?.state ?? "idle",
    pendingStepId: snapshot.currentState?.id ?? null,
    completedStepIds: Object.freeze([]),
  });
}

function scopedTreatments(
  treatments: readonly Treatment[],
  clinicId: string,
): readonly Treatment[] {
  return Object.freeze(treatments.filter((treatment) => treatment.clinicId === clinicId));
}

function historyForUnderstanding(
  context: LiveTurnContext,
  snapshot: LiveTurnSnapshot,
): readonly { author: "lead" | "agent"; body: string }[] {
  const sinceReset = snapshot.lastResetBoundary
    ? snapshot.history.filter((message) => message.sentAt >= snapshot.lastResetBoundary!)
    : snapshot.history;
  return Object.freeze(
    takeRecentConversationHistory(
      sinceReset.filter((message) => message.id !== context.inboundMessageId),
      context.clinic.aiContextWindowMessages,
    ).map((message) => Object.freeze({
      author: message.author === "lead" ? "lead" as const : "agent" as const,
      body: message.body,
    })),
  );
}

/**
 * O trace declara quem escolheu as palavras entregues. Recusa e falha do modelo
 * caem no mesmo valor porque o texto entregue foi o determinístico nos dois
 * casos; o `violations` do estágio distingue o motivo.
 */
function verbalizationTraceModel(outcome: VerbalizationOutcome): string {
  if (outcome.status === "accepted") return outcome.modelId;
  if (outcome.status === "absent") return "deterministic-v2";
  return "deterministic-fallback";
}

function failureReason(phase: FailurePhase): V2SafeFailureReason {
  switch (phase) {
    case "understanding": return "understanding_failed";
    case "decision": return "decision_failed";
    case "action": return "action_failed";
    case "response": return "response_validation_failed";
    case "outbox": return "outbox_failed";
  }
}

export class V2LiveConversationHandler implements ConversationHandler {
  constructor(private readonly deps: V2LiveConversationHandlerDependencies) {}

  async handle(input: ConversationHandleInput): Promise<ConversationHandleResult> {
    const begun = await this.deps.lifecycle.begin(input);
    if (begun.outcome === "duplicate") {
      return { replied: false, reason: "duplicate" satisfies V2SafeFailureReason };
    }
    if (begun.outcome === "busy") {
      return { replied: false, reason: "conversation_busy" satisfies V2SafeFailureReason };
    }

    const context = begun.context;
    let phase: FailurePhase = "decision";
    let effectAttempted = false;
    let effectCompleted = false;
    let terminalHandled = false;
    let stopContactConfirmationEnqueued = false;
    let turnNow: Date | null = null;
    let deliveryConfiguration: Awaited<
      ReturnType<V2LiveConversationHandlerDependencies["resolveTurnConfiguration"]>
    > | null = null;

    const trace = async (
      stage: "v2.understanding" | "v2.decision" | "v2.action_result"
        | "response.plan_built" | "response.validated" | "response.fallback_applied"
        | "v2.outbox" | "turn.failed",
      metadata: Record<string, string | number | boolean | null>,
    ) => recordDecisionTrace(this.deps.decisionTraceSink, {
      turnId: context.turnId,
      clinicId: context.clinicId,
      conversationId: context.conversationId,
      stage,
      occurredAt: turnNow?.toISOString() ??
        (Number.isFinite(input.timestamp.getTime())
          ? input.timestamp.toISOString()
          : "1970-01-01T00:00:00.000Z"),
      metadata,
    });

    try {
      turnNow = new Date((this.deps.now?.() ?? new Date()).getTime());
      phase = "understanding";
      assertRegisteredLiveDentalUnderstanding(this.deps.understanding);
      if (this.deps.verbalizer) assertRegisteredLiveResponseVerbalizer(this.deps.verbalizer);
      const modelId = this.deps.understanding.modelId;
      phase = "decision";
      const snapshot = await this.deps.lifecycle.loadSnapshot(context);
      const configuration = await this.deps.resolveTurnConfiguration({
        context,
        snapshot,
        turnInput: input,
        now: new Date(turnNow.getTime()),
      });
      deliveryConfiguration = configuration;
      const state = coreState(snapshot);
      const treatments = scopedTreatments(
        await this.deps.dental.treatments.listByClinic(context.clinicId),
        context.clinicId,
      );
      const adapters = createDentalLiveAdapters({
        ...this.deps.dental,
        clinic: context.clinic,
        lead: context.lead,
        leadId: context.leadId,
        conversation: context.conversation,
        conversationId: context.conversationId,
        turnId: context.turnId,
        now: new Date(turnNow.getTime()),
        effectLifecycle: {
          attempted() { effectAttempted = true; },
          completed() { effectCompleted = true; },
        },
      });
      const pack = createDentalPack(adapters);

      const understandingStartedAt = performance.now();
      let understandingResolved = false;
      phase = "understanding";
      const preparation = await prepareTurnPipeline({
        gateInput: configuration.gateInput,
        state,
        policy: configuration.policy,
        now: new Date(turnNow.getTime()),
        understand: async () => {
          try {
            const result = await this.deps.understanding.understand({
              leadMessage: context.inboundMessage.body,
              history: historyForUnderstanding(context, snapshot),
              state,
              catalog: treatments.map((treatment) => ({
                id: treatment.id,
                displayName: treatment.name,
                aliases: Object.freeze([...treatment.aliases]),
              })),
            });
            understandingResolved = true;
            if (result.safety.optOut === true) {
              const decision = resolveStopContactDecision({
                classifiedIntent: "stop_contact",
                messageText: input.messageText,
                now: new Date(turnNow!.getTime()),
              });
              if (decision) {
                effectAttempted = true;
                phase = "action";
                await this.deps.persistStopContact({
                  leadId: context.leadId,
                  conversationId: context.conversationId,
                  clinicId: context.clinicId,
                  decision,
                });
                effectCompleted = true;
                phase = "outbox";
                await enqueueOutboundMessage({
                  clinicId: context.clinicId,
                  conversationId: context.conversationId,
                  channel: "whatsapp",
                  deliveryKind: "text",
                  category: "reply",
                  dedupeKey: `conversation-reply:${context.turnId}`,
                  payload: {
                    version: 1,
                    kind: "conversation_reply",
                    turnId: context.turnId,
                    to: context.outboundAddress,
                    agentMessageId: deterministicUuid(`conversation-v2-agent:${context.turnId}`),
                    agentMessagePersistence: "sender",
                    replyText: decision.confirmationText,
                    intent: "stop_contact",
                    useVoice: false,
                    ttsConfig: configuration.ttsConfig,
                    interleavedParts: [],
                    mediaParts: [],
                    leadId: context.leadId,
                    pipelineAdvance: null,
                    internalLabBinding: configuration.deliveryBinding,
                  },
                }, this.deps.outbound);
                stopContactConfirmationEnqueued = true;
                phase = "understanding";
              }
            }
            await trace("v2.understanding", {
              status: "completed",
              durationMs: Math.max(0, Math.round(performance.now() - understandingStartedAt)),
              modelId,
              request: result.request,
            });
            return result;
          } catch (error) {
            if (!understandingResolved) {
              await trace("v2.understanding", {
                status: "failed",
                durationMs: Math.max(0, Math.round(performance.now() - understandingStartedAt)),
                modelId,
                request: null,
                errorCode: classifyUnderstandingFailure(error),
              });
            }
            throw error;
          }
        },
        capabilities: pack.capabilities,
      }).catch((error) => {
        if (phase === "understanding") {
          phase = understandingResolved ? "decision" : "understanding";
        }
        throw error;
      });

      phase = "decision";
      const decisionCount = preparation.status === "prepared"
        ? preparation.prepared.decisions.length
        : 0;
      const executeCount = preparation.status === "prepared"
        ? preparation.prepared.decisions.filter(({ decision }) => decision.kind === "execute").length
        : 0;
      await trace("v2.decision", {
        status: preparation.status,
        durationMs: Math.max(0, Math.round(performance.now() - understandingStartedAt)),
        decisionCount,
        executeCount,
        capabilityIds: preparation.status === "prepared"
          ? preparation.prepared.capabilityIds.join(",")
          : "",
        decisionKinds: preparation.status === "prepared"
          ? preparation.prepared.decisions.map(({ decision }) => decision.kind).join(",")
          : "",
        intendedEffects: preparation.status === "prepared"
          ? preparation.prepared.decisions.map(({ capabilityId, decision }) =>
            dentalEffectDecisionIdentity({ capabilityId, decision })?.action ?? "none").join(",")
          : "",
      });
      if (preparation.status !== "prepared") {
        const reason = preparation.status === "suppressed"
          ? preparation.reason
          : "no_safe_response";
        terminalHandled = true;
        const replied = reason === "opted_out" && stopContactConfirmationEnqueued;
        await this.deps.lifecycle.complete({
          context,
          replied,
          reason,
        });
        return { replied, reason };
      }

      phase = "action";
      const actionStartedAt = performance.now();
      const completed = await completeTurnPipeline({
        prepared: preparation.prepared,
        outcomeSchema: DENTAL_OUTCOME_SCHEMA,
        onActionResults: async (
          actionResults: readonly ActionResult<typeof DENTAL_OUTCOME_SCHEMA>[],
        ) => {
          const completedEffectCount = actionResults.filter(
            ({ semanticClass }) => semanticClass === "effect_completed",
          ).length;
          const persistedOfferCount = actionResults.filter(
            ({ type }) => type === "slots_found",
          ).length;
          effectCompleted ||= completedEffectCount + persistedOfferCount > 0;
          const failedEffectCount = actionResults.filter(
            ({ semanticClass }) => semanticClass === "effect_failed",
          ).length;
          await trace("v2.action_result", {
            status: "completed",
            durationMs: Math.max(0, Math.round(performance.now() - actionStartedAt)),
            resultCount: actionResults.length,
            completedEffectCount: completedEffectCount + persistedOfferCount,
            failedEffectCount,
            outcomeTypes: actionResults.map(({ type }) => type).join(","),
            semanticClasses: actionResults.map(({ semanticClass }) => semanticClass).join(","),
          });
          phase = "response";
        },
        onResponseAudit: async ({ plan, validation }) => {
          await trace("response.plan_built", {
            action: "v2_response",
            planVersion: plan.version,
            outcomeRefs: plan.outcomeRefs.join(","),
            evidenceRefs: plan.evidenceRefs.join(","),
            outcomeCount: plan.outcomeCount,
            factCount: plan.factCount,
            optionCount: plan.optionCount,
            subjectCount: plan.subjectCount,
            evidenceCount: plan.evidenceCount,
            allowedPriceCount: plan.allowedFactKeys.filter((key) => key === "price_cents").length,
            allowedScheduleFactCount: plan.allowedFactKeys.filter((key) =>
              key === "slot_label" || key === "appointment_label").length,
            allowedMediaCount: 0,
          });
          await trace("response.validated", {
            action: "v2_response",
            valid: validation.valid,
            violationCount: validation.violations.length,
            violations: validation.violations.join(","),
            requiresHandoff: validation.requiresHandoff,
            source: validation.source,
            model: verbalizationTraceModel(validation.verbalization),
            promptVersion: this.deps.verbalizer?.promptVersion ?? "deterministic-renderer.v1",
            latencyMs: validation.latencyMs,
          });
          if (validation.source === "fallback") {
            await trace("response.fallback_applied", {
              action: "v2_response",
              fallbackReason: "safe_fallback",
              requiresHandoff: validation.requiresHandoff,
            });
          }
        },
        response: {
          style: configuration.style,
          composer: new DeterministicResponseComposer(),
          verbalization: this.deps.verbalizer
            ? { verbalizer: this.deps.verbalizer, speaker: configuration.speaker }
            : undefined,
        },
      });

      if (completed.status !== "delivered") {
        terminalHandled = true;
        await this.deps.lifecycle.complete({
          context,
          replied: false,
          reason: "response_validation_failed",
        });
        return { replied: false, reason: "response_validation_failed" };
      }

      phase = "outbox";
      const outboxStartedAt = performance.now();
      const enqueueResult = await enqueueOutboundMessage({
        clinicId: context.clinicId,
        conversationId: context.conversationId,
        channel: "whatsapp",
        deliveryKind: "text",
        category: "reply",
        dedupeKey: `conversation-reply:${context.turnId}`,
        payload: {
          version: 1,
          kind: "conversation_reply",
          turnId: context.turnId,
          to: context.outboundAddress,
          agentMessageId: deterministicUuid(`conversation-v2-agent:${context.turnId}`),
          agentMessagePersistence: "sender",
          replyText: completed.response.text,
          intent: null,
          useVoice: configuration.useVoice,
          ttsConfig: configuration.ttsConfig,
          interleavedParts: [],
          mediaParts: [],
          leadId: context.leadId,
          pipelineAdvance: null,
          internalLabBinding: configuration.deliveryBinding,
        },
      }, this.deps.outbound);
      await trace("v2.outbox", {
        status: "enqueued",
        durationMs: Math.max(0, Math.round(performance.now() - outboxStartedAt)),
        messageWasNew: enqueueResult.messageWasNew,
        jobWasNew: enqueueResult.jobWasNew,
      });
      terminalHandled = true;
      await this.deps.lifecycle.complete({ context, replied: true });
      return { replied: true };
    } catch (error) {
      const reason = failureReason(phase);
      const safeReplyEnqueued = await this.enqueueSafeFailureReply({
        reason,
        effectAttempted,
        replyAlreadyEnqueued: stopContactConfirmationEnqueued,
        configuration: deliveryConfiguration,
        context,
      });
      await trace("turn.failed", {
        phase,
        reason,
        effectAttempted,
        effectCompleted,
        safeReplyEnqueued,
      });
      if (!terminalHandled) {
        terminalHandled = true;
        await this.deps.lifecycle.fail({ context, error });
      }
      if (reason === "outbox_failed") throw error;
      return { replied: false, reason };
    } finally {
      await context.releaseLease();
    }
  }

  /**
   * Silêncio é o pior resultado possível para o lead: ele não sabe se a mensagem
   * chegou. Quando o turno morre antes de qualquer efeito, uma cópia determinística
   * confirma recebimento sem afirmar nada que o sistema não decidiu. A falha de
   * entrega desta cópia nunca substitui o erro original.
   */
  private async enqueueSafeFailureReply(input: Readonly<{
    reason: V2SafeFailureReason;
    effectAttempted: boolean;
    replyAlreadyEnqueued: boolean;
    configuration: Awaited<
      ReturnType<V2LiveConversationHandlerDependencies["resolveTurnConfiguration"]>
    > | null;
    context: LiveTurnContext;
  }>): Promise<boolean> {
    if (!shouldEnqueueSafeFailureReply({
      reason: input.reason,
      effectAttempted: input.effectAttempted,
      replyAlreadyEnqueued: input.replyAlreadyEnqueued,
      configurationResolved: input.configuration !== null,
    })) return false;
    const configuration = input.configuration!;
    const context = input.context;
    try {
      await enqueueOutboundMessage({
        clinicId: context.clinicId,
        conversationId: context.conversationId,
        channel: "whatsapp",
        deliveryKind: "text",
        category: "reply",
        dedupeKey: `conversation-reply:${context.turnId}`,
        payload: {
          version: 1,
          kind: "conversation_reply",
          turnId: context.turnId,
          to: context.outboundAddress,
          agentMessageId: deterministicUuid(`conversation-v2-agent:${context.turnId}`),
          agentMessagePersistence: "sender",
          replyText: V2_SAFE_FAILURE_REPLY_TEXT,
          intent: "safe_failure",
          useVoice: false,
          ttsConfig: configuration.ttsConfig,
          interleavedParts: [],
          mediaParts: [],
          leadId: context.leadId,
          pipelineAdvance: null,
          internalLabBinding: configuration.deliveryBinding,
        },
      }, this.deps.outbound);
      return true;
    } catch {
      return false;
    }
  }
}
