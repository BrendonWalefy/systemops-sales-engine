import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { InternalLabAutomationPolicyReader } from "@/application/automation/internal-lab-automation-policy-reader";
import { LiveTurnLifecycle } from "@/application/conversation/live-turn-lifecycle";
import type { InternalLabAuthorizationBindings } from "@/application/conversation-v2/internal-lab-authorization";
import { parseAndRegisterDeployedInternalLabApproval } from "@/application/conversation-v2/internal-lab-approval";
import {
  createShadowTurnCaptureRegistry,
  runConversationV2ShadowBatch,
  type SenderDrainAttempted,
  type ShadowBatchSummary,
  type ShadowBatchTurn,
  type ShadowEvaluation,
  type ShadowEvaluator,
} from "@/application/conversation-v2/run-shadow-batch";
import { TenantEngineRouter, V2ShadowSelectionRegistry } from "@/application/conversation-v2/tenant-engine-router";
import { V1ObservationCollector } from "@/application/conversation-v2/v1-observation-collector";
import { V2LiveConversationHandler } from "@/application/conversation-v2/v2-live-conversation-handler";
import { V2ShadowRunner } from "@/application/conversation-v2/v2-shadow-runner";
import { resolveInternalLabLiveTurnConfiguration } from "@/application/conversation-v2/internal-lab-live-turn-configuration";
import type { InternalLabRuntimeBindingsReader } from "@/application/conversation-v2/internal-lab-runtime-bindings";
import {
  createInternalLabDeliveryGuard as createBoundInternalLabDeliveryGuard,
  type InternalLabDeliveryGuard,
} from "@/application/conversation-v2/internal-lab-delivery-guard";
import { createConfiguredCycleIRuntimeBuildIdentity } from "@/application/conversation-v2/configured-cycle-i-authority";
import type { CapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import type { ConversationEnginePolicyReader } from "@/application/ports/conversation-engine-policy-reader";
import type { ConversationHandler } from "@/application/ports/conversation-handler";
import type { ConversationV2ComparisonSink } from "@/application/ports/conversation-v2-comparison-sink";
import type { JobQueue } from "@/application/ports/job-queue";
import type { OutboundMessageStore } from "@/application/ports/outbound-message-store";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { ClinicAutomationPolicyReader } from "@/application/ports/clinic-automation-policy-reader";
import type { InternalLabEligibilityReader } from "@/application/ports/internal-lab-eligibility-reader";
import type { DecisionTraceSink } from "@/core/observability/DecisionTrace";
import type { V1TurnObservationSink } from "@/core/observability/V1TurnObservation";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { ConversationTurnCoordinator } from "@/core/pipeline/ConversationTurnCoordinator";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { BookingService } from "@/core/scheduling/BookingService";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { DentalUnderstandingProvider } from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";
import { OpenAIDentalUnderstandingModel } from "@/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel";
import { createLiveDentalUnderstanding } from "@/infrastructure/adapters/ai/live-dental-understanding";
import { createLiveResponseVerbalizer } from "@/infrastructure/adapters/ai/live-response-verbalizer";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import {
  loadConfiguredInternalLabAuthority,
  loadConfiguredInternalLabDeploymentIdentity,
} from "@/infrastructure/conversation-v2/configured-internal-lab-authority";
import { DrizzleInternalLabRuntimeBindingsReader } from "@/infrastructure/conversation-v2/drizzle-internal-lab-runtime-bindings-reader";
import { createRuntimeDecisionTraceSink } from "@/infrastructure/observability/runtime-decision-trace";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleClinicAutomationPolicyReader } from "@/infrastructure/repositories/drizzle-clinic-automation-policy-reader";
import { DrizzleConversationEnginePolicyReader } from "@/infrastructure/repositories/drizzle-conversation-engine-policy-reader";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleConversationTurnLeaseStore } from "@/infrastructure/repositories/drizzle-conversation-turn-lease-store";
import { DrizzleConversationV2ComparisonSink } from "@/infrastructure/repositories/drizzle-conversation-v2-comparison-sink";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleLiveConversationContextReader } from "@/infrastructure/repositories/drizzle-live-conversation-context-reader";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { persistStopContactDecision } from "@/infrastructure/repositories/drizzle-stop-contact-persistence";
import { resolveClinicVoiceConfig } from "@/lib/tts-send";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
const style = Object.freeze({ tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" } as const);

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function allowedModels(env: RuntimeEnvironment, modelId: string): readonly string[] {
  return Object.freeze([...new Set([
    modelId, "gpt-4o-mini", "gpt-5.5", "deterministic-safety", "deterministic-fallback",
    env.OPENAI_COMPOSER_MODEL, env.OPENAI_COMPOSER_MODEL_DEFAULT,
    env.OPENAI_COMPOSER_MODEL_START, env.OPENAI_COMPOSER_MODEL_GROWTH,
    env.OPENAI_COMPOSER_MODEL_SCALE, env.OPENAI_COMPOSER_MODEL_ENTERPRISE,
    env.OPENAI_COMPOSER_MODEL_PREMIUM,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim()))]);
}

function createEvaluator(input: { env: RuntimeEnvironment; hmacKey: string; modelId: string }): ShadowEvaluator {
  const apiKey = input.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) return Object.freeze({ async evaluate() {
    return Object.freeze({ result: Object.freeze({ status: "error" as const, errorName: "MissingOpenAIKey" }), understandingRequest: null, model: null });
  } });
  const provider = new DentalUnderstandingProvider(new OpenAIDentalUnderstandingModel(new OpenAI({ apiKey }), input.modelId));
  return Object.freeze({
    async evaluate(reads: CapturedV2TurnReads, signal: AbortSignal): Promise<ShadowEvaluation> {
      if (reads.catalog.status !== "captured") return Object.freeze({
        result: Object.freeze({ status: "unsupported" as const, reason: "shared_read_unavailable" as const }), understandingRequest: null, model: null,
      });
      let understandingRequest: ShadowEvaluation["understandingRequest"] = null;
      let providerCalled = false;
      const startedAt = Date.now();
      const runner = new V2ShadowRunner({ hmacKey: input.hmacKey, style, understand: async (captured) => {
        providerCalled = true;
        const understanding = await provider.understand({
          leadMessage: captured.leadMessage, history: captured.history, state: captured.state,
          catalog: reads.catalog.status === "captured" ? reads.catalog.value.map((service) => ({ id: service.id, displayName: service.name, aliases: [] })) : [],
        }, { signal });
        understandingRequest = understanding.request;
        return understanding;
      } });
      const result = await runner.run(reads, { signal });
      return Object.freeze({ result, understandingRequest, model: providerCalled ? Object.freeze({
        modelId: input.modelId, calls: 1, inputTokens: null, outputTokens: null,
        latencyMs: Math.max(0, Date.now() - startedAt), estimatedCostMinor: null,
      }) : null });
    },
  });
}

function closedAuthorizationBindings(env: RuntimeEnvironment): InternalLabAuthorizationBindings {
  const closed = {
    approval: null,
    runtimeIdentity: null,
    expectedClinicId: env.SYSTEMOPS_LAB_CLINIC_ID?.trim() || "internal_lab_unconfigured",
    expectedTenantDigest: env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST?.trim() || "unconfigured",
    expectedChannelDigest: env.CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST?.trim() || "unconfigured",
    expectedConfigDigest: env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST?.trim() || "unconfigured",
    now: () => new Date(),
  } satisfies InternalLabAuthorizationBindings;
  if (env !== process.env) return Object.freeze(closed);
  try {
    const runtimeIdentity = createConfiguredCycleIRuntimeBuildIdentity();
    const approval = parseAndRegisterDeployedInternalLabApproval({
      serializedApproval: env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON ?? "",
      authority: loadConfiguredInternalLabAuthority(), runtimeIdentity,
      deploymentIdentity: loadConfiguredInternalLabDeploymentIdentity(),
      expectedTenantDigest: closed.expectedTenantDigest,
      expectedChannelDigest: closed.expectedChannelDigest,
      expectedConfigDigest: closed.expectedConfigDigest,
      expectedClinicId: closed.expectedClinicId,
      now: new Date(),
    });
    return Object.freeze({ ...closed, approval, runtimeIdentity });
  } catch { return Object.freeze(closed); }
}

function createLiveHandler(input: {
  apiKey: string;
  expectedClinicId: string;
  decisionTraceSink: DecisionTraceSink;
  jobQueue: JobQueue;
  outboundMessageStore: OutboundMessageStore;
  runtimeBindingsReader: InternalLabRuntimeBindingsReader;
}): ConversationHandler {
  const conversationRepository = new DrizzleConversationRepository();
  const leadRepository = new DrizzleLeadRepository();
  const appointmentRepository = new DrizzleAppointmentRepository();
  const followUps = new DrizzleFollowUpRepository();
  const state = new ConversationStateMachine();
  const reservations = new SlotReservationService();
  const contextReader = new DrizzleLiveConversationContextReader();
  const lifecycle = new LiveTurnLifecycle({
    registerIncomingMessage: new RegisterIncomingMessage({
      leadRepository, conversationRepository,
      usageCostTracker: new DefaultUsageCostTracker({ usageCostRepository: new DrizzleUsageCostRepository(), idGenerator: randomUUID, now: () => new Date() }),
      followUpRepository: followUps, idGenerator: randomUUID, now: () => new Date(),
    }),
    conversationRepository, contextReader,
    turnCoordinator: new ConversationTurnCoordinator(new DrizzleConversationTurnLeaseStore()),
    stateReader: state, now: () => new Date(),
  });
  const gatewayFor = async (clinicId: string) => {
    if (clinicId !== input.expectedClinicId) throw new Error("Internal Lab calendar tenant mismatch");
    const clinic = await contextReader.findOrganization(clinicId);
    if (!clinic) throw new Error("Internal Lab calendar unavailable");
    return resolveCalendarGateway({
      clinicId, calendarMode: clinic.calendarMode, googleCalendarId: clinic.googleCalendarId,
      timezone: new ClinicTimezone(clinic.timezone), businessHours: clinic.businessHours,
      postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes,
    });
  };
  const calendar: CalendarGateway = {
    async listAvailableSlots(value) {
      return (await gatewayFor(value.clinicId)).listAvailableSlots(value);
    },
    async createAppointment(value) {
      return (await gatewayFor(value.clinicId)).createAppointment(value);
    },
    async isSlotFree(value) {
      return (await gatewayFor(value.clinicId)).isSlotFree(value);
    },
    async listBlockEvents(value) {
      return (await gatewayFor(value.clinicId)).listBlockEvents(value);
    },
    async createBlockEvent(value) {
      return (await gatewayFor(value.clinicId)).createBlockEvent(value);
    },
    async cancelAppointment(value) {
      return (await gatewayFor(input.expectedClinicId)).cancelAppointment(value);
    },
    async deleteBlockEvent(value) {
      return (await gatewayFor(input.expectedClinicId)).deleteBlockEvent(value);
    },
    async updateBlockEvent(value) {
      return (await gatewayFor(input.expectedClinicId)).updateBlockEvent(value);
    },
    async updateCalendarEvent(value) {
      return (await gatewayFor(input.expectedClinicId)).updateCalendarEvent(value);
    },
  };
  const booking = new BookingService(calendar, appointmentRepository, leadRepository, reservations, followUps);
  const client = new OpenAI({ apiKey: input.apiKey });
  return new V2LiveConversationHandler({
    lifecycle,
    understanding: createLiveDentalUnderstanding(client),
    verbalizer: createLiveResponseVerbalizer(client),
    dental: { treatments: new DrizzleTreatmentRepository(), calendar, state, appointments: appointmentRepository, reservations, booking },
    resolveTurnConfiguration: (configurationInput) =>
      resolveInternalLabLiveTurnConfiguration(configurationInput, {
        resolveVoice: resolveClinicVoiceConfig,
        resumeExpiredTakeover: (conversationId) =>
          conversationRepository.setTakeover(conversationId, null),
        resolveDeliveryBinding: (clinicId) =>
          input.runtimeBindingsReader.resolve(clinicId),
      }),
    outbound: { outboundMessageStore: input.outboundMessageStore, jobQueue: input.jobQueue },
    persistStopContact: persistStopContactDecision,
    decisionTraceSink: input.decisionTraceSink,
  });
}

export type ConversationV2Runtime = Readonly<{
  conversationHandler: TenantEngineRouter;
  automationPolicy: InternalLabAutomationPolicyReader;
  decisionTraceSink: DecisionTraceSink;
  createTurnObservationSink(binding: Readonly<{ turnId: string; clinicId: string; automationMode: "live" }>): V1TurnObservationSink;
  drainCapturedTurns(): readonly ShadowBatchTurn[];
  runSelectedShadowTurns(input: Readonly<{ senderBarrier: SenderDrainAttempted; turns: readonly ShadowBatchTurn[] }>): Promise<ShadowBatchSummary>;
  runtimeIdentity: InternalLabAuthorizationBindings["runtimeIdentity"];
  internalLabDeliveryGuard: InternalLabDeliveryGuard;
  policyReader: ConversationEnginePolicyReader;
  sink: ConversationV2ComparisonSink;
  evaluator: ShadowEvaluator;
  recordConfig: Parameters<typeof runConversationV2ShadowBatch>[0]["recordConfig"];
  maxTurns: number;
  deadlineMs: number;
  now(): number;
}>;

export function createConversationV2Runtime(input: {
  env?: RuntimeEnvironment; collector?: V1ObservationCollector;
  policyReader?: ConversationEnginePolicyReader; comparisonSink?: ConversationV2ComparisonSink;
  decisionTraceSink?: DecisionTraceSink; v1Handler?: ConversationHandler; v2Handler?: ConversationHandler;
  authorizationBindings?: InternalLabAuthorizationBindings;
  runtimeBindingsReader?: InternalLabRuntimeBindingsReader;
  eligibilityReader?: ClinicAutomationPolicyReader & InternalLabEligibilityReader;
  jobQueue?: JobQueue;
  outboundMessageStore?: OutboundMessageStore;
} = {}): ConversationV2Runtime {
  const env = input.env ?? process.env;
  const hmacKey = env.CONVERSATION_V2_COMPARISON_HMAC_KEY?.trim() ?? "";
  const commit = env.VERCEL_GIT_COMMIT_SHA?.trim() || env.GIT_COMMIT_SHA?.trim() || "missing_commit";
  const modelId = env.OPENAI_V2_UNDERSTANDING_MODEL?.trim() || "gpt-4o-mini";
  const modelAllowlist = allowedModels(env, modelId);
  const collector = input.collector ?? new V1ObservationCollector();
  const captureRegistry = createShadowTurnCaptureRegistry();
  const shadowSelections = new V2ShadowSelectionRegistry();
  const policyReader = input.policyReader ?? new DrizzleConversationEnginePolicyReader();
  const comparisonSink = input.comparisonSink ?? new DrizzleConversationV2ComparisonSink({ allowedModelIds: modelAllowlist });
  const decisionTraceSink = input.decisionTraceSink ?? createRuntimeDecisionTraceSink();
  const authorization = input.authorizationBindings ?? closedAuthorizationBindings(env);
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const liveProviderReady = apiKey.length > 0;
  const eligibilityReader = input.eligibilityReader
    ?? new DrizzleClinicAutomationPolicyReader();
  const runtimeBindingsReader = input.runtimeBindingsReader
    ?? new DrizzleInternalLabRuntimeBindingsReader();
  const jobQueue = input.jobQueue ?? new DrizzleJobQueue();
  const outboundMessageStore = input.outboundMessageStore ?? new DrizzleOutboundMessageStore();
  const conversationHandler = new TenantEngineRouter({
    v1Handler: input.v1Handler ?? new ConversationOrchestrator({ decisionTraceSink }),
    v2Handler: input.v2Handler ?? (liveProviderReady ? createLiveHandler({
      apiKey,
      expectedClinicId: authorization.expectedClinicId,
      decisionTraceSink,
      jobQueue,
      outboundMessageStore,
      runtimeBindingsReader,
    }) : Object.freeze({
      async handle() { throw new Error("V2 live understanding provider unavailable"); },
    })),
    policyReader, eligibilityReader, runtimeBindingsReader, liveProviderReady,
    shadowSelections, decisionTraceSink, ...authorization,
  });
  const automationPolicy = new InternalLabAutomationPolicyReader({
    basePolicyReader: eligibilityReader,
    eligibilityReader,
    runtimeBindingsReader,
    ...authorization,
  });
  const internalLabDeliveryGuard = createBoundInternalLabDeliveryGuard({
    authorization,
    runtimeBindingsReader,
  });
  const evaluator = createEvaluator({ env, hmacKey, modelId });
  const recordConfig = Object.freeze({ hmacKey, commit, datasetDigest: null, allowedModelIds: modelAllowlist });
  const maxTurns = positiveInteger(env.CONVERSATION_V2_SHADOW_MAX_TURNS, 10);
  const deadlineMs = positiveInteger(env.CONVERSATION_V2_SHADOW_DEADLINE_MS, 20_000);
  const now = () => Date.now();
  return Object.freeze({
    conversationHandler, automationPolicy, internalLabDeliveryGuard,
    decisionTraceSink, runtimeIdentity: authorization.runtimeIdentity,
    policyReader, sink: comparisonSink, evaluator, recordConfig, maxTurns, deadlineMs, now,
    createTurnObservationSink(binding) {
      captureRegistry.bindTurn(binding);
      return Object.freeze({ record(event) { collector.record(event); if (event.kind === "turn_terminal") collector.complete(event.turnId); } });
    },
    drainCapturedTurns() {
      const promoted: ShadowBatchTurn[] = [];
      for (const turn of collector.drain()) { try { promoted.push(captureRegistry.promote(turn)); } catch { /* best-effort */ } }
      return Object.freeze(promoted);
    },
    runSelectedShadowTurns({ senderBarrier, turns }) {
      return runConversationV2ShadowBatch({
        senderBarrier, turns, selectedTurns: shadowSelections.consumeAll(), evaluator,
        sink: comparisonSink, maxTurns, deadlineMs, now, recordConfig,
      });
    },
  });
}

export function createInternalLabDeliveryGuard(
  env: RuntimeEnvironment = process.env,
): InternalLabDeliveryGuard {
  return createBoundInternalLabDeliveryGuard({
    authorization: closedAuthorizationBindings(env),
    runtimeBindingsReader: new DrizzleInternalLabRuntimeBindingsReader(),
  });
}
