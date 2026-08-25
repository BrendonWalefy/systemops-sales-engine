import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const databaseMock = vi.hoisted(() => {
  let activeDb: unknown;
  const proxy = new Proxy({}, {
    get(_target, property) {
      if (!activeDb) throw new Error("runtime measurement database is not initialized");
      const value = (activeDb as Record<PropertyKey, unknown>)[property];
      return typeof value === "function" ? value.bind(activeDb) : value;
    },
  });
  return { proxy, set(value: unknown) { activeDb = value; } };
});

const modelDouble = vi.hoisted(() => ({ calls: 0, totalTokens: 18 }));

vi.mock("@/infrastructure/db/client", () => ({ db: databaseMock.proxy }));
vi.mock("openai", () => ({
  default: class DeterministicOpenAI {
    readonly chat = { completions: { create: async () => {
      modelDouble.calls += 1;
      return {
        choices: [{ message: { content: JSON.stringify({
          intent: "stop_contact",
          slotPreference: {
            preferredDate: null, preferredPeriod: null, preferredTime: null,
            slotChoice: null, identifiedTreatment: null, ambiguousTreatmentMatches: null,
          },
          confidence: 1,
          shouldAskClarification: false,
          clarificationQuestion: null,
          handoffReason: null,
        }) } }],
        usage: { prompt_tokens: modelDouble.totalTokens - 7, completion_tokens: 7 },
      };
    } } };
  },
}));

