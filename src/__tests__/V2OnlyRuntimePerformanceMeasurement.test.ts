import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databaseMock = vi.hoisted(() => {
  let activeDb: unknown;
  const proxy = new Proxy({}, {
    get(_target, property) {
      if (!activeDb) throw new Error("runtime measurement database is not initialized");
      const value = (activeDb as Record<PropertyKey, unknown>)[property];
      return typeof value === "function" ? value.bind(activeDb) : value;
    },
  });
  return Object.freeze({ proxy, set(value: unknown) { activeDb = value; } });
});

const atomicBatchMock = vi.hoisted(() => {
  let activeBatch: { execute(steps: unknown): Promise<unknown> } | undefined;
  return Object.freeze({
    proxy: Object.freeze({
      execute(steps: unknown) {
        if (!activeBatch) throw new Error("runtime measurement atomic batch is not initialized");
        return activeBatch.execute(steps);
      },
    }),
    set(value: { execute(steps: unknown): Promise<unknown> }) { activeBatch = value; },
  });
});

const v1Model = vi.hoisted(() => {
  let caseId = "unset";
  let calls = 0;
  let tokens = 0;
  let classifiedIntent = "general_question";
  let classification: Record<string, unknown> = {};
  return {
    begin(nextCaseId: string, nextClassification: Record<string, unknown>) {
      caseId = nextCaseId;
      calls = 0;
      tokens = 0;
      classification = nextClassification;
      classifiedIntent = String(nextClassification.intent);
    },
    record(inputTokens: number, outputTokens: number) {
      calls += 1;
      tokens += inputTokens + outputTokens;
    },
    snapshot() { return Object.freeze({ calls, tokens, classifiedIntent }); },
    get caseId() { return caseId; },
    get classification() { return classification; },
  };
});

vi.mock("@/infrastructure/db/client", () => ({ db: databaseMock.proxy }));
vi.mock("@/infrastructure/db/atomic-database-batch", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/infrastructure/db/atomic-database-batch")>();
  return { ...original, neonHttpAtomicDatabaseBatch: atomicBatchMock.proxy };
});
vi.mock("openai", () => ({
  APIUserAbortError: class APIUserAbortError extends Error {},
  default: class DeterministicOpenAI {
    readonly chat = {
      completions: {
        create: async (input: unknown) => {
          const request = input as {
            response_format?: { json_schema?: { name?: string } };
          };
          const classifier = request.response_format?.json_schema?.name === "intent_classification";
          const inputTokens = 11 + v1Model.caseId.length % 5;
          const outputTokens = classifier ? 7 : 9;
          v1Model.record(inputTokens, outputTokens);
          return {
            choices: [{
              message: {
                content: classifier
                  ? JSON.stringify(v1Model.classification)
                  : "Posso ajudar com essa informação.",
              },
            }],
            usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
          };
        },
      },
    };
  },
}));

import { RegisterInboundHistory } from "@/application/conversation/register-inbound-history";
import { LiveTurnLifecycle } from "@/application/conversation/live-turn-lifecycle";
import { V2LiveConversationHandler } from "@/application/conversation-v2/v2-live-conversation-handler";
import type {
  RuntimeArmMetrics,
  RuntimePerformanceReport,
} from "@/application/conversation-v2/v2-runtime-performance";
import type { CorpusCase } from "@/application/corpus/corpus-case";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { drainMessageProcessQueue } from "@/application/jobs/drain-message-process-queue";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import type {
  ConversationHandleInput,
  ConversationHandleResult,
  ConversationHandler,
} from "@/application/ports/conversation-handler";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import type { ConversationStateType } from "@/core/conversation/ConversationStateMachine";
import type { IntentClassification, IntentType } from "@/core/intelligence/IntentClassifier";
import type { DecisionTraceRecord, DecisionTraceSink } from "@/core/observability/DecisionTrace";
import type { V1TurnObservationEvent } from "@/core/observability/V1TurnObservation";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { ConversationTurnCoordinator } from "@/core/pipeline/ConversationTurnCoordinator";
import { BookingService } from "@/core/scheduling/BookingService";
import { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import { runWithRuntimeClock } from "@/core/time/RuntimeClock";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import { createLiveDentalUnderstanding } from "@/infrastructure/adapters/ai/live-dental-understanding";
import { createLiveResponseVerbalizer } from "@/infrastructure/adapters/ai/live-response-verbalizer";
import { createEmbeddedAtomicDatabaseBatch } from "@/__tests__/helpers/embedded-authority-database";
import {
  cleanupEmbeddedAuthorityDatabase,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "@/__tests__/helpers/embedded-authority-database";
import {
  installRuntimePerformanceSqlRecorder,
  type SqlTurnMetrics,
} from "@/__tests__/helpers/runtime-performance-sql-recorder";
import {
  buildRuntimePerformancePopulation,
  RUNTIME_DRAIN_NOW_ISO,
  RUNTIME_FIXED_NOW_ISO,
  RUNTIME_POPULATION_DIGEST_SEMANTICS,
  type RuntimeFixtureInputs,
} from "@/__tests__/helpers/runtime-performance-population";
import * as schema from "@/infrastructure/db/schema";
import { organizations, treatments } from "@/infrastructure/db/schema";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleConversationTurnLeaseStore } from "@/infrastructure/repositories/drizzle-conversation-turn-lease-store";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleLiveConversationContextReader } from "@/infrastructure/repositories/drizzle-live-conversation-context-reader";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { DrizzleWhatsAppStreamAuthority } from "@/infrastructure/repositories/drizzle-whatsapp-stream-authority";
import { buildWhatsAppStreamAliases } from "@/core/whatsapp/WhatsAppContactIdentity";

type ArmName = RuntimeArmMetrics["arm"];
type TurnCardinality = Readonly<{
  events: number;
  processJobs: number;
  liveReplies: number;
  sendJobs: number;
  sentReplies: number;
}>;
type TurnSample = Readonly<{
  latencyMs: number;
  modelCalls: number;
  tokens: number;
  sql: SqlTurnMetrics;
  cardinality: TurnCardinality;
}>;
type SeededFixtureContext = Readonly<{
  conversationId: string;
  leadId: string;
  seededAppointmentId: string | null;
}>;

