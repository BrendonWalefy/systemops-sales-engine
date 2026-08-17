import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConversationV2Runtime } from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";
import { V1ObservationCollector } from "@/application/conversation-v2/v1-observation-collector";
import type { V1TurnObservationEvent } from "@/core/observability/V1TurnObservation";
import {
  runAfterSenderDrainAttempt,
  runConversationV2ShadowBatch,
} from "@/application/conversation-v2/run-shadow-batch";

const openAiCreate = vi.hoisted(() => vi.fn());
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  return {
    ...actual,
    default: class OpenAITestClient {
      readonly chat = { completions: { create: openAiCreate } };
    },
  };
});

function readyEvents(turnId: string): V1TurnObservationEvent[] {
  return [
    { kind: "turn_input", turnId, now: "2026-08-16T12:00:00.000Z", leadMessage: "Olá" },
    { kind: "turn_gate_fact", turnId, field: "automationEnabled", value: true, source: "job_automation" },
    { kind: "turn_gate_fact", turnId, field: "duplicate", value: false, source: "v1_dedupe" },
    { kind: "turn_gate_fact", turnId, field: "humanControlled", value: false, source: "v1_human_control" },
    { kind: "turn_gate_fact", turnId, field: "optedOut", value: false, source: "v1_opt_out" },
    { kind: "turn_context", turnId, phase: "active", pendingStepId: null, completedStepIds: { status: "captured", value: [] }, history: [] },
    { kind: "tenant_snapshot", turnId, configFingerprint: "config-a", policy: { status: "captured", value: { priceDisclosureEnabled: true, humanEscalationRequired: false, schedulingMinimumLeadTimeHours: 2, schedulingRequiresEvaluationFirst: false } }, catalog: [] },
    { kind: "turn_terminal", turnId, replied: true, reason: null },
  ];
}

