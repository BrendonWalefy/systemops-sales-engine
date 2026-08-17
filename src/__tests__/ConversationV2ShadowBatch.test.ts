import { describe, expect, it, vi } from "vitest";
import {
  createShadowTurnCaptureRegistry,
  runAfterSenderDrainAttempt,
  runConversationV2ShadowBatch,
  type ShadowBatchTurn,
} from "@/application/conversation-v2/run-shadow-batch";
import { V1ObservationCollector } from "@/application/conversation-v2/v1-observation-collector";
import type { V1TurnObservationEvent } from "@/core/observability/V1TurnObservation";

const recordConfig = {
  hmacKey: "cycle-i-test-key-with-at-least-32-characters",
  commit: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
  datasetDigest: null,
  allowedModelIds: new Set<string>(),
} as const;

function capturedTurn(input: {
  turnId: string;
  clinicId: string;
  ready?: boolean;
}): ShadowBatchTurn {
  const collector = new V1ObservationCollector();
  const record = (event: V1TurnObservationEvent) => collector.record(event);
  record({ kind: "turn_input", turnId: input.turnId, now: "2026-08-16T12:00:00.000Z", leadMessage: "mensagem somente in-memory" });
  for (const fact of [
    ["automationEnabled", true, "job_automation"],
    ["duplicate", false, "v1_dedupe"],
    ["humanControlled", false, "v1_human_control"],
    ["optedOut", false, "v1_opt_out"],
  ] as const) record({ kind: "turn_gate_fact", turnId: input.turnId, field: fact[0], value: fact[1], source: fact[2] });
  record({
    kind: "turn_context",
    turnId: input.turnId,
    phase: "active",
    pendingStepId: null,
    completedStepIds: input.ready
      ? { status: "captured", value: [] }
      : { status: "unavailable", reason: "not_read_by_v1" },
    history: [],
  });
  record({
    kind: "tenant_snapshot",
    turnId: input.turnId,
    configFingerprint: `config-${input.clinicId}`,
    policy: input.ready
      ? { status: "captured", value: { priceDisclosureEnabled: true, humanEscalationRequired: false, schedulingMinimumLeadTimeHours: 2, schedulingRequiresEvaluationFirst: false } }
      : { status: "unavailable", reason: "not_read_by_v1" },
    catalog: [],
  });
  record({ kind: "turn_terminal", turnId: input.turnId, replied: true, reason: null });
  const turn = collector.complete(input.turnId)!;
  const registry = createShadowTurnCaptureRegistry();
  registry.bindTurn({ turnId: input.turnId, clinicId: input.clinicId });
  return registry.promote(turn);
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    policyReader: {
      getConversationEnginePolicy: vi.fn(async (clinicId: string) => ({
        clinicId,
        engine: "v1_with_v2_shadow" as const,
        isTest: false,
      })),
    },
    evaluator: {
      evaluate: vi.fn(async () => ({
        result: { status: "unsupported" as const, reason: "unsupported_request" as const },
        understandingRequest: null,
        model: null,
      })),
    },
    sink: { append: vi.fn().mockResolvedValue(undefined) },
    approval: null,
    maxTurns: 10,
    deadlineMs: 1_000,
    now: () => 0,
    recordConfig,
    ...overrides,
  };
}

async function runRegisteredBatch(
  input: Omit<Parameters<typeof runConversationV2ShadowBatch>[0], "senderBarrier">,
  outcome: "completed" | "failed_handled" = "completed",
) {
  const postSender = await runAfterSenderDrainAttempt({
    drainSender: async () => {
      if (outcome === "failed_handled") throw new Error("handled sender failure");
    },
    onSenderFailure: () => undefined,
    occurredAt: () => "2026-08-16T12:00:00.000Z",
    afterAttempt: (senderBarrier) => runConversationV2ShadowBatch({
      senderBarrier,
      ...input,
    }),
  });
  return postSender.shadowResult;
}