const FIXED_NOW = new Date(RUNTIME_FIXED_NOW_ISO);
const DRAIN_NOW = new Date(RUNTIME_DRAIN_NOW_ISO);
const DUPLICATE_CASE_ID = "injection-0001";
const REPLY_ACTION_TYPES = new Set([
  "general_question",
  "slots_found",
  "appointment_confirmation_accepted",
  "greeting",
  "price_inquiry",
  "clarification_needed",
  "appointment_confirmed",
]);
const ARM_ORDER = Object.freeze([
  Object.freeze(["v1_current", "v2_only"] as const),
  Object.freeze(["v2_only", "v1_current"] as const),
  Object.freeze(["v1_current", "v2_only"] as const),
  Object.freeze(["v2_only", "v1_current"] as const),
  Object.freeze(["v1_current", "v2_only"] as const),
  Object.freeze(["v2_only", "v1_current"] as const),
] as const);

function percentile(values: readonly number[], rank: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * rank) - 1] ?? 0;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function armMetrics(arm: ArmName, samples: readonly TurnSample[]): RuntimeArmMetrics {
  const latency = samples.map((sample) => sample.latencyMs);
  const calls = samples.map((sample) => sample.modelCalls);
  const tokens = samples.map((sample) => sample.tokens);
  return Object.freeze({
    arm,
    turns: samples.length,
    latencyMs: { p50: percentile(latency, 0.5), p95: percentile(latency, 0.95) },
    modelCalls: { mean: mean(calls), p95: percentile(calls, 0.95) },
    tokens: { mean: mean(tokens), p95: percentile(tokens, 0.95) },
    database: {
      statementsP95: percentile(samples.map((sample) => sample.sql.statements), 0.95),
      roundTripsP95: percentile(samples.map((sample) => sample.sql.sequentialRoundTrips), 0.95),
      lockHoldP95Ms: percentile(samples.map((sample) => sample.sql.lockHoldMs), 0.95),
    },
    cardinality: {
      events: samples.reduce((total, sample) => total + sample.cardinality.events, 0),
      processJobs: samples.reduce((total, sample) => total + sample.cardinality.processJobs, 0),
      liveReplies: samples.reduce((total, sample) => total + sample.cardinality.liveReplies, 0),
      sendJobs: samples.reduce((total, sample) => total + sample.cardinality.sendJobs, 0),
    },
  });
}

function packageVersion(packageName: "embedded-postgres" | "pg"): string {
  const parsed = JSON.parse(readFileSync(
    join(process.cwd(), "node_modules", packageName, "package.json"),
    "utf8",
  )) as { version?: unknown };
  if (typeof parsed.version !== "string" || !parsed.version) {
    throw new Error(`missing ${packageName} package version`);
  }
  return parsed.version;
}

function fixedDate(): Date {
  return new Date(FIXED_NOW.getTime());
}

function expectedReply(fixture: CorpusCase): boolean {
  const safety = fixture.labels.understanding.safety;
  if (safety.optOut === true || safety.requestsHuman === true || safety.emergency === true) {
    return false;
  }
  return REPLY_ACTION_TYPES.has(fixture.labels.expectedActionResult.type);
}

