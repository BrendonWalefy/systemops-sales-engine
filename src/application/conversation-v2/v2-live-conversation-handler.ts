import { createHash } from "node:crypto";
import type {
  LiveTurnContext,
  LiveTurnLifecycle,
  LiveTurnSnapshot,
} from "@/application/conversation/live-turn-lifecycle";
import { createDentalLiveAdapters, type DentalLiveAdapterDependencies } from "@/application/conversation-v2/dental-live-adapters";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { authorizationForConversationReply } from "@/application/jobs/outbound-authorization";
import type { JobQueue } from "@/application/ports/job-queue";
import type { OutboundMessageStore } from "@/application/ports/outbound-message-store";
import {
  captureAiContractRejectionBestEffort,
  type AiContractRejectionCaptureResult,
  type AiContractRejectionRecorder,
  type AiContractRejectionStage,
} from "@/application/ports/ai-contract-rejection-recorder";
import type {
  ConversationHandler,
  ConversationHandleInput,
  ConversationHandleResult,
} from "@/application/ports/conversation-handler";
import type { ConversationState } from "@/conversation-core/capability/contract";
import type { ComposerStyle } from "@/conversation-core/composer/contract";
import type { ResponseConversationBrief } from "@/conversation-core/composer/response-conversation-brief";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import type { SpeakerProfile, VerbalizationOutcome } from "@/conversation-core/composer/verbalization";
import type { ActionResult } from "@/conversation-core/decision";
import type { TurnGateInput } from "@/conversation-core/gate";
import { completeTurnPipeline, prepareTurnPipeline } from "@/conversation-core/turn-pipeline";
import { resolveStopContactDecision, type StopContactDecision } from "@/application/channel-safety/stop-contact-policy";
import { takeRecentConversationHistory } from "@/core/intelligence/ConversationHistoryWindow";
import {
  recordDecisionTrace,
  type DecisionTraceSink,
} from "@/core/observability/DecisionTrace";
import type { TtsConfig } from "@/domain/entities/tts-config";
import type { Treatment } from "@/domain/entities/treatment";
import type { Professional } from "@/domain/entities/professional";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { V2ConversationHandoffReason } from "@/application/conversation-v2/v2-conversation-handoff";
import { V2TerminalHandoffRequiredError } from "@/application/conversation-v2/v2-terminal-failure-policy";
import {
  createDentalPack,
  DENTAL_OUTCOME_SCHEMA,
  type DentalPolicy,
} from "@/domain-packs/dental";
import { buildDentalResponseConversationBrief } from "@/domain-packs/dental/response-conversation-brief";
import { dentalEffectDecisionIdentity } from "@/application/conversation-v2/dental-intended-effects";
import { classifyUnderstandingFailure } from "@/application/conversation-v2/understanding-failure-code";
import { resolveDentalStructuredMediaUnderstanding } from "@/application/conversation-v2/dental-structured-media-understanding";
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
}>;

type DynamicDentalDependencies =
  | "clinic"
  | "editorial"
  | "lead"
  | "leadId"
  | "conversation"
  | "conversationId"
  | "turnId"
  | "now"
  | "effectLifecycle";

type StaticDentalDependencies = Omit<
  DentalLiveAdapterDependencies,
  DynamicDentalDependencies | "calendar" | "booking"
> & Readonly<{
  professionals: Pick<ProfessionalRepository, "listByClinic">;
  resolveTenantScheduling(claimedClinicId: string): Pick<
    DentalLiveAdapterDependencies,
    "calendar" | "booking"
  >;
  journeyResources?: Omit<
    NonNullable<DentalLiveAdapterDependencies["journey"]>,
    "inboundMessage" | "history"
  >;
}>;