describe("Cycle I post-sender shadow batch", () => {
  it.each(["completed", "failed_handled"] as const)(
    "creates a registered %s barrier only after the awaited sender attempt settles",
    async (outcome) => {
      const order: string[] = [];
      let release!: () => void;
      const sender = new Promise<void>((resolve) => { release = resolve; });
      const run = runAfterSenderDrainAttempt({
        drainSender: async () => {
          order.push("sender-start");
          await sender;
          order.push("sender-settled");
          if (outcome === "failed_handled") throw new Error("handled send failure");
          return "sender-result";
        },
        onSenderFailure: () => { order.push("sender-failure-handled"); },
        occurredAt: () => "2026-08-16T12:00:00.000Z",
        afterAttempt: async (barrier) => {
          order.push("shadow-start");
          await expect(runConversationV2ShadowBatch({
            senderBarrier: barrier,
            turns: [],
            ...deps(),
          })).resolves.toMatchObject({ received: 0 });
          return "shadow-result";
        },
      });
      await Promise.resolve();
      expect(order).toEqual(["sender-start"]);
      release();
      await expect(run).resolves.toEqual(expect.objectContaining({
        senderOutcome: outcome,
        shadowResult: "shadow-result",
      }));
      expect(order.at(-1)).toBe("shadow-start");
      expect(order.indexOf("shadow-start")).toBeGreaterThan(order.indexOf("sender-settled"));
      if (outcome === "failed_handled") {
        expect(order.indexOf("shadow-start")).toBeGreaterThan(order.indexOf("sender-failure-handled"));
      }
    },
  );

  it("rejects forged barriers and turn envelopes, including rebuilt aliases", async () => {
    const turn = capturedTurn({ turnId: "turn-1", clinicId: "clinic-a", ready: true });
    await expect(runConversationV2ShadowBatch({
      senderBarrier: { outcome: "completed", occurredAt: "2026-08-16T12:00:00.000Z" } as never,
      turns: [turn],
      ...deps(),
    })).rejects.toThrow(/barrier|registered/i);
    await expect(runRegisteredBatch({
      turns: [{ ...turn }] as never,
      ...deps(),
    })).rejects.toThrow(/turn|registered/i);
  });

  it("rejects proxy/accessor turn arrays before executing traps", async () => {
    const turn = capturedTurn({ turnId: "turn-1", clinicId: "clinic-a", ready: true });
    let reads = 0;
    const proxy = new Proxy([turn], {
      get(target, key, receiver) {
        reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(runRegisteredBatch({ turns: proxy, ...deps() })).rejects.toThrow(/turn|array|batch/i);
    expect(reads).toBe(0);

    const accessor: ShadowBatchTurn[] = [];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        reads += 1;
        return turn;
      },
    });
    Object.defineProperty(accessor, "length", { value: 1 });
    await expect(runRegisteredBatch({ turns: accessor, ...deps() })).rejects.toThrow(/turn|array|batch/i);
    expect(reads).toBe(0);
  });

  it("uses one immutable turn-array snapshot across awaited policy reads", async () => {
    const turnA = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
    const turnB = capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true });
    const turns = [turnA, turnB];
    let release!: () => void;
    const firstPolicy = new Promise<void>((resolve) => { release = resolve; });
    const policyReader = {
      getConversationEnginePolicy: vi.fn(async (clinicId: string) => {
        if (clinicId === "clinic-a") await firstPolicy;
        return { clinicId, engine: "v1_with_v2_shadow" as const, isTest: false };
      }),
    };
    const input = deps({ policyReader });
    const running = runRegisteredBatch({ turns, ...input });
    await Promise.resolve();
    turns[1] = { ...turnA } as never;
    release();

    await expect(running).resolves.toMatchObject({ received: 2, selected: 2, persisted: 2 });
    expect(policyReader.getConversationEnginePolicy.mock.calls.map(([clinicId]) => clinicId))
      .toEqual(["clinic-a", "clinic-b"]);
  });

  it("binds tenant to the factory turn id and rejects mismatches/reconstructed V1 turns", () => {
    const registry = createShadowTurnCaptureRegistry();
    registry.bindTurn({ turnId: "turn-a", clinicId: "clinic-a" });
    expect(() => registry.bindTurn({ turnId: "turn-a", clinicId: "clinic-b" })).toThrow(/clinic|binding/i);

    const registered = capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true });
    expect(() => registry.promote(registered.turn)).toThrow(/tenant|binding/i);
    expect(() => registry.promote({ ...registered.turn } as never)).toThrow(/registered/i);
  });

  it("persists explicit shared_read_unavailable without calling the V2 evaluator or leaking text", async () => {
    const unavailable = capturedTurn({ turnId: "turn-secret", clinicId: "clinic-a" });
    const input = deps();
    const result = await runRegisteredBatch({
      turns: [unavailable],
      ...input,
    });
    expect(input.evaluator.evaluate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ received: 1, selected: 1, unsupported: 1, persisted: 1 });
    const persisted = input.sink.append.mock.calls[0]![0];
    expect(persisted.clinicId).toBe("clinic-a");
    expect(persisted.record.v2.errorCode).toBe("shared_read_unavailable");
    expect(JSON.stringify(persisted)).not.toContain("mensagem somente in-memory");
    expect(JSON.stringify(persisted)).not.toContain("turn-secret");
  });

  it("resolves policy once per tenant/turn without cross-tenant cache", async () => {
    const turns = [
      capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true }),
      capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true }),
      capturedTurn({ turnId: "turn-c", clinicId: "clinic-a", ready: true }),
    ];
    const input = deps();
    const result = await runRegisteredBatch({
      turns,
      ...input,
    });
    expect(input.policyReader.getConversationEnginePolicy.mock.calls.map(([id]) => id)).toEqual([
      "clinic-a", "clinic-b", "clinic-a",
    ]);
    expect(result).toMatchObject({ received: 3, selected: 3, attempted: 3, persisted: 3 });
  });

  it("fails closed when a policy reader returns a different tenant", async () => {
    const turn = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
    const input = deps({
      policyReader: {
        getConversationEnginePolicy: vi.fn().mockResolvedValue({
          clinicId: "clinic-b",
          engine: "v1_with_v2_shadow",
          isTest: false,
        }),
      },
    });
    await expect(runRegisteredBatch({
      turns: [turn],
      ...input,
    })).resolves.toMatchObject({ policyErrors: 1, selected: 0, attempted: 0 });
    expect(input.evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("rejects a weak HMAC configuration before evaluation or persistence", async () => {
    const turn = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
    const input = deps({ recordConfig: { ...recordConfig, hmacKey: "too-short" } });
    await expect(runRegisteredBatch({
      turns: [turn],
      ...input,
    })).rejects.toThrow(/HMAC/i);
    expect(input.evaluator.evaluate).not.toHaveBeenCalled();
    expect(input.sink.append).not.toHaveBeenCalled();
  });

  it("skips v1 and v2_internal policies and never treats shadowModeEnabled as selection", async () => {
    const turns = [
      capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true }),
      capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true }),
    ];
    const input = deps({
      policyReader: {
        getConversationEnginePolicy: vi.fn(async (clinicId: string) => ({
          clinicId,
          engine: clinicId === "clinic-a" ? "v1" as const : "v2_internal" as const,
          isTest: true,
        })),
      },
    });
    const result = await runRegisteredBatch({
      turns,
      ...input,
    });
    expect(result).toMatchObject({ received: 2, selected: 0, attempted: 0, skipped: 2 });
  });

  it("honors empty batch, maxTurns and deadline before starting extra model work", async () => {
    await expect(runRegisteredBatch({ turns: [], ...deps() }))
      .resolves.toMatchObject({ received: 0, attempted: 0 });

    const turns = [
      capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true }),
      capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true }),
    ];
    const limited = deps({ maxTurns: 1 });
    await expect(runRegisteredBatch({ turns, ...limited }))
      .resolves.toMatchObject({ attempted: 1, skipped: 1, maxTurnsReached: true });
    expect(limited.evaluator.evaluate).toHaveBeenCalledTimes(1);

    const ticks = [0, 10, 10];
    const expired = deps({ deadlineMs: 5, now: () => ticks.shift() ?? 10 });
    await expect(runRegisteredBatch({ turns, ...expired }))
      .resolves.toMatchObject({ attempted: 0, skipped: 2, deadlineReached: true });
    expect(expired.evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("awaits and bounds a hanging evaluator by the remaining batch deadline", async () => {
    const turn = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
    const input = deps({
      deadlineMs: 10,
      evaluator: { evaluate: vi.fn(() => new Promise<never>(() => undefined)) },
    });
    const startedAt = Date.now();

    await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({
      received: 1,
      attempted: 1,
      evaluationErrors: 1,
      persisted: 1,
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it.each(["policy", "sink"] as const)(
    "bounds a hanging %s dependency by the same batch deadline",
    async (dependency) => {
      const turn = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
      const never = () => new Promise<never>(() => undefined);
      const input = deps({
        deadlineMs: 10,
        ...(dependency === "policy"
          ? { policyReader: { getConversationEnginePolicy: vi.fn(never) } }
          : { sink: { append: vi.fn(never) } }),
      });
      const startedAt = Date.now();

      await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject(
        dependency === "policy"
          ? { received: 1, policyErrors: 1, attempted: 0, persisted: 0 }
          : { received: 1, selected: 1, attempted: 1, sinkErrors: 1, persisted: 0 },
      );
      expect(Date.now() - startedAt).toBeLessThan(500);
    },
  );

  it("contains policy, evaluator and sink failures per turn and continues the batch", async () => {
    const turns = [
      capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true }),
      capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true }),
      capturedTurn({ turnId: "turn-c", clinicId: "clinic-c", ready: true }),
    ];
    const policyReader = {
      getConversationEnginePolicy: vi.fn(async (clinicId: string) => {
        if (clinicId === "clinic-a") throw new Error("policy down");
        return { clinicId, engine: "v1_with_v2_shadow" as const, isTest: false };
      }),
    };
    const evaluator = {
      evaluate: vi.fn(async () => {
        if (evaluator.evaluate.mock.calls.length === 1) throw new Error("provider down");
        return { result: { status: "unsupported" as const, reason: "unsupported_request" as const }, understandingRequest: null, model: null };
      }),
    };
    const sink = { append: vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined) };
    const result = await runRegisteredBatch({
      turns,
      ...deps({ policyReader, evaluator, sink }),
    }, "failed_handled");
    expect(result).toMatchObject({ received: 3, policyErrors: 1, evaluationErrors: 1, sinkErrors: 1 });
    expect(policyReader.getConversationEnginePolicy).toHaveBeenCalledTimes(3);
  });
});