function expectedLegacyIntent(fixture: CorpusCase): IntentType {
  switch (fixture.labels.expectedActionResult.type) {
    case "slots_found": return fixture.labels.understanding.request === "book-appointment"
      ? "book_appointment"
      : "check_availability";
    case "appointment_confirmed": return "confirm_slot";
    case "appointment_confirmation_accepted": return "acknowledgment";
    case "price_inquiry":
    case "clarification_needed": return "price_inquiry";
    case "greeting": return "general_question";
    case "general_question": return "general_question";
    default: throw new Error(`unsupported runtime action ${fixture.labels.expectedActionResult.type}`);
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : null;
}

function legacyClassificationFor(fixture: CorpusCase): IntentClassification {
  const expected = fixture.labels.expectedActionResult;
  const entities = fixture.labels.understanding.entities;
  const clarificationNeeded = expected.type === "clarification_needed";
  const ambiguousTreatmentMatches = optionalStringArray(expected.ambiguousTreatmentMatches);
  const identifiedTreatment = clarificationNeeded || ambiguousTreatmentMatches
    ? null
    : optionalString(expected.identifiedTreatment) ?? entities.service ?? null;
  const preferredPeriod = entities.period === "manhã"
    ? "morning"
    : entities.period === "tarde"
      ? "afternoon"
      : entities.period === "noite"
        ? "evening"
        : null;

  return {
    intent: expectedLegacyIntent(fixture),
    slotPreference: {
      preferredDate: entities.date ?? null,
      preferredPeriod,
      preferredTime: entities.time ?? null,
      slotChoice: entities.ordinal ?? null,
      identifiedTreatment,
      ambiguousTreatmentMatches,
    },
    confidence: 1,
    shouldAskClarification: clarificationNeeded,
    clarificationQuestion: clarificationNeeded ? optionalString(expected.question) : null,
    handoffReason: null,
  };
}

function expectedLegacyActions(fixture: CorpusCase): readonly string[] {
  return [...new Set([
    fixture.labels.expectedActionResult.type,
    expectedLegacyIntent(fixture),
    ...(fixture.labels.expectedActionResult.type === "appointment_confirmed" ? ["slots_found"] : []),
  ])];
}

function understandingFor(fixture: CorpusCase): Record<string, unknown> {
  const source = fixture.labels.understanding;
  const entities = source.entities;
  const signals = source.signals;
  return {
    version: "understanding.v1",
    request: source.request,
    dialogueMove: source.dialogueMove,
    entities: {
      service: entities.service ?? null,
      date: entities.date ?? null,
      period: entities.period ?? null,
      time: entities.time ?? null,
      serviceCandidates: entities.serviceCandidates ?? null,
      quantity: entities.quantity ?? null,
      ordinal: entities.ordinal ?? null,
    },
    signals: {
      purchaseIntent: signals.purchaseIntent ?? null,
      priceSensitivity: signals.priceSensitivity ?? null,
      sentiment: signals.sentiment ?? null,
      objection: signals.objection ?? null,
    },
    safety: {
      optOut: source.safety.optOut ?? false,
      requestsHuman: source.safety.requestsHuman ?? false,
      emergency: source.safety.emergency ?? false,
    },
    confidence: 1,
    ambiguity: source.ambiguity ?? null,
  };
}

function createCalendar(): CalendarGateway {
  const slots = [
    { startsAt: new Date("2026-08-26T12:00:00.000Z"), endsAt: new Date("2026-08-26T13:00:00.000Z") },
    { startsAt: new Date("2026-08-27T12:00:00.000Z"), endsAt: new Date("2026-08-27T13:00:00.000Z") },
  ];
  return Object.freeze({
    async listAvailableSlots(input) {
      return slots.map((slot, index) => ({
        id: `runtime-slot-${input.clinicId}-${index}`,
        clinicId: input.clinicId,
        professionalId: null,
        startsAt: new Date(slot.startsAt.getTime()),
        endsAt: new Date(slot.endsAt.getTime()),
        source: "manual" as const,
      }));
    },
    async createAppointment(input): Promise<Appointment> {
      return {
        id: randomUUID(), clinicId: input.clinicId, leadId: input.leadId,
        professionalId: null, roomId: null, calendarEventId: randomUUID(),
        calendarEventUrl: null, startsAt: input.startsAt, endsAt: input.endsAt,
        status: "scheduled", source: "app", origin: null, reminderSentAt: null,
        treatmentId: null, valueCents: null, description: null,
        createdAt: fixedDate(), updatedAt: fixedDate(),
      };
    },
    async cancelAppointment() {},
    async listBlockEvents() { return []; },
    async createBlockEvent(input) {
      return { calendarEventId: randomUUID(), startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason };
    },
    async deleteBlockEvent() {},
    async updateBlockEvent(input) { return { ...input }; },
    async isSlotFree() { return true; },
    async updateCalendarEvent() {},
  });
}

function observeHandler(
  handler: ConversationHandler,
  observations: Map<string, ConversationHandleResult>,
): ConversationHandler {
  return Object.freeze({
    async handle(input: ConversationHandleInput) {
      const result = await handler.handle(input);
      observations.set(input.turnId ?? input.messageId, result);
      return result;
    },
  });
}

describe("V2-only runtime performance measurement worker", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let fixtures: CorpusCase[] = [];
  let populationDigest = "";
  let databaseServerVersion = "";
  let inboundEventStore: DrizzleInboundEventStore;
  let jobQueue: DrizzleJobQueue;
  let outboundMessageStore: DrizzleOutboundMessageStore;
  let leadRepository: DrizzleLeadRepository;
  let conversationRepository: DrizzleConversationRepository;
  let state: ConversationStateMachine;
  let appointmentRepository: DrizzleAppointmentRepository;
  let reservations: SlotReservationService;
  let processHandlers: Record<ArmName, ProcessMessageJobHandler>;
  let sender: SendMessageJobHandler;
  let sqlRecorder: ReturnType<typeof installRuntimePerformanceSqlRecorder> | undefined;
  let activeV2Fixture: CorpusCase | undefined;
  let activeV2Calls = 0;
  let activeV2Tokens = 0;
  let activeV2VerbalizerCalls = 0;
  let activeV2VerbalizerTokens = 0;
  let providerDeliveries = 0;
  const observations = new Map<string, ConversationHandleResult>();
  const decisionTraces: Record<ArmName, Map<string, DecisionTraceRecord[]>> = {
    v1_current: new Map(),
    v2_only: new Map(),
  };
  const v1TurnObservations = new Map<string, V1TurnObservationEvent[]>();
  const clinicIdsByCase = new Map<string, string>();
  const fixtureInputsByCase = new Map<string, RuntimeFixtureInputs>();
  const expectedV2OutcomesByCase = new Map<string, string>();
  const samples: Record<ArmName, TurnSample[]> = { v1_current: [], v2_only: [] };

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    const database = drizzleNodePostgres(runtime.pool, { schema });
    databaseMock.set(database);
    const embeddedBatch = createEmbeddedAtomicDatabaseBatch(runtime.pool);
    atomicBatchMock.set(embeddedBatch);
    await migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });

    const manifestPath = "evals/understanding/cycle-f-dental.json";
    const manifest = JSON.parse(readFileSync(
      join(process.cwd(), manifestPath),
      "utf8",
    )) as { cases: { caseId: string }[] };
    const corpusById = new Map(loadCorpus("evals/corpus").cases.map((fixture) => [fixture.caseId, fixture]));
    fixtures = manifest.cases.map(({ caseId }) => {
      const fixture = corpusById.get(caseId);
      if (!fixture) throw new Error(`missing runtime fixture ${caseId}`);
      return fixture;
    });
    expect(fixtures).toHaveLength(17);
    for (const fixture of fixtures) {
      expect({
        optOut: fixture.labels.understanding.safety.optOut ?? false,
        requestsHuman: fixture.labels.understanding.safety.requestsHuman ?? false,
        emergency: fixture.labels.understanding.safety.emergency ?? false,
      }).toEqual({ optOut: false, requestsHuman: false, emergency: false });
      expect(REPLY_ACTION_TYPES.has(fixture.labels.expectedActionResult.type)).toBe(true);
      expect(expectedReply(fixture)).toBe(true);
    }
    const tenantConfigs = new Map<string, unknown>();
    for (const fixture of fixtures) {
      const configRef = fixture.input.tenantConfigRef;
      if (!tenantConfigs.has(configRef)) {
        tenantConfigs.set(configRef, JSON.parse(readFileSync(
          join(process.cwd(), "evals/corpus/tenant-configs", `${configRef}.json`),
          "utf8",
        )));
      }
    }
    const population = buildRuntimePerformancePopulation({
      manifestPath,
      manifest,
      fixtures,
      tenantConfigs,
    });
    populationDigest = population.populationDigest;
    for (const fixtureInput of population.fixtureInputs) {
      fixtureInputsByCase.set(fixtureInput.caseId, fixtureInput);
    }

    for (const fixture of fixtures) {
      const fixtureInput = fixtureInputsByCase.get(fixture.caseId);
      if (!fixtureInput) throw new Error(`missing derived runtime fixture ${fixture.caseId}`);
      expectedV2OutcomesByCase.set(fixture.caseId, fixtureInput.expectedV2Outcome);
      const [organization] = await database.insert(organizations).values({
        ...fixtureInput.organization,
      }).returning({ id: organizations.id });
      clinicIdsByCase.set(fixture.caseId, organization!.id);
      expect(fixtureInput.catalog.length, `${fixture.caseId} full catalog size`).toBeGreaterThan(0);
      for (const service of fixtureInput.catalog) {
        await database.insert(treatments).values({
          clinicId: organization!.id,
          ...service,
          aliases: [...service.aliases],
        });
      }
      expect(
        (await new DrizzleTreatmentRepository().listByClinic(organization!.id))
          .map((service) => service.name).sort(),
        `${fixture.caseId} persisted full committed catalog`,
      ).toEqual(fixtureInput.catalog.map((service) => service.name).sort());
    }
    const version = await runtime.pool.query<{ server_version: string }>("show server_version");
    databaseServerVersion = version.rows[0]?.server_version ?? "unknown";

    inboundEventStore = new DrizzleInboundEventStore(embeddedBatch);
    jobQueue = new DrizzleJobQueue();
    outboundMessageStore = new DrizzleOutboundMessageStore();
    leadRepository = new DrizzleLeadRepository();
    conversationRepository = new DrizzleConversationRepository();
    const followUpRepository = new DrizzleFollowUpRepository();
    const streamAuthority = new DrizzleWhatsAppStreamAuthority(embeddedBatch);
    const makeRegisterIncomingMessage = () => new RegisterIncomingMessage({
      leadRepository,
      conversationRepository,
      usageCostTracker: new DefaultUsageCostTracker({
        usageCostRepository: new DrizzleUsageCostRepository(),
        idGenerator: randomUUID,
        now: fixedDate,
      }),
      followUpRepository,
      idGenerator: randomUUID,
      now: fixedDate,
    });
    const inboundHistoryRegistrar = new RegisterInboundHistory({
      registerIncomingMessage: makeRegisterIncomingMessage(),
      streamAuthority,
      now: fixedDate,
    });

    const decisionTraceSink = (arm: ArmName): DecisionTraceSink => ({
      record(record) {
        const records = decisionTraces[arm].get(record.turnId) ?? [];
        records.push(record);
        decisionTraces[arm].set(record.turnId, records);
      },
    });
    const calendar = createCalendar();
    const v1Handler = observeHandler(
      new ConversationOrchestrator({
        suppressAuxiliaryExternalEffects: true,
        decisionTraceSink: decisionTraceSink("v1_current"),
        calendarGatewayResolver: () => calendar,
      }),
      observations,
    );
    state = new ConversationStateMachine();
    reservations = new SlotReservationService();
    appointmentRepository = new DrizzleAppointmentRepository();
    const v2Lifecycle = new LiveTurnLifecycle({
      registerIncomingMessage: makeRegisterIncomingMessage(),
      conversationRepository,
      contextReader: new DrizzleLiveConversationContextReader(),
      turnCoordinator: new ConversationTurnCoordinator(new DrizzleConversationTurnLeaseStore()),
      stateReader: state,
      now: fixedDate,
      streamAuthority,
    });
    const v2Understanding = createLiveDentalUnderstanding({
      chat: {
        completions: {
          create: async () => {
            if (!activeV2Fixture) throw new Error("V2 model invoked outside a measured turn");
            const inputTokens = 13 + activeV2Fixture.caseId.length % 5;
            const outputTokens = 7;
            activeV2Calls += 1;
            activeV2Tokens += inputTokens + outputTokens;
            return {
              choices: [{ message: { content: JSON.stringify(understandingFor(activeV2Fixture)) } }],
              usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
            };
          },
        },
      },
    });
    const v2Verbalizer = createLiveResponseVerbalizer({
      chat: {
        completions: {
          create: async (input: unknown) => {
            if (!activeV2Fixture) throw new Error("V2 verbalizer invoked outside a measured turn");
            const request = input as { messages?: { content?: unknown }[] };
            const rawPayload = request.messages?.[1]?.content;
            if (typeof rawPayload !== "string") throw new Error("V2 verbalizer received no payload");
            const payload = JSON.parse(rawPayload) as { allowedValues?: unknown };
            const values = Array.isArray(payload.allowedValues)
              && payload.allowedValues.every((value) => typeof value === "string")
              ? payload.allowedValues
              : [];
            const prefix: Record<string, string> = {
              general_question: "Posso ajudar.",
              greeting: "Olá, posso ajudar.",
              price_inquiry: "Sobre este serviço:",
              clarification_needed: "Preciso confirmar o serviço.",
              slots_found: "Estas são as opções:",
              appointment_confirmed: "A ação foi concluída.",
              appointment_confirmation_accepted: "Confirmação recebida.",
            };
            const fixturePrefix = prefix[activeV2Fixture.labels.expectedActionResult.type]
              ?? "Posso ajudar.";
            const text = values.length > 0 ? `${fixturePrefix} ${values.join(" ")}` : fixturePrefix;
            const inputTokens = 17 + activeV2Fixture.caseId.length % 7;
            const outputTokens = 5 + Math.ceil(text.length / 24);
            activeV2VerbalizerCalls += 1;
            activeV2VerbalizerTokens += inputTokens + outputTokens;
            return {
              choices: [{ message: { content: JSON.stringify({ text }) } }],
              usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
            };
          },
        },
      },
    });
    const v2Handler = observeHandler(new V2LiveConversationHandler({
      lifecycle: v2Lifecycle,
      understanding: v2Understanding,
      verbalizer: v2Verbalizer,
      dental: {
        treatments: new DrizzleTreatmentRepository(),
        calendar,
        state,
        appointments: appointmentRepository,
        reservations,
        booking: new BookingService(
          calendar,
          appointmentRepository,
          leadRepository,
          reservations,
          followUpRepository,
        ),
      },
      resolveTurnConfiguration: async () => {
        if (!activeV2Fixture) throw new Error("V2 configuration resolved outside a measured turn");
        const fixtureInput = fixtureInputsByCase.get(activeV2Fixture.caseId);
        if (!fixtureInput) throw new Error(`missing V2 fixture inputs ${activeV2Fixture.caseId}`);
        return {
          gateInput: {
            automationEnabled: true,
            duplicate: false,
            humanControlled: false,
            optedOut: false,
          },
          policy: fixtureInput.turnConfiguration.policy,
          style: fixtureInput.turnConfiguration.style,
          speaker: fixtureInput.turnConfiguration.speaker,
          useVoice: false,
          ttsConfig: { provider: "nova", speed: 1 },
          deliveryBinding: {
            schemaVersion: "conversation-v2.internal-lab-delivery-binding.v1",
            tenantDigest: `sha256:${"1".repeat(64)}`,
            channelDigest: `sha256:${"2".repeat(64)}`,
            configDigest: `sha256:${"3".repeat(64)}`,
          },
        };
      },
      outbound: { outboundMessageStore, jobQueue },
      decisionTraceSink: decisionTraceSink("v2_only"),
      persistStopContact: async () => {},
      now: fixedDate,
    }), observations);

    const processDependencies = {
      inboundEventStore,
      automationPolicy: {
        async decide(clinicId: string) {
          return Object.freeze({
            clinicId,
            mode: "live" as const,
            reason: "live_v2" as const,
            authorityVersion: 2 as const,
            runtimeControlVersion: 1,
          });
        },
      },
      inboundHistoryRegistrar,
      transcribeAudio: async () => { throw new Error("runtime text fixtures never transcribe audio"); },
      createTurnObservationSink: ({ turnId }: { turnId: string }) => ({
        record(event: V1TurnObservationEvent) {
          const events = v1TurnObservations.get(turnId) ?? [];
          events.push(event);
          v1TurnObservations.set(turnId, events);
        },
      }),
    };
    processHandlers = {
      v1_current: new ProcessMessageJobHandler({ ...processDependencies, conversationHandler: v1Handler }),
      v2_only: new ProcessMessageJobHandler({ ...processDependencies, conversationHandler: v2Handler }),
    };
    sender = new SendMessageJobHandler({
      outboundMessageStore,
      now: fixedDate,
      internalLabDeliveryGuard: {
        authorize: async () => ({
          schemaVersion: "conversation-v2.internal-lab-delivery-authorization.v1",
          authorizationId: randomUUID(),
          expiresAt: new Date("2026-08-26T13:00:00.000Z"),
        }),
      } as never,
      delivery: async ({ payload }) => {
        providerDeliveries += 1;
        const candidate = payload as { turnId?: unknown; agentMessageId?: unknown };
        const identity = typeof candidate.turnId === "string"
          ? candidate.turnId
          : String(candidate.agentMessageId ?? providerDeliveries);
        return `runtime-provider-${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
      },
    });

    sqlRecorder = installRuntimePerformanceSqlRecorder(runtime.pool);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  }, 30_000);

  afterAll(async () => {
    vi.useRealTimers();
    sqlRecorder?.restore();
    await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
  });

  async function readTurnCardinality(inboundEventId: string): Promise<TurnCardinality> {
    const result = await runtime!.pool.query<{
      events: string;
      process_jobs: string;
      live_replies: string;
      send_jobs: string;
      sent_replies: string;
    }>(`
      select
        (select count(*)::text from inbound_events where id = $1::uuid) as events,
        (select count(*)::text from jobs where queue = 'message.process' and payload ->> 'inboundEventId' = $1::text) as process_jobs,
        (select count(*)::text from outbound_messages where category = 'reply' and authorization_inbound_event_id = $1::uuid) as live_replies,
        (select count(*)::text
           from jobs job
           join outbound_messages outbound
             on job.payload ->> 'outboundMessageId' = outbound.id::text
          where job.queue = 'message.send'
            and outbound.authorization_inbound_event_id = $1::uuid) as send_jobs,
        (select count(*)::text from outbound_messages where category = 'reply' and status = 'sent' and authorization_inbound_event_id = $1::uuid) as sent_replies
    `, [inboundEventId]);
    const row = result.rows[0]!;
    return {
      events: Number(row.events),
      processJobs: Number(row.process_jobs),
      liveReplies: Number(row.live_replies),
      sendJobs: Number(row.send_jobs),
      sentReplies: Number(row.sent_replies),
    };
  }

  async function readDurableReplyIntent(inboundEventId: string): Promise<string | null> {
    const result = await runtime!.pool.query<{ intent: string | null }>(`
      select payload ->> 'intent' as intent
        from outbound_messages
       where category = 'reply'
         and authorization_inbound_event_id = $1::uuid
    `, [inboundEventId]);
    expect(result.rows, `${inboundEventId} has one durable reply path`).toHaveLength(1);
    return result.rows[0]?.intent ?? null;
  }

  async function alignLatestFixtureStateWithFixedClock(
    conversationId: string,
    createdAt: Date,
  ): Promise<void> {
    const result = await runtime!.pool.query(`
      update conversation_states
         set created_at = $2
       where id = (
         select id
           from conversation_states
          where conversation_id = $1::uuid
          order by created_at desc, id desc
          limit 1
       )
    `, [conversationId, createdAt]);
    expect(result.rowCount, `${conversationId} fixed-clock state alignment`).toBe(1);
  }

  async function seedFixtureContext(
    arm: ArmName,
    fixture: CorpusCase,
    turnIndex: number,
    phone: string,
    clinicId: string,
  ): Promise<SeededFixtureContext> {
    const now = fixedDate();
    const fixtureInput = fixtureInputsByCase.get(fixture.caseId);
    if (!fixtureInput) throw new Error(`missing fixture inputs ${fixture.caseId}`);
    const lead = await leadRepository.ensureWhatsAppIdentity({
      id: randomUUID(),
      clinicId,
      name: null,
      phone,
      whatsappLid: null,
      email: null,
      channel: "whatsapp",
      campaignId: null,
      treatmentInterest: fixtureInput.lead.treatmentInterest,
      profilePicUrl: null,
      status: "new",
      temperature: null,
      assignedToUserId: null,
      nextActionAt: null,
      lostReason: null,
      createdAt: now,
      updatedAt: now,
    } satisfies Lead);
    const conversation = await conversationRepository.ensureConversation({
      id: randomUUID(),
      clinicId,
      leadId: lead.id,
      channel: "whatsapp",
      category: "sales",
      externalThreadId: phone,
      summary: null,
      aiPaused: false,
      takeoverExpiresAt: null,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    } satisfies Conversation);

    for (const [index, history] of fixtureInput.history.entries()) {
      const inserted = await conversationRepository.appendMessage({
        id: randomUUID(),
        conversationId: conversation.id,
        author: history.author,
        body: history.body,
        sentAt: new Date(FIXED_NOW.getTime() - history.minutesBeforeTurn * 60_000),
        externalId: null,
        intent: null,
        deliveryFormat: null,
      } satisfies Message);
      expect(inserted, `${arm}/${fixture.caseId}/${turnIndex} history row ${index}`).toBe(true);
    }

    const supportedStates = new Set<ConversationStateType>([
      "idle",
      "slots_offered",
      "awaiting_confirmation",
      "booking_pending",
      "menu_offered",
      "procedure_list_offered",
      "treatment_pipeline_active",
      "awaiting_appointment_confirmation",
      "awaiting_deposit_proof",
      "deposit_proof_received",
    ]);
    if (fixtureInput.requestedState !== null) {
      if (!supportedStates.has(fixtureInput.requestedState as ConversationStateType)) {
        throw new Error(`unsupported runtime fixture state ${fixtureInput.requestedState}`);
      }
      await state.transition(conversation.id, fixtureInput.requestedState as ConversationStateType);
      await alignLatestFixtureStateWithFixedClock(
        conversation.id,
        new Date(FIXED_NOW.getTime() - 120_000),
      );
    }

    const persistedHistory = await conversationRepository.listMessages(conversation.id);
    expect(
      persistedHistory.map(({ author, body }) => ({ author, body })),
      `${arm}/${fixture.caseId}/${turnIndex} durable history`,
    ).toEqual(fixtureInput.history.map(({ author, body }) => ({ author, body })));
    expect((await state.getCurrentState(conversation.id))?.state ?? null)
      .toBe(fixtureInput.requestedState);

    let seededAppointmentId: string | null = null;
    if (fixtureInput.actionContext.kind === "offered_slots") {
      const actionContext = fixtureInput.actionContext;
      const treatment = (await new DrizzleTreatmentRepository().listByClinic(clinicId))
        .find((candidate) => candidate.name === actionContext.treatmentName);
      if (!treatment) throw new Error(`missing runtime treatment for ${fixture.caseId}`);
      await state.transition(conversation.id, "slots_offered", {
        slots: actionContext.slots,
        expiresAt: actionContext.expiresAt,
        treatmentId: treatment.id,
        treatmentName: treatment.name,
        durationMinutes: actionContext.durationMinutes,
      }, 1_920);
      await alignLatestFixtureStateWithFixedClock(
        conversation.id,
        new Date(FIXED_NOW.getTime() - 60_000),
      );
    } else if (fixtureInput.actionContext.kind === "appointment_confirmation") {
      const appointmentId = randomUUID();
      seededAppointmentId = appointmentId;
      await appointmentRepository.save({
        id: appointmentId,
        clinicId,
        leadId: lead.id,
        professionalId: null,
        roomId: null,
        calendarEventId: randomUUID(),
        calendarEventUrl: null,
        startsAt: new Date(fixtureInput.actionContext.startsAt),
        endsAt: new Date(fixtureInput.actionContext.endsAt),
        status: "scheduled",
        source: "app",
        origin: null,
        reminderSentAt: null,
        treatmentId: null,
        valueCents: null,
        description: null,
        createdAt: now,
        updatedAt: now,
      });
      await state.transition(conversation.id, "awaiting_appointment_confirmation", {
        appointmentId,
        appointmentLabel: fixtureInput.actionContext.appointmentLabel,
      });
      await alignLatestFixtureStateWithFixedClock(
        conversation.id,
        new Date(FIXED_NOW.getTime() - 60_000),
      );
    }
    return Object.freeze({
      conversationId: conversation.id,
      leadId: lead.id,
      seededAppointmentId,
    });
  }

  async function assertDurableFixtureEffect(
    arm: ArmName,
    fixture: CorpusCase,
    repetition: number,
    clinicId: string,
    context: SeededFixtureContext,
  ): Promise<void> {
    const label = `${arm}/${fixture.caseId}/${repetition}`;
    const fixtureInput = fixtureInputsByCase.get(fixture.caseId);
    if (!fixtureInput) throw new Error(`missing fixture inputs ${fixture.caseId}`);
    const currentState = await state.getCurrentState(context.conversationId);

    switch (fixture.labels.expectedActionResult.type) {
      case "slots_found": {
        const expectedSlotStarts = fixture.caseId === "availability-0001"
          ? ["2026-08-26T12:00:00.000Z"]
          : ["2026-08-26T12:00:00.000Z", "2026-08-27T12:00:00.000Z"];
        const payload = currentState?.payload as {
          slots?: readonly { startsAt?: unknown }[];
        } | null;
        expect(currentState?.state, `${label} durable slot-offer state`).toBe("slots_offered");
        expect(
          payload?.slots?.map((slot) => slot.startsAt) ?? [],
          `${label} durable slot-offer effect`,
        ).toEqual(expectedSlotStarts);
        return;
      }
      case "appointment_confirmed": {
        if (fixtureInput.actionContext.kind !== "offered_slots") {
          throw new Error(`${label} missing offered-slot action context`);
        }
        const selectedIndex = fixture.labels.understanding.entities.ordinal;
        const selectedSlot = fixtureInput.actionContext.slots.find(
          (slot) => slot.index === selectedIndex,
        );
        if (!selectedSlot) throw new Error(`${label} missing selected appointment slot`);
        const appointments = await appointmentRepository.findByPeriod(
          clinicId,
          new Date(selectedSlot.startsAt),
          new Date(selectedSlot.endsAt),
        );
        expect(
          appointments
            .filter((appointment) =>
              appointment.leadId === context.leadId &&
              (appointment.status === "scheduled" || appointment.status === "confirmed"),
            )
            .map((appointment) => ({
              startsAt: appointment.startsAt.toISOString(),
              endsAt: appointment.endsAt.toISOString(),
              status: appointment.status,
              origin: appointment.origin,
            })),
          `${label} durable appointment effect`,
        ).toEqual([{
          startsAt: selectedSlot.startsAt,
          endsAt: selectedSlot.endsAt,
          status: "scheduled",
          origin: "ai_conversation",
        }]);
        expect(
          { state: currentState?.state, payload: currentState?.payload ?? null },
          `${label} consumed slot state`,
        ).toEqual({ state: "idle", payload: null });
        return;
      }
      case "appointment_confirmation_accepted": {
        if (
          fixtureInput.actionContext.kind !== "appointment_confirmation" ||
          context.seededAppointmentId === null
        ) {
          throw new Error(`${label} missing appointment-confirmation action context`);
        }
        const appointment = await appointmentRepository.findById(context.seededAppointmentId);
        expect(appointment && {
          clinicId: appointment.clinicId,
          leadId: appointment.leadId,
          startsAt: appointment.startsAt.toISOString(),
          endsAt: appointment.endsAt.toISOString(),
          status: appointment.status,
        }, `${label} durable appointment-confirmation effect`).toEqual({
          clinicId,
          leadId: context.leadId,
          startsAt: fixtureInput.actionContext.startsAt,
          endsAt: fixtureInput.actionContext.endsAt,
          status: "confirmed",
        });
        expect(
          { state: currentState?.state, payload: currentState?.payload ?? null },
          `${label} consumed confirmation state`,
        ).toEqual({ state: "idle", payload: null });
      }
    }
  }

  async function runTurn(arm: ArmName, fixture: CorpusCase, repetition: number): Promise<void> {
    const turnIndex = repetition * fixtures.length + fixtures.indexOf(fixture);
    const clinicId = clinicIdsByCase.get(fixture.caseId);
    if (!clinicId) throw new Error(`missing runtime clinic ${fixture.caseId}`);
    const messageId = `runtime-${arm}-${repetition}-${fixture.caseId}`;
    const phone = arm === "v1_current"
      ? `551170${String(turnIndex).padStart(7, "0")}`
      : `551180${String(turnIndex).padStart(7, "0")}`;
    const payload = {
      instanceId: "runtime-instance",
      phone,
      messageId,
      fromMe: false,
      isGroupMsg: false,
      isStatusReply: false,
      isEdit: false,
      senderName: "Runtime",
      text: { message: fixture.input.leadMessage },
    };
    const ingress = {
      clinicId,
      provider: "z_api" as const,
      providerMessageId: messageId,
      conversationKey: phone,
      aliases: buildWhatsAppStreamAliases({
        provider: "z_api",
        providerInstanceId: "runtime-instance",
        providerThreadId: phone,
        phone,
      }),
      payload,
      normalizedText: fixture.input.leadMessage,
      mediaType: null,
      dedupeKey: `z-api:runtime-instance:${messageId}`,
      receivedAt: fixedDate(),
    };

    const seededContext = await seedFixtureContext(arm, fixture, turnIndex, phone, clinicId);
    v1Model.begin(fixture.caseId, legacyClassificationFor(fixture));
    activeV2Fixture = fixture;
    activeV2Calls = 0;
    activeV2Tokens = 0;
    activeV2VerbalizerCalls = 0;
    activeV2VerbalizerTokens = 0;
    const deliveriesBefore = providerDeliveries;
    sqlRecorder!.beginTurn();
    const startedAt = performance.now();
    let sql: SqlTurnMetrics | undefined;
    try {
      const recorded = await inboundEventStore.recordInboundEventAndEnqueue(ingress);
      expect(recorded.outcome).toBe("registered");
      if (recorded.outcome !== "registered") throw new Error(`unexpected ingress outcome ${recorded.outcome}`);
      expect(recorded.eventWasNew).toBe(true);
      expect(recorded.jobWasNew).toBe(true);
      if (fixture.caseId === DUPLICATE_CASE_ID) {
        const duplicate = await inboundEventStore.recordInboundEventAndEnqueue(ingress);
        expect(duplicate).toMatchObject({
          outcome: "registered",
          inboundEventId: recorded.inboundEventId,
          jobId: recorded.jobId,
          eventWasNew: false,
          jobWasNew: false,
        });
      }

      const processResult = await runWithRuntimeClock({ now: fixedDate }, () =>
        drainMessageProcessQueue({
          jobQueue,
          inboundEventStore,
          handler: processHandlers[arm],
          workerId: `runtime-process-${arm}-${turnIndex}`,
          maxJobs: 1,
          now: DRAIN_NOW,
        }));
      expect(processResult).toMatchObject({ claimed: 1, processed: 1, ignored: 0, retried: 0, dead: 0 });
      const observed = observations.get(recorded.inboundEventId);
      expect(observed, `${arm}/${fixture.caseId}/${repetition} crossed the unchanged handler`).toBeDefined();
      expect(observed?.reason, `${arm}/${fixture.caseId}/${repetition} must not be a safe failure`).toBeUndefined();
      expect(observed?.replied, `${arm}/${fixture.caseId}/${repetition} reply disposition`).toBe(expectedReply(fixture));
      if (arm === "v1_current") {
        const plans = (v1TurnObservations.get(recorded.inboundEventId) ?? [])
          .filter((event): event is Extract<V1TurnObservationEvent, { kind: "v1_response_plan" }> =>
            event.kind === "v1_response_plan");
        if (plans.length > 0) {
          expect(
            plans.some((plan) => expectedLegacyActions(fixture).includes(plan.outcomeSummary)),
            `${arm}/${fixture.caseId}/${repetition} legacy action path`,
          ).toBe(true);
        } else {
          expect(await readDurableReplyIntent(recorded.inboundEventId), `${arm}/${fixture.caseId}/${repetition} durable legacy path`)
            .toBe(expectedLegacyIntent(fixture));
        }
      } else {
        const v2Traces = decisionTraces.v2_only.get(recorded.inboundEventId) ?? [];
        const understoodRequests = v2Traces
          .filter((record) => record.stage === "v2.understanding")
          .map((record) => record.metadata?.request);
        expect(understoodRequests, `${arm}/${fixture.caseId}/${repetition} V2 understanding path`)
          .toContain(fixture.labels.understanding.request);
        const actionOutcomes = v2Traces
          .filter((record) => record.stage === "v2.action_result")
          .flatMap((record) => String(record.metadata?.outcomeTypes ?? "").split(","));
        expect(actionOutcomes, `${arm}/${fixture.caseId}/${repetition} V2 action path`)
          .toContain(expectedV2OutcomesByCase.get(fixture.caseId));
      }

      const sendResult = await runWithRuntimeClock({ now: fixedDate }, () =>
        drainMessageSendQueue({
          jobQueue,
          outboundMessageStore,
          handler: sender,
          workerId: `runtime-send-${arm}-${turnIndex}`,
          maxJobs: 1,
          now: DRAIN_NOW,
        }));
      expect(sendResult).toMatchObject({ claimed: 1, sent: 1, ignored: 0, retried: 0, dead: 0 });
      expect(providerDeliveries - deliveriesBefore).toBe(1);

      const latencyMs = performance.now() - startedAt;
      sql = sqlRecorder!.endTurn();
      const cardinality = await readTurnCardinality(recorded.inboundEventId);
      expect(cardinality, `${arm}/${fixture.caseId}/${repetition} durable cardinality`).toEqual({
        events: 1,
        processJobs: 1,
        liveReplies: 1,
        sendJobs: 1,
        sentReplies: 1,
      });
      if (arm === "v1_current") {
        expect(v1Model.snapshot().classifiedIntent, `${fixture.caseId} legacy classifier mapping`)
          .toBe(expectedLegacyIntent(fixture));
      }
      const telemetry = arm === "v1_current"
        ? v1Model.snapshot()
        : {
            calls: activeV2Calls + activeV2VerbalizerCalls,
            tokens: activeV2Tokens + activeV2VerbalizerTokens,
          };
      if (arm === "v2_only" && expectedReply(fixture)) {
        expect(activeV2Calls, `${fixture.caseId} Understanding boundary calls`).toBe(1);
        expect(activeV2Tokens, `${fixture.caseId} Understanding boundary tokens`).toBeGreaterThan(0);
        expect(activeV2VerbalizerCalls, `${fixture.caseId} verbalizer boundary calls`).toBe(1);
        expect(activeV2VerbalizerTokens, `${fixture.caseId} verbalizer boundary tokens`).toBeGreaterThan(0);
      }
      expect(telemetry.calls).toBeGreaterThan(0);
      expect(telemetry.tokens).toBeGreaterThan(0);
      await assertDurableFixtureEffect(arm, fixture, repetition, clinicId, seededContext);
      samples[arm].push(Object.freeze({ latencyMs, modelCalls: telemetry.calls, tokens: telemetry.tokens, sql, cardinality }));
      if (fixture.labels.expectedActionResult.type === "appointment_confirmed") {
        const createdAppointments = await appointmentRepository.findByPeriod(
          clinicId,
          new Date("2026-08-26T00:00:00.000Z"),
          new Date("2026-08-27T00:00:00.000Z"),
        );
        for (const appointment of createdAppointments) {
          await appointmentRepository.save({ ...appointment, status: "cancelled", updatedAt: fixedDate() });
          await reservations.releaseBySlot(clinicId, appointment.startsAt);
        }
      }
    } finally {
      if (!sql) sqlRecorder!.endTurn();
      activeV2Fixture = undefined;
    }
  }

  it("measures both unchanged arms through ingress, process claim, outbox, send claim, and delivery", async () => {
    for (let repetition = 0; repetition < ARM_ORDER.length; repetition += 1) {
      for (const fixture of fixtures) {
        for (const arm of ARM_ORDER[repetition]!) {
          await runTurn(arm, fixture, repetition);
        }
      }
    }

    expect(samples.v1_current).toHaveLength(102);
    expect(samples.v2_only).toHaveLength(102);
    expect(samples.v1_current.reduce((total, sample) => total + sample.cardinality.liveReplies, 0)).toBe(102);
    expect(samples.v2_only.reduce((total, sample) => total + sample.cardinality.liveReplies, 0)).toBe(102);

    const total = await runtime!.pool.query<{
      events: string;
      process_jobs: string;
      live_replies: string;
      send_jobs: string;
      sent_replies: string;
    }>(`
      select
        (select count(*)::text from inbound_events) as events,
        (select count(*)::text from jobs where queue = 'message.process') as process_jobs,
        (select count(*)::text from outbound_messages where category = 'reply') as live_replies,
        (select count(*)::text from jobs where queue = 'message.send') as send_jobs,
        (select count(*)::text from outbound_messages where category = 'reply' and status = 'sent') as sent_replies
    `);
    expect(total.rows[0]).toEqual({
      events: "204",
      process_jobs: "204",
      live_replies: "204",
      send_jobs: "204",
      sent_replies: "204",
    });

    const report: RuntimePerformanceReport = {
      version: "v2-only-runtime-performance.v2",
      provenance: {
        commit: process.env.V2_RUNTIME_PERFORMANCE_COMMIT ?? "0".repeat(40),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        database: {
          embeddedPostgresql: {
            package: "embedded-postgres",
            packageVersion: packageVersion("embedded-postgres"),
            serverVersion: databaseServerVersion,
          },
          nodePostgres: { package: "pg", packageVersion: packageVersion("pg") },
        },
        populationDigest,
        populationDigestSemantics: RUNTIME_POPULATION_DIGEST_SEMANTICS,
        lockHoldMetricSemantics: "whatsapp-stream-authority.explicit-after-acquisition-to-end.autocommit-statement-upper-bound.v1",
        armOrderPolicy: "alternate-by-repetition.v1-first-even.v2-first-odd",
        armOrder: ARM_ORDER,
      },
      population: { cases: 17, repetitions: 6, turnsPerArm: 102 },
      arms: [armMetrics("v1_current", samples.v1_current), armMetrics("v2_only", samples.v2_only)],
    };
    if (process.env.V2_RUNTIME_PERFORMANCE_OUTPUT) {
      writeFileSync(process.env.V2_RUNTIME_PERFORMANCE_OUTPUT, JSON.stringify(report));
    }
  }, 120_000);
});