export type V2LiveConversationHandlerDependencies = Readonly<{
  lifecycle: Pick<LiveTurnLifecycle, "begin" | "loadSnapshot" | "complete" | "fail">;
  understanding: LiveDentalUnderstanding;
  /**
   * Ausente, a resposta sai com a frase determinística do plano. Presente, o
   * modelo reescreve essa mesma frase e o validador decide se ela pode sair.
   */
  verbalizer?: LiveResponseVerbalizer;
  dental: StaticDentalDependencies;
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
  aiContractRejectionRecorder?: AiContractRejectionRecorder;
  persistStopContact(input: Readonly<{
    leadId: string;
    conversationId: string;
    clinicId: string;
    sourceInboundEventId: string;
    decision: StopContactDecision;
  }>): Promise<void>;
  persistHandoff(input: Readonly<{
    clinicId: string;
    conversationId: string;
    reason: V2ConversationHandoffReason;
    now: Date;
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

export class V2TreatmentTenantScopeError extends Error {
  readonly code = "v2_treatment_tenant_scope_mismatch";

  constructor() {
    super("V2 treatment tenant scope mismatch");
    this.name = "V2TreatmentTenantScopeError";
  }
}

function scopedTreatments(
  treatments: readonly Treatment[],
  clinicId: string,
): readonly Treatment[] {
  if (treatments.some((treatment) => treatment.clinicId !== clinicId)) {
    throw new V2TreatmentTenantScopeError();
  }
  return Object.freeze([...treatments]);
}

function scopedActiveProfessionals(
  professionals: readonly Professional[],
  clinicId: string,
): readonly Professional[] {
  if (professionals.some((professional) => professional.clinicId !== clinicId)) {
    throw new V2TreatmentTenantScopeError();
  }
  return Object.freeze(professionals.filter((professional) => professional.isActive));
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
 * casos; `verbalizationViolations` distingue recusa (com os códigos) de falha
 * do provedor (vazio).
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
    let handoffReason: V2ConversationHandoffReason | null = null;
    let handoffPersisted = false;
    let understandingRejection: Readonly<{
      stage: AiContractRejectionStage;
      codes: string;
      capture: AiContractRejectionCaptureResult;
    }> | null = null;
    let verbalizationRejection: Readonly<{
      codes: string;
      capture: AiContractRejectionCaptureResult;
    }> | null = null;
    let responseConversationBrief: ResponseConversationBrief | null = null;
    let understandingCalls = 0;

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
      const professionals = scopedActiveProfessionals(
        await this.deps.dental.professionals.listByClinic(context.clinicId),
        context.clinicId,
      );
      const scheduling = this.deps.dental.resolveTenantScheduling(context.clinicId);
      const adapters = createDentalLiveAdapters({
        ...this.deps.dental,
        ...scheduling,
        professionals: {
          async listByClinic(claimedClinicId: string) {
            if (claimedClinicId !== context.clinicId) {
              throw new V2TreatmentTenantScopeError();
            }
            return [...professionals];
          },
        },
        clinic: context.clinic,
        editorial: context.editorial,
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
        journey: this.deps.dental.journeyResources
          ? {
              ...this.deps.dental.journeyResources,
              inboundMessage: {
                id: context.inboundMessage.id,
                mediaType: context.inboundMessage.mediaType,
              },
              history: snapshot.history,
            }
          : undefined,
      });
      const pack = createDentalPack(adapters);

      const understandingStartedAt = performance.now();
      let understandingResolved = false;
      let understandingModelId: string = modelId;
      phase = "understanding";
      const preparation = await prepareTurnPipeline({
        gateInput: configuration.gateInput,
        state,
        policy: configuration.policy,
        now: new Date(turnNow.getTime()),
        understand: async () => {
          try {
            const structured = resolveDentalStructuredMediaUnderstanding({
              mediaType: context.inboundMessage.mediaType,
              state: snapshot.currentState,
            });
            if (structured) understandingModelId = "deterministic-media.v1";
            const result = structured ?? await (() => {
              understandingCalls += 1;
              return this.deps.understanding.understand({
                leadMessage: context.inboundMessage.body,
                history: historyForUnderstanding(context, snapshot),
                state,
                catalog: treatments.map((treatment) => ({
                  id: treatment.id,
                  displayName: treatment.name,
                  aliases: Object.freeze([...treatment.aliases]),
                })),
                faqCatalog: Object.freeze(
                  (context.editorial?.faqs ?? []).slice(0, 20).map((faq) => faq.question),
                ),
                objectionCatalog: Object.freeze(
                  (context.editorial?.objections ?? []).slice(0, 20).map(({ objection }) => objection),
                ),
                professionalCatalog: Object.freeze(
                  professionals.slice(0, 20).map((professional) => professional.name),
                ),
              }, {
                onContractRejection: async (rejection) => {
                const authoritativeTurnId = context.inboundAuthority?.inboundEventId;
                const capture = authoritativeTurnId
                  ? await captureAiContractRejectionBestEffort(
                      this.deps.aiContractRejectionRecorder,
                      {
                        organizationId: context.clinicId,
                        conversationId: context.conversationId,
                        inboundEventId: authoritativeTurnId,
                        turnId: authoritativeTurnId,
                        stage: rejection.stage,
                        modelId: rejection.modelId,
                        promptVersion: rejection.promptVersion,
                        contractVersion: rejection.contractVersion,
                        attempt: 1,
                        rawOutput: rejection.rawOutput,
                        issues: rejection.issues,
                        occurredAt: new Date(turnNow!.getTime()),
                      },
                    )
                  : { status: "persistence_failed" as const };
                understandingRejection = Object.freeze({
                  stage: rejection.stage,
                  codes: [...new Set(rejection.issues.map((issue) => issue.code))]
                    .sort()
                    .join(","),
                  capture,
                });
                },
              });
            })();
            understandingResolved = true;
            responseConversationBrief = buildDentalResponseConversationBrief(result);
            if (typeof result.signals.objection === "string" && result.signals.objection.trim()) {
              handoffReason = "v2_objection_requires_human";
            } else if (result.safety.emergency === true || result.safety.requestsHuman === true) {
              handoffReason = "v2_explicit_human_request";
            }
            if (result.safety.optOut === true) {
              const decision = resolveStopContactDecision({
                classifiedIntent: "stop_contact",
                messageText: input.messageText,
                now: new Date(turnNow!.getTime()),
              });
              if (decision) {
                const sourceInboundEventId = context.inboundAuthority?.inboundEventId;
                if (!sourceInboundEventId) {
                  throw new Error("V2 stop-contact requires exact inbound authority");
                }
                effectAttempted = true;
                phase = "action";
                await this.deps.persistStopContact({
                  leadId: context.leadId,
                  conversationId: context.conversationId,
                  clinicId: context.clinicId,
                  sourceInboundEventId,
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
                  authorization: authorizationForConversationReply(context.inboundAuthority),
                  dedupeKey: `conversation-reply:${context.turnId}`,
                  payload: {
                    version: 1,
                    kind: "conversation_reply",
                    turnId: context.turnId,
                    to: context.outboundAddress,
                    agentMessageId: deterministicUuid(`conversation-v2-agent:${context.turnId}`),
                    replyText: decision.confirmationText,
                    intent: "stop_contact",
                    useVoice: false,
                    ttsConfig: configuration.ttsConfig,
                    interleavedParts: [],
                    mediaParts: [],
                    leadId: context.leadId,
                    pipelineAdvance: null,
                  },
                }, this.deps.outbound);
                stopContactConfirmationEnqueued = true;
                phase = "understanding";
              }
            }
            await trace("v2.understanding", {
              status: "completed",
              durationMs: Math.max(0, Math.round(performance.now() - understandingStartedAt)),
              modelId: understandingModelId,
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
                ...(understandingRejection
                  ? {
                      rejectionStage: understandingRejection.stage,
                      rejectionCodes: understandingRejection.codes,
                      evidenceCaptureStatus: understandingRejection.capture.status,
                      ...(understandingRejection.capture.evidenceRef
                        ? { evidenceRef: understandingRejection.capture.evidenceRef }
                        : {}),
                    }
                  : {}),
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
          if (actionResults.some(
            ({ type }) => type === "appointment_reschedule_compensation_failed",
          )) {
            handoffReason = "v2_reschedule_compensation_requires_human";
          }
          const completedEffectCount = actionResults.filter(
            ({ semanticClass }) => semanticClass === "effect_completed",
          ).length;
          const persistedOfferCount = actionResults.filter(
            ({ type }) =>
              type === "slots_found" || type === "appointment_reschedule_offered",
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
            promptVersion: validation.verbalization.status === "accepted"
              ? this.deps.verbalizer!.promptVersion
              : "deterministic-renderer.v1",
            verbalizationViolations: validation.verbalization.status === "rejected"
              ? validation.verbalization.violations.join(",")
              : "",
            responseStrategy: validation.verbalization.status === "absent"
              ? "deterministic_only"
              : "hybrid_contextual_v1",
            understandingCalls,
            verbalizationCalls: validation.verbalization.status === "absent" ? 0 : 1,
            ...(verbalizationRejection
              ? {
                  rejectionStage: "response_verbalization",
                  rejectionCodes: verbalizationRejection.codes,
                  evidenceCaptureStatus: verbalizationRejection.capture.status,
                  ...(verbalizationRejection.capture.evidenceRef
                    ? { evidenceRef: verbalizationRejection.capture.evidenceRef }
                    : {}),
                }
              : {}),
            latencyMs: validation.latencyMs,
          });
          if (validation.source === "fallback") {
            await trace("response.fallback_applied", {
              action: "v2_response",
              fallbackReason: "safe_fallback",
              requiresHandoff: validation.requiresHandoff,
            });
          }
          if (validation.requiresHandoff && !handoffPersisted) {
            effectAttempted = true;
            await this.deps.persistHandoff({
              clinicId: context.clinicId,
              conversationId: context.conversationId,
              reason: handoffReason ?? "v2_explicit_human_request",
              now: new Date(turnNow!.getTime()),
            });
            handoffPersisted = true;
            effectCompleted = true;
          }
        },
        response: {
          style: configuration.style,
          composer: new DeterministicResponseComposer(),
          verbalization: this.deps.verbalizer && responseConversationBrief
            ? {
                verbalizer: this.deps.verbalizer,
                speaker: configuration.speaker,
                conversationBrief: responseConversationBrief,
                onRejection: async (rejection) => {
                  const authoritativeTurnId = context.inboundAuthority?.inboundEventId;
                  const capture = authoritativeTurnId
                    ? await captureAiContractRejectionBestEffort(
                        this.deps.aiContractRejectionRecorder,
                        {
                          organizationId: context.clinicId,
                          conversationId: context.conversationId,
                          inboundEventId: authoritativeTurnId,
                          turnId: authoritativeTurnId,
                          stage: "response_verbalization",
                          modelId: rejection.modelId,
                          promptVersion: this.deps.verbalizer!.promptVersion,
                          contractVersion: "response-verbalization.v1",
                          attempt: 1,
                          rawOutput: rejection.rawOutput,
                          issues: rejection.violations.map((code) => ({ path: [], code })),
                          occurredAt: new Date(turnNow!.getTime()),
                        },
                      )
                    : { status: "persistence_failed" as const };
                  verbalizationRejection = Object.freeze({
                    codes: rejection.violations.join(","),
                    capture,
                  });
                },
              }
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
        authorization: authorizationForConversationReply(context.inboundAuthority),
        dedupeKey: `conversation-reply:${context.turnId}`,
        payload: {
          version: 1,
          kind: "conversation_reply",
          turnId: context.turnId,
          to: context.outboundAddress,
          agentMessageId: deterministicUuid(`conversation-v2-agent:${context.turnId}`),
          replyText: completed.response.text,
          intent: null,
          useVoice: configuration.useVoice,
          ttsConfig: configuration.ttsConfig,
          interleavedParts: [],
          mediaParts: [],
          leadId: context.leadId,
          pipelineAdvance: null,
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
      if (reason === "outbox_failed" && effectAttempted && !handoffPersisted) {
        try {
          await this.deps.persistHandoff({
            clinicId: context.clinicId,
            conversationId: context.conversationId,
            reason: "v2_effect_outbox_failure_requires_human",
            now: new Date((turnNow ?? this.deps.now?.() ?? new Date()).getTime()),
          });
          handoffPersisted = true;
        } catch {
          if (!terminalHandled) {
            terminalHandled = true;
            try {
              await this.deps.lifecycle.fail({ context, error });
            } catch {
              // The closed job marker remains the retry authority. A secondary
              // lifecycle failure must not reopen model/effect execution.
            }
          }
          throw new V2TerminalHandoffRequiredError("effect_outbox_failed");
        }
      }
      if (!terminalHandled) {
        terminalHandled = true;
        await this.deps.lifecycle.fail({ context, error });
      }
      if (reason === "outbox_failed" && !handoffPersisted) throw error;
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
        authorization: authorizationForConversationReply(context.inboundAuthority),
        dedupeKey: `conversation-reply:${context.turnId}`,
        payload: {
          version: 1,
          kind: "conversation_reply",
          turnId: context.turnId,
          to: context.outboundAddress,
          agentMessageId: deterministicUuid(`conversation-v2-agent:${context.turnId}`),
          replyText: V2_SAFE_FAILURE_REPLY_TEXT,
          intent: "safe_failure",
          useVoice: false,
          ttsConfig: configuration.ttsConfig,
          interleavedParts: [],
          mediaParts: [],
          leadId: context.leadId,
          pipelineAdvance: null,
        },
      }, this.deps.outbound);
      return true;
    } catch {
      return false;
    }
  }
}