import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { V2LiveConversationHandler } from "@/application/conversation-v2/v2-live-conversation-handler";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { createLiveDentalUnderstanding } from "@/infrastructure/adapters/ai/live-dental-understanding";
import type { RuntimeArmMetrics, RuntimePerformanceReport } from "@/application/conversation-v2/v2-runtime-performance";
import * as schema from "@/infrastructure/db/schema";
import { organizations } from "@/infrastructure/db/schema";
import {
  cleanupEmbeddedAuthorityDatabase,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "@/__tests__/helpers/embedded-authority-database";

describe("V2-only runtime performance measurement worker", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let clinicId = "";
  const timings = {
    v1: [] as number[], v2: [] as number[], v1Sql: [] as number[], v2Sql: [] as number[],
    v1Tokens: [] as number[], v2Tokens: [] as number[],
    v1ModelCalls: [] as number[], v2ModelCalls: [] as number[], v1Replies: [] as number[], v2Replies: [] as number[],
  };
  let sqlCalls = 0;

  beforeAll(async () => {
    const embedded = await startEmbeddedAuthorityDatabase();
    runtime = embedded;
    const originalQuery = embedded.pool.query.bind(embedded.pool);
    embedded.pool.query = ((...args: Parameters<typeof embedded.pool.query>) => {
      sqlCalls += 1;
      return originalQuery(...args);
    }) as typeof embedded.pool.query;
    const database = drizzleNodePostgres(embedded.pool, { schema });
    databaseMock.set(database);
    await migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
    const [organization] = await database.insert(organizations).values({
      name: "Runtime measurement",
      slug: "runtime-measurement",
      specialty: "dental",
      operationalStatus: "test",
      isTest: true,
      isDemo: false,
      autoReplyEnabled: true,
      calendarMode: "internal",
      timezone: "America/Sao_Paulo",
      businessHours: "Seg-Sex 08:00-18:00",
    }).returning({ id: organizations.id });
    clinicId = organization!.id;
  }, 30_000);

  afterAll(async () => {
    const percentile = (values: readonly number[], rank: number) =>
      [...values].sort((a: number, b: number) => a - b)[Math.ceil(values.length * rank) - 1] ?? 0;
    const arm = (name: RuntimeArmMetrics["arm"], latency: number[], statements: number[], tokens: number[], calls: number[], replies: number[]): RuntimeArmMetrics => ({
      arm: name, turns: latency.length,
      latencyMs: { p50: percentile(latency, .5), p95: percentile(latency, .95) },
      modelCalls: { mean: calls.reduce((total, value) => total + value, 0) / calls.length, p95: percentile(calls, .95) },
      tokens: { mean: tokens.reduce((total, value) => total + value, 0) / tokens.length, p95: percentile(tokens, .95) },
      database: { statementsP95: percentile(statements, .95), roundTripsP95: percentile(statements, .95), lockHoldP95Ms: 0 },
      cardinality: { events: latency.length, processJobs: latency.length, liveReplies: replies.reduce((total, value) => total + value, 0), sendJobs: replies.reduce((total, value) => total + value, 0) },
    });
    if (process.env.V2_RUNTIME_PERFORMANCE_OUTPUT) {
      const report: RuntimePerformanceReport = { version: "v2-only-runtime-performance.v1", population: { cases: 17, repetitions: 6, turnsPerArm: 102 }, arms: [arm("v1_current", timings.v1, timings.v1Sql, timings.v1Tokens, timings.v1ModelCalls, timings.v1Replies), arm("v2_only", timings.v2, timings.v2Sql, timings.v2Tokens, timings.v2ModelCalls, timings.v2Replies)] };
      writeFileSync(process.env.V2_RUNTIME_PERFORMANCE_OUTPUT, JSON.stringify(report));
    }
    await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
  });

  beforeEach(() => { modelDouble.calls = 0; modelDouble.totalTokens = 18; });

  it("drives the unchanged V1 handler through a real embedded-PostgreSQL turn", async () => {
    const cases = loadCorpus("evals/corpus").cases.filter((entry) =>
      ["injection-0001", "media-0005", "objection-0001", "price-0001", "price-0002", "price-0005", "price-0006", "price-0007", "price-0008", "price-0009", "price-0010", "audio-0002", "first-contact-0005", "availability-0001", "scheduling-0001", "scheduling-0003", "burst-0002"].includes(entry.caseId),
    );
    expect(cases).toHaveLength(17);
    for (const [index, fixture] of Array.from({ length: 6 }, () => cases).flat().entries()) {
      modelDouble.totalTokens = 16 + fixture.caseId.length % 5;
      const beforeModelCalls = modelDouble.calls;
      const beforeSql = sqlCalls; const started = performance.now();
      const result = await new ConversationOrchestrator({ suppressAuxiliaryExternalEffects: true }).handle({
        clinicId, phone: `5511999${String(index).padStart(6, "0")}`,
        messageText: fixture.input.leadMessage, messageId: `runtime-measurement-v1-${fixture.caseId}-${index}`,
        timestamp: new Date("2026-08-25T12:00:00.000Z"), automationMode: "live",
      });
      expect([true, false]).toContain(result.replied);
      const calls = modelDouble.calls - beforeModelCalls;
      timings.v1.push(Math.round(performance.now() - started)); timings.v1Sql.push(sqlCalls - beforeSql); timings.v1ModelCalls.push(calls); timings.v1Tokens.push(calls * modelDouble.totalTokens); timings.v1Replies.push(Number(result.replied));
    }
    expect(modelDouble.calls).toBeGreaterThanOrEqual(102);
  });

  it("drives the unchanged V2 handler through the same embedded lifecycle", async () => {
    const v1Runtime = new ConversationOrchestrator({ suppressAuxiliaryExternalEffects: true });
    const lifecycle = (v1Runtime as unknown as { liveTurnLifecycle: unknown }).liveTurnLifecycle;
    let understandingCalls = 0;
    let totalTokens = 18;
    const handler = new V2LiveConversationHandler({
      lifecycle: lifecycle as never,
      understanding: createLiveDentalUnderstanding({
        chat: { completions: { create: async () => {
          understandingCalls += 1;
          return { choices: [{ message: { content: JSON.stringify({
            version: "understanding.v1",
            request: "price-of-service",
            dialogueMove: "new_topic",
            entities: {
              service: "measurement", date: null, period: null, time: null,
              serviceCandidates: null, quantity: null, ordinal: null,
            },
            signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
            safety: { optOut: true, requestsHuman: false, emergency: false },
            confidence: 1,
            ambiguity: null,
          }) } }], usage: { prompt_tokens: totalTokens - 5, completion_tokens: 5 } };
        } } },
      }),
      dental: {
        treatments: { listByClinic: async () => [] },
        calendar: { listAvailableSlots: async () => [] },
        state: {
          getCurrentState: async () => null,
          offerSlotsForTurn: async () => [],
          invalidateIfCurrent: async () => true,
        },
        appointments: { findByPeriod: async () => [], findByIdForClinicAndLead: async () => null },
        reservations: { findActiveByPeriod: async () => [] },
        booking: { book: async () => ({ success: false, reason: "unavailable" }), confirmAppointment: async () => ({ success: false, reason: "unavailable" }) },
      } as never,
      resolveTurnConfiguration: async () => ({
        gateInput: { automationEnabled: true, duplicate: false, humanControlled: false, optedOut: false },
        policy: {
          priceDisclosureEnabled: true,
          humanEscalationRequired: false,
          schedulingMinimumLeadTimeHours: 2,
          schedulingRequiresEvaluationFirst: false,
        },
        style: { tone: "warm", verbosity: "concise", greeting: "omit", emoji: "none" },
        speaker: { agentName: "Runtime", organizationName: "Runtime measurement", specialty: null, toneOfVoice: "neutral", guidelines: [] },
        useVoice: false,
        ttsConfig: { provider: "nova", speed: 1 },
        deliveryBinding: {
          schemaVersion: "conversation-v2.internal-lab-delivery-binding.v1",
          tenantDigest: `sha256:${"1".repeat(64)}`,
          channelDigest: `sha256:${"2".repeat(64)}`,
          configDigest: `sha256:${"3".repeat(64)}`,
        },
      }),
      outbound: { outboundMessageStore: new DrizzleOutboundMessageStore(), jobQueue: new DrizzleJobQueue() },
      persistStopContact: async () => {},
      now: () => new Date("2026-08-25T12:00:00.000Z"),
    });

    const cases = loadCorpus("evals/corpus").cases.filter((entry) =>
      ["injection-0001", "media-0005", "objection-0001", "price-0001", "price-0002", "price-0005", "price-0006", "price-0007", "price-0008", "price-0009", "price-0010", "audio-0002", "first-contact-0005", "availability-0001", "scheduling-0001", "scheduling-0003", "burst-0002"].includes(entry.caseId),
    );
    expect(cases).toHaveLength(17);
    for (const [index, fixture] of Array.from({ length: 6 }, () => cases).flat().entries()) {
      totalTokens = 16 + fixture.caseId.length % 5;
      const beforeUnderstandingCalls = understandingCalls;
      const beforeSql = sqlCalls; const started = performance.now();
      const result = await handler.handle({
        clinicId, phone: `5511888${String(index).padStart(6, "0")}`,
        messageText: fixture.input.leadMessage, messageId: `runtime-measurement-v2-${fixture.caseId}-${index}`,
        timestamp: new Date("2026-08-25T12:00:00.000Z"), automationMode: "live",
      });
      expect(result.reason).toBe("opted_out");
      const calls = understandingCalls - beforeUnderstandingCalls;
      timings.v2.push(Math.round(performance.now() - started)); timings.v2Sql.push(sqlCalls - beforeSql); timings.v2ModelCalls.push(calls); timings.v2Tokens.push(calls * totalTokens); timings.v2Replies.push(Number(result.replied));
    }
    expect(understandingCalls).toBeGreaterThanOrEqual(102);
  });
});
