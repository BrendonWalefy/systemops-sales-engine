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
  return {
    begin(nextCaseId: string) { caseId = nextCaseId; calls = 0; tokens = 0; },
    record(inputTokens: number, outputTokens: number) {
      calls += 1;
      tokens += inputTokens + outputTokens;
    },
    snapshot() { return Object.freeze({ calls, tokens }); },
    get caseId() { return caseId; },
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
                  ? JSON.stringify({
                      intent: "general_question",
                      slotPreference: {
                        preferredDate: null,
                        preferredPeriod: null,
                        preferredTime: null,
                        slotChoice: null,
                        identifiedTreatment: null,
                        ambiguousTreatmentMatches: null,
                      },
                      confidence: 1,
                      shouldAskClarification: false,
                      clarificationQuestion: null,
                      handoffReason: null,
                    })
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
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { ConversationTurnCoordinator } from "@/core/pipeline/ConversationTurnCoordinator";
import { BookingService } from "@/core/scheduling/BookingService";
import { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import { runWithRuntimeClock } from "@/core/time/RuntimeClock";
import type { Appointment } from "@/domain/entities/calendar-slot";
import { createLiveDentalUnderstanding } from "@/infrastructure/adapters/ai/live-dental-understanding";
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
import * as schema from "@/infrastructure/db/schema";
import { organizations, treatments } from "@/infrastructure/db/schema";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleClinicAutomationPolicyReader } from "@/infrastructure/repositories/drizzle-clinic-automation-policy-reader";
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

const FIXED_NOW = new Date("2026-08-25T12:00:00.000Z");
const DRAIN_NOW = new Date("2026-08-26T12:00:00.000Z");
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
  const startsAt = new Date("2026-08-27T12:00:00.000Z");
  const endsAt = new Date("2026-08-27T13:00:00.000Z");
  return Object.freeze({
    async listAvailableSlots(input) {
      return [{
        id: `runtime-slot-${input.clinicId}`,
        clinicId: input.clinicId,
        professionalId: null,
        startsAt: new Date(startsAt.getTime()),
        endsAt: new Date(endsAt.getTime()),
        source: "manual" as const,
      }];
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
  let clinicId = "";
  let fixtures: CorpusCase[] = [];
  let populationDigest = "";
  let databaseServerVersion = "";
  let inboundEventStore: DrizzleInboundEventStore;
  let jobQueue: DrizzleJobQueue;
  let outboundMessageStore: DrizzleOutboundMessageStore;
  let processHandlers: Record<ArmName, ProcessMessageJobHandler>;
  let sender: SendMessageJobHandler;
  let sqlRecorder: ReturnType<typeof installRuntimePerformanceSqlRecorder> | undefined;
  let activeV2Fixture: CorpusCase | undefined;
  let activeV2Calls = 0;
  let activeV2Tokens = 0;
  let providerDeliveries = 0;
  const observations = new Map<string, ConversationHandleResult>();
  const samples: Record<ArmName, TurnSample[]> = { v1_current: [], v2_only: [] };

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    const database = drizzleNodePostgres(runtime.pool, { schema });
    databaseMock.set(database);
    const embeddedBatch = createEmbeddedAtomicDatabaseBatch(runtime.pool);
    atomicBatchMock.set(embeddedBatch);
    await migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });

    const manifest = JSON.parse(readFileSync(
      join(process.cwd(), "evals/understanding/cycle-f-dental.json"),
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
    populationDigest = `sha256:${createHash("sha256").update(JSON.stringify(
      fixtures.map((fixture) => ({
        caseId: fixture.caseId,
        input: fixture.input,
        understanding: fixture.labels.understanding,
        expectedActionResult: fixture.labels.expectedActionResult,
      })),
    )).digest("hex")}`;

    const [organization] = await database.insert(organizations).values({
      name: "Runtime measurement",
      slug: "runtime-measurement",
      specialty: "dental",
      operationalStatus: "active",
      isTest: true,
      isDemo: false,
      autoReplyEnabled: true,
      calendarMode: "internal",
      timezone: "America/Sao_Paulo",
      businessHours: "Seg-Sex 08:00-18:00",
      messageDebounceMs: 0,
    }).returning({ id: organizations.id });
    clinicId = organization!.id;
    const serviceAliases = [...new Set(fixtures.flatMap((fixture) => {
      const service = fixture.labels.understanding.entities.service;
      return typeof service === "string" && service ? [service] : [];
    }))];
    await database.insert(treatments).values({
      clinicId,
      name: "Runtime service",
      durationMinutes: 60,
      description: "Runtime measurement service",
      aliases: serviceAliases,
      priceCents: 10_000,
      priceQuotableInChat: true,
      priceKind: "fixed",
    });
    const version = await runtime.pool.query<{ server_version: string }>("show server_version");
    databaseServerVersion = version.rows[0]?.server_version ?? "unknown";

    inboundEventStore = new DrizzleInboundEventStore(embeddedBatch);
    jobQueue = new DrizzleJobQueue();
    outboundMessageStore = new DrizzleOutboundMessageStore();
    const leadRepository = new DrizzleLeadRepository();
    const conversationRepository = new DrizzleConversationRepository();
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

    const v1Handler = observeHandler(
      new ConversationOrchestrator({ suppressAuxiliaryExternalEffects: true }),
      observations,
    );
    const state = new ConversationStateMachine();
    const reservations = new SlotReservationService();
    const calendar = createCalendar();
    const appointmentRepository = new DrizzleAppointmentRepository();
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
    const v2Handler = observeHandler(new V2LiveConversationHandler({
      lifecycle: v2Lifecycle,
      understanding: v2Understanding,
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
      resolveTurnConfiguration: async () => ({
        gateInput: {
          automationEnabled: true,
          duplicate: false,
          humanControlled: false,
          optedOut: false,
        },
        policy: {
          priceDisclosureEnabled: true,
          humanEscalationRequired: false,
          schedulingMinimumLeadTimeHours: 2,
          schedulingRequiresEvaluationFirst: false,
        },
        style: { tone: "warm", verbosity: "concise", greeting: "omit", emoji: "none" },
        speaker: {
          agentName: "Runtime",
          organizationName: "Runtime measurement",
          specialty: "dental",
          toneOfVoice: "neutral",
          guidelines: [],
        },
        useVoice: false,
        ttsConfig: { provider: "nova", speed: 1 },
        deliveryBinding: {
          schemaVersion: "conversation-v2.internal-lab-delivery-binding.v1",
          tenantDigest: `sha256:${"1".repeat(64)}`,
          channelDigest: `sha256:${"2".repeat(64)}`,
          configDigest: `sha256:${"3".repeat(64)}`,
        },
      }),
      outbound: { outboundMessageStore, jobQueue },
      persistStopContact: async () => {},
      now: fixedDate,
    }), observations);

    const processDependencies = {
      inboundEventStore,
      automationPolicy: new DrizzleClinicAutomationPolicyReader(),
      inboundHistoryRegistrar,
      transcribeAudio: async () => { throw new Error("runtime text fixtures never transcribe audio"); },
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

  async function runTurn(arm: ArmName, fixture: CorpusCase, repetition: number): Promise<void> {
    const turnIndex = repetition * fixtures.length + fixtures.indexOf(fixture);
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

    v1Model.begin(fixture.caseId);
    activeV2Fixture = fixture;
    activeV2Calls = 0;
    activeV2Tokens = 0;
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
      const telemetry = arm === "v1_current"
        ? v1Model.snapshot()
        : { calls: activeV2Calls, tokens: activeV2Tokens };
      expect(telemetry.calls).toBeGreaterThan(0);
      expect(telemetry.tokens).toBeGreaterThan(0);
      samples[arm].push(Object.freeze({ latencyMs, modelCalls: telemetry.calls, tokens: telemetry.tokens, sql, cardinality }));
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
      version: "v2-only-runtime-performance.v1",
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