describe("Cycle I message worker composition", () => {
  beforeEach(() => openAiCreate.mockReset());

  it("binds tenant in the turn-local sink and promotes before exposing the batch", () => {
    const runtime = createConversationV2Runtime({
      env: {
        CONVERSATION_V2_COMPARISON_HMAC_KEY: "x".repeat(32),
        VERCEL_GIT_COMMIT_SHA: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
      },
      collector: new V1ObservationCollector(),
    });
    const sink = runtime.createTurnObservationSink({
      turnId: "turn-a",
      clinicId: "clinic-a",
      automationMode: "live",
    });
    for (const event of readyEvents("turn-a")) sink.record(event);

    const turns = runtime.drainCapturedTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ clinicId: "clinic-a", promotion: { status: "ready" } });
    expect(Object.isFrozen(turns[0])).toBe(true);
    expect(runtime.drainCapturedTurns()).toEqual([]);
  });

  it("keeps interleaved live turns bound to their own tenant during promotion", async () => {
    const runtime = createConversationV2Runtime({
      env: {
        CONVERSATION_V2_COMPARISON_HMAC_KEY: "x".repeat(32),
        VERCEL_GIT_COMMIT_SHA: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
      },
      collector: new V1ObservationCollector(),
    });
    const sinkA = runtime.createTurnObservationSink({
      turnId: "turn-a",
      clinicId: "clinic-a",
      automationMode: "live",
    });
    const sinkB = runtime.createTurnObservationSink({
      turnId: "turn-b",
      clinicId: "clinic-b",
      automationMode: "live",
    });
    const eventsA = readyEvents("turn-a");
    const eventsB = readyEvents("turn-b");
    await Promise.all([
      (async () => {
        for (const event of eventsA) {
          sinkA.record(event);
          await Promise.resolve();
        }
      })(),
      (async () => {
        for (const event of eventsB) {
          sinkB.record(event);
          await Promise.resolve();
        }
      })(),
    ]);

    expect(runtime.drainCapturedTurns().map(({ clinicId, turn }) => [clinicId, turn.turnId]))
      .toEqual(expect.arrayContaining([
        ["clinic-a", "turn-a"],
        ["clinic-b", "turn-b"],
      ]));
  });

  it("turns missing OpenAI configuration into a closed evaluator error without provider work", async () => {
    const runtime = createConversationV2Runtime({
      env: {
        CONVERSATION_V2_COMPARISON_HMAC_KEY: "x".repeat(32),
        VERCEL_GIT_COMMIT_SHA: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
      },
      collector: new V1ObservationCollector(),
    });
    const sink = runtime.createTurnObservationSink({
      turnId: "turn-a",
      clinicId: "clinic-a",
      automationMode: "live",
    });
    for (const event of readyEvents("turn-a")) sink.record(event);
    const turn = runtime.drainCapturedTurns()[0]!;
    if (turn.promotion.status !== "ready") throw new Error("expected ready turn");

    await expect(runtime.evaluator.evaluate(
      turn.promotion.reads,
      new AbortController().signal,
    )).resolves.toEqual({
      result: { status: "error", errorName: "MissingOpenAIKey" },
      understandingRequest: null,
      model: null,
    });
  });

  it.each([
    ["duplicate", {
      gateInput: { status: "captured", value: { automationEnabled: true, duplicate: true, humanControlled: false, optedOut: false } },
      catalog: { status: "captured", value: [] },
    }],
    ["shared read unavailable", {
      gateInput: { status: "captured", value: { automationEnabled: true, duplicate: false, humanControlled: false, optedOut: false } },
      catalog: { status: "unavailable", reason: "not_read_by_v1" },
    }],
  ] as const)("counts no model call when %s stops before the provider callback", async (_case, override) => {
    const runtime = createConversationV2Runtime({
      env: {
        OPENAI_API_KEY: "configured-but-must-not-be-used",
        CONVERSATION_V2_COMPARISON_HMAC_KEY: "x".repeat(32),
        VERCEL_GIT_COMMIT_SHA: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
      },
      collector: new V1ObservationCollector(),
    });
    const sink = runtime.createTurnObservationSink({
      turnId: `turn-${_case}`,
      clinicId: "clinic-a",
      automationMode: "live",
    });
    for (const event of readyEvents(`turn-${_case}`)) sink.record(event);
    const turn = runtime.drainCapturedTurns()[0]!;
    if (turn.promotion.status !== "ready") throw new Error("expected ready turn");
    const reads = {
      ...turn.promotion.reads,
      gateInput: override.gateInput,
      catalog: override.catalog,
    } as typeof turn.promotion.reads;

    const result = await runtime.evaluator.evaluate(reads, new AbortController().signal);

    expect(result.model).toBeNull();
    expect(result.understandingRequest).toBeNull();
    expect(result.result).toMatchObject({ status: "unsupported" });
    expect(openAiCreate).not.toHaveBeenCalled();
  });

  it("preserves one real provider call when the post-provider runner result is unsupported", async () => {
    openAiCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      version: "understanding.v1",
      request: "price-of-service",
      dialogueMove: "new_topic",
      entities: { service: "limpeza", date: null, period: null, time: null, serviceCandidates: null, quantity: null, ordinal: null },
      signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
      safety: { optOut: false, requestsHuman: false, emergency: false },
      confidence: 1,
      ambiguity: null,
    }) } }] });
    const policyReader = {
      getConversationEnginePolicy: vi.fn(async (clinicId: string) => ({
        clinicId,
        engine: "v1_with_v2_shadow" as const,
        isTest: true,
      })),
    };
    const comparisonSink = { append: vi.fn().mockResolvedValue(undefined) };
    const runtime = createConversationV2Runtime({
      env: {
        OPENAI_API_KEY: "test-only",
        OPENAI_V2_UNDERSTANDING_MODEL: "gpt-test",
        CONVERSATION_V2_COMPARISON_HMAC_KEY: "x".repeat(32),
        VERCEL_GIT_COMMIT_SHA: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
      },
      policyReader,
      comparisonSink,
      collector: new V1ObservationCollector(),
    });
    const observation = runtime.createTurnObservationSink({
      turnId: "turn-post-provider-unsupported",
      clinicId: "clinic-a",
      automationMode: "live",
    });
    for (const event of readyEvents("turn-post-provider-unsupported")) observation.record(event);
    const turns = runtime.drainCapturedTurns();

    await runAfterSenderDrainAttempt({
      turns,
      drainSender: async () => undefined,
      onSenderFailure: () => undefined,
      occurredAt: () => "2026-08-16T12:00:00.000Z",
      afterAttempt: (senderBarrier, captured) => runConversationV2ShadowBatch({
        senderBarrier,
        turns: captured,
        policyReader: runtime.policyReader,
        evaluator: runtime.evaluator,
        sink: runtime.sink,
        approval: runtime.approval,
        runtimeIdentity: runtime.runtimeIdentity,
        maxTurns: runtime.maxTurns,
        deadlineMs: runtime.deadlineMs,
        now: runtime.now,
        recordConfig: runtime.recordConfig,
      }),
    });

    expect(openAiCreate).toHaveBeenCalledOnce();
    expect(comparisonSink.append).toHaveBeenCalledOnce();
    expect(comparisonSink.append.mock.calls[0]![0].record.v2).toMatchObject({
      status: "unsupported",
      errorCode: "shared_read_unavailable",
      model: {
        modelId: "gpt-test",
        calls: 1,
        inputTokens: null,
        outputTokens: null,
        estimatedCostMinor: null,
      },
    });
  });

  it("keeps route composition thin, post-sender, and independent from legacy shadowModeEnabled", () => {
    const source = readFileSync("src/app/api/cron/message-worker/route.ts", "utf8");
    expect(source).toContain("createConversationV2Runtime");
    expect(source).toContain("runAfterSenderDrainAttempt");
    expect(source).not.toContain("shadowModeEnabled");
    expect(source).not.toMatch(/Dental|bookSlot|confirmAppointment|OpenAI/);
    const processCall = source.indexOf("await drainMessageProcessQueue({");
    const senderBarrierCall = source.indexOf("await runAfterSenderDrainAttempt({");
    const shadowBatchCall = source.indexOf("await runConversationV2ShadowBatch({");
    expect(processCall).toBeGreaterThanOrEqual(0);
    expect(senderBarrierCall).toBeGreaterThan(processCall);
    expect(shadowBatchCall).toBeGreaterThan(senderBarrierCall);
    expect(source.indexOf('log.info("conversation_v2.engine_selected"'))
      .toBeGreaterThan(shadowBatchCall);
  });

  it("does not cache policy in runtime assembly", async () => {
    const policyReader = { getConversationEnginePolicy: vi.fn() };
    const runtime = createConversationV2Runtime({
      env: {
        CONVERSATION_V2_COMPARISON_HMAC_KEY: "x".repeat(32),
        VERCEL_GIT_COMMIT_SHA: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
      },
      policyReader: policyReader as never,
      collector: new V1ObservationCollector(),
    });
    expect(runtime.policyReader).toBe(policyReader);
    expect(policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
  });

  it("freezes the actual deterministic V1 model ids in the live allowlist", () => {
    const runtime = createConversationV2Runtime({
      env: {
        CONVERSATION_V2_COMPARISON_HMAC_KEY: "x".repeat(32),
        VERCEL_GIT_COMMIT_SHA: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
      },
      collector: new V1ObservationCollector(),
    });
    expect(runtime.recordConfig.allowedModelIds).toEqual(expect.arrayContaining([
      "deterministic-safety",
      "deterministic-fallback",
      "gpt-4o-mini",
    ]));
    expect(() => (runtime.recordConfig.allowedModelIds as string[]).push("unapproved-model"))
      .toThrow();
    expect(runtime.recordConfig.allowedModelIds.includes("unapproved-model")).toBe(false);
  });
});
