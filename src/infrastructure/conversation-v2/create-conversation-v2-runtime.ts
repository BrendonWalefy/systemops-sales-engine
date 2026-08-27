import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { V2OnlyAutomationPolicy } from "@/application/automation/v2-only-automation-policy";
import { LiveTurnLifecycle } from "@/application/conversation/live-turn-lifecycle";
import { resolveV2LiveTurnConfiguration } from "@/application/conversation-v2/resolve-v2-live-turn-configuration";
import { V2LiveConversationHandler } from "@/application/conversation-v2/v2-live-conversation-handler";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type {
  ClinicAutomationFactsReader,
} from "@/application/ports/clinic-automation-policy-reader";
import type { ConversationAuthorityStore } from "@/application/ports/conversation-authority-store";
import type { ConversationHandler } from "@/application/ports/conversation-handler";
import type { ConversationRuntimeControlStore } from "@/application/ports/conversation-runtime-control-store";
import type { JobQueue } from "@/application/ports/job-queue";
import type { OutboundMessageStore } from "@/application/ports/outbound-message-store";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import type { DecisionTraceSink } from "@/core/observability/DecisionTrace";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { ConversationTurnCoordinator } from "@/core/pipeline/ConversationTurnCoordinator";
import { BookingService } from "@/core/scheduling/BookingService";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import { createLiveDentalUnderstanding } from "@/infrastructure/adapters/ai/live-dental-understanding";
import { createLiveResponseVerbalizer } from "@/infrastructure/adapters/ai/live-response-verbalizer";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { createRuntimeDecisionTraceSink } from "@/infrastructure/observability/runtime-decision-trace";
import { RuntimeAiContractRejectionRecorder } from "@/infrastructure/observability/runtime-ai-contract-rejection-recorder";
import { sealAiEvidence } from "@/infrastructure/crypto/ai-evidence-vault";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleAiContractRejectionStore } from "@/infrastructure/repositories/drizzle-ai-contract-rejection-store";
import { DrizzleClinicAutomationPolicyReader } from "@/infrastructure/repositories/drizzle-clinic-automation-policy-reader";
import { DrizzleConversationAuthorityStore } from "@/infrastructure/repositories/drizzle-conversation-authority-store";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleConversationRuntimeControlStore } from "@/infrastructure/repositories/drizzle-conversation-runtime-control-store";
import { DrizzleConversationTurnLeaseStore } from "@/infrastructure/repositories/drizzle-conversation-turn-lease-store";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleLiveConversationContextReader } from "@/infrastructure/repositories/drizzle-live-conversation-context-reader";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { DrizzleWhatsAppStreamAuthority } from "@/infrastructure/repositories/drizzle-whatsapp-stream-authority";
import { persistStopContactDecision } from "@/infrastructure/repositories/drizzle-stop-contact-persistence";
import { DrizzleV2ConversationHandoffStore } from "@/infrastructure/repositories/drizzle-v2-conversation-handoff-store";
import { requireV2ConversationHandoff } from "@/application/conversation-v2/v2-conversation-handoff";
import { resolveClinicVoiceConfig } from "@/lib/tts-send";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function isAiEvidenceCaptureEnabled(env: RuntimeEnvironment): boolean {
  const configured = env.AI_EVIDENCE_CAPTURE_ENABLED?.trim().toLowerCase();
  if (configured === undefined) return true;
  return configured === "true";
}

export class V2LiveProviderConfigurationError extends Error {
  readonly code = "v2_understanding_provider_unavailable";

  constructor() {
    super("V2 live understanding provider unavailable");
    this.name = "V2LiveProviderConfigurationError";
  }
}

export class V2CalendarTenantScopeError extends Error {
  readonly code = "v2_calendar_tenant_scope_mismatch";

  constructor() {
    super("V2 calendar tenant scope mismatch");
    this.name = "V2CalendarTenantScopeError";
  }
}

type TenantScopedCalendarGatewayDependencies = Readonly<{
  claimedClinicId: string;
  resolveGateway(clinicId: string): Promise<CalendarGateway>;
}>;

function requireScopedClinicId(actual: string, expected: string): void {
  if (actual !== expected) throw new V2CalendarTenantScopeError();
}

export function createTenantScopedCalendarGateway(
  deps: TenantScopedCalendarGatewayDependencies,
): CalendarGateway {
  const scopedInput = <T extends object>(input: T): void => {
    const requested = "clinicId" in input ? input.clinicId : deps.claimedClinicId;
    if (requested !== deps.claimedClinicId) throw new V2CalendarTenantScopeError();
  };
  const gateway = () => deps.resolveGateway(deps.claimedClinicId);
  return Object.freeze({
    async listAvailableSlots(input) {
      scopedInput(input);
      const slots = await (await gateway()).listAvailableSlots(input);
      for (const slot of slots) requireScopedClinicId(slot.clinicId, deps.claimedClinicId);
      return slots;
    },
    async createAppointment(input) {
      scopedInput(input);
      const appointment = await (await gateway())
        .createAppointment(input);
      requireScopedClinicId(appointment.clinicId, deps.claimedClinicId);
      return appointment;
    },
    async isSlotFree(input) {
      scopedInput(input);
      return (await gateway()).isSlotFree(input);
    },
    async listBlockEvents(input) {
      scopedInput(input);
      return (await gateway()).listBlockEvents(input);
    },
    async createBlockEvent(input) {
      scopedInput(input);
      return (await gateway()).createBlockEvent(input);
    },
    async cancelAppointment(input) {
      scopedInput(input);
      return (await gateway()).cancelAppointment(input);
    },
    async deleteBlockEvent(input) {
      scopedInput(input);
      return (await gateway()).deleteBlockEvent(input);
    },
    async updateBlockEvent(input) {
      scopedInput(input);
      return (await gateway()).updateBlockEvent(input);
    },
    async updateCalendarEvent(input) {
      scopedInput(input);
      return (await gateway()).updateCalendarEvent(input);
    },
  });
}

function createLiveHandler(input: {
  apiKey: string;
  aiEvidenceEncryptionKey?: string;
  aiEvidenceCaptureEnabled: boolean;
  decisionTraceSink: DecisionTraceSink;
  jobQueue: JobQueue;
  outboundMessageStore: OutboundMessageStore;
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
      leadRepository,
      conversationRepository,
      usageCostTracker: new DefaultUsageCostTracker({
        usageCostRepository: new DrizzleUsageCostRepository(),
        idGenerator: randomUUID,
        now: () => new Date(),
      }),
      followUpRepository: followUps,
      idGenerator: randomUUID,
      now: () => new Date(),
    }),
    conversationRepository,
    contextReader,
    turnCoordinator: new ConversationTurnCoordinator(
      new DrizzleConversationTurnLeaseStore(),
    ),
    stateReader: state,
    now: () => new Date(),
    streamAuthority: new DrizzleWhatsAppStreamAuthority(),
  });
  const resolveTenantScheduling = (claimedClinicId: string) => {
    const calendar = createTenantScopedCalendarGateway({
      claimedClinicId,
      async resolveGateway(clinicId) {
      const clinic = await contextReader.findOrganization(clinicId);
      if (!clinic || clinic.id !== clinicId) throw new V2CalendarTenantScopeError();
      return resolveCalendarGateway({
        clinicId,
        calendarMode: clinic.calendarMode,
        googleCalendarId: clinic.googleCalendarId,
        timezone: new ClinicTimezone(clinic.timezone),
        businessHours: clinic.businessHours,
        postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes,
      });
      },
    });
    return {
      calendar,
      booking: new BookingService(
        calendar,
        appointmentRepository,
        leadRepository,
        reservations,
        followUps,
      ),
    };
  };
  const client = new OpenAI({ apiKey: input.apiKey });
  const aiContractRejectionRecorder = input.aiEvidenceCaptureEnabled
    ? new RuntimeAiContractRejectionRecorder({
        store: new DrizzleAiContractRejectionStore(),
        seal(rawOutput, aad) {
          if (!input.aiEvidenceEncryptionKey) {
            throw new Error("AI evidence encryption key unavailable");
          }
          return sealAiEvidence(rawOutput, aad, input.aiEvidenceEncryptionKey);
        },
      })
    : undefined;

  return new V2LiveConversationHandler({
    lifecycle,
    understanding: createLiveDentalUnderstanding(client),
    verbalizer: createLiveResponseVerbalizer(client),
    dental: {
      treatments: new DrizzleTreatmentRepository(),
      state,
      appointments: appointmentRepository,
      reservations,
      resolveTenantScheduling,
    },
    resolveTurnConfiguration: (configurationInput) =>
      resolveV2LiveTurnConfiguration(configurationInput, {
        resolveVoice: resolveClinicVoiceConfig,
        resumeExpiredTakeover: (conversationId) =>
          conversationRepository.setTakeover(conversationId, null),
      }),
    outbound: {
      outboundMessageStore: input.outboundMessageStore,
      jobQueue: input.jobQueue,
    },
    persistStopContact: persistStopContactDecision,
    persistHandoff: (handoff) => requireV2ConversationHandoff(
      new DrizzleV2ConversationHandoffStore(),
      handoff,
    ),
    decisionTraceSink: input.decisionTraceSink,
    aiContractRejectionRecorder,
  });
}

export type ConversationV2Runtime = Readonly<{
  conversationHandler: ConversationHandler;
  automationPolicy: V2OnlyAutomationPolicy;
  decisionTraceSink: DecisionTraceSink;
}>;

export function createConversationV2Runtime(input: {
  env?: RuntimeEnvironment;
  decisionTraceSink?: DecisionTraceSink;
  v2Handler?: ConversationHandler;
  clinicFactsReader?: ClinicAutomationFactsReader;
  conversationAuthorityStore?: Pick<ConversationAuthorityStore, "getVersion">;
  conversationRuntimeControlStore?: Pick<ConversationRuntimeControlStore, "getGlobal">;
  jobQueue?: JobQueue;
  outboundMessageStore?: OutboundMessageStore;
} = {}): ConversationV2Runtime {
  const env = input.env ?? process.env;
  const decisionTraceSink = input.decisionTraceSink ?? createRuntimeDecisionTraceSink();
  const defaultClinicReader = new DrizzleClinicAutomationPolicyReader();
  const automationPolicy = new V2OnlyAutomationPolicy({
    clinicFactsReader: input.clinicFactsReader ?? defaultClinicReader,
    authorityStore: input.conversationAuthorityStore
      ?? new DrizzleConversationAuthorityStore(),
    runtimeControlStore: input.conversationRuntimeControlStore
      ?? new DrizzleConversationRuntimeControlStore(),
  });
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const conversationHandler = input.v2Handler
    ?? (apiKey
      ? createLiveHandler({
          apiKey,
          aiEvidenceEncryptionKey: env.AI_EVIDENCE_ENCRYPTION_KEY?.trim() || undefined,
          aiEvidenceCaptureEnabled: isAiEvidenceCaptureEnabled(env),
          decisionTraceSink,
          jobQueue: input.jobQueue ?? new DrizzleJobQueue(),
          outboundMessageStore: input.outboundMessageStore
            ?? new DrizzleOutboundMessageStore(),
        })
      : Object.freeze({
          async handle() { throw new V2LiveProviderConfigurationError(); },
        }));

  return Object.freeze({
    conversationHandler,
    automationPolicy,
    decisionTraceSink,
  });
}
