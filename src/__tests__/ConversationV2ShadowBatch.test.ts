import { describe, expect, it, vi } from "vitest";
import {
  createShadowTurnCaptureRegistry,
  runAfterSenderDrainAttempt,
  runConversationV2ShadowBatch,
  type ShadowBatchTurn,
} from "@/application/conversation-v2/run-shadow-batch";
import { V1ObservationCollector } from "@/application/conversation-v2/v1-observation-collector";
import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import type { V1TurnObservationEvent } from "@/core/observability/V1TurnObservation";

const recordConfig = {
  hmacKey: "cycle-i-test-key-with-at-least-32-characters",
  commit: "e86201adb3b7eb6665629f5e73cbb5964acdc745",
  datasetDigest: null,
  allowedModelIds: [] as const,
} as const;

function capturedTurn(input: {
  turnId: string;
  clinicId: string;
  ready?: boolean;
  automationMode?: ClinicAutomationMode;
  responsePlans?: readonly Readonly<{
    actionType: string;
    responseDigest: string;
    responseCharacters: number;
    modelId: string | null;
  }>[];
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
  for (const plan of input.responsePlans ?? []) {
    record({
      kind: "v1_response_plan",
      turnId: input.turnId,
      actionType: plan.actionType,
      outcomeSummary: "intermediate composer result",
      responseDigest: plan.responseDigest,
      responseCharacters: plan.responseCharacters,
      latencyMs: 10,
      modelId: plan.modelId,
      inputTokens: 20,
      outputTokens: 10,
    });
  }
  record({ kind: "turn_terminal", turnId: input.turnId, replied: true, reason: null });
  const turn = collector.complete(input.turnId)!;
  const registry = createShadowTurnCaptureRegistry();
  registry.bindTurn({
    turnId: input.turnId,
    clinicId: input.clinicId,
    automationMode: input.automationMode ?? "live",
  });
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
    selectionTrace: { record: vi.fn().mockResolvedValue(undefined) },
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
    turns: input.turns,
    drainSender: async () => {
      if (outcome === "failed_handled") throw new Error("handled sender failure");
    },
    onSenderFailure: () => undefined,
    occurredAt: () => "2026-08-16T12:00:00.000Z",
    afterAttempt: (senderBarrier, turns) => runConversationV2ShadowBatch({
      senderBarrier,
      ...input,
      turns,
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
        turns: [],
        drainSender: async () => {
          order.push("sender-start");
          await sender;
          order.push("sender-settled");
          if (outcome === "failed_handled") throw new Error("handled send failure");
          return "sender-result";
        },
        onSenderFailure: () => { order.push("sender-failure-handled"); },
        occurredAt: () => "2026-08-16T12:00:00.000Z",
        afterAttempt: async (barrier, turns) => {
          order.push("shadow-start");
          await expect(runConversationV2ShadowBatch({
            senderBarrier: barrier,
            turns,
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

  it("binds a single-use barrier to the exact canonical turn snapshot", async () => {
    const turnA = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
    const turnB = capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true });
    const input = deps();
    await expect(runAfterSenderDrainAttempt({
      turns: [turnA],
      drainSender: async () => undefined,
      onSenderFailure: () => undefined,
      occurredAt: () => "2026-08-16T12:00:00.000Z",
      afterAttempt: async (barrier) => {
        await expect(runConversationV2ShadowBatch({
          senderBarrier: barrier,
          turns: [turnB],
          ...input,
        })).rejects.toThrow(/barrier|batch|snapshot|registered/i);
        await expect(runConversationV2ShadowBatch({
          senderBarrier: barrier,
          turns: [turnA],
          ...input,
        })).rejects.toThrow(/barrier|consumed|registered/i);
      },
    })).resolves.toBeDefined();
    expect(input.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
  });

  it("rejects duplicate and reused turn envelopes before any dependency I/O", async () => {
    const duplicated = capturedTurn({ turnId: "turn-duplicate", clinicId: "clinic-a", ready: true });
    const duplicateInput = deps();
    await expect(runRegisteredBatch({ turns: [duplicated, duplicated], ...duplicateInput }))
      .rejects.toThrow(/duplicate|consumed|turn/i);
    expect(duplicateInput.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();

    const reused = capturedTurn({ turnId: "turn-reused", clinicId: "clinic-a", ready: true });
    const first = deps();
    await expect(runRegisteredBatch({ turns: [reused], ...first })).resolves.toMatchObject({ persisted: 1 });
    const second = deps();
    await expect(runRegisteredBatch({ turns: [reused], ...second }))
      .rejects.toThrow(/consumed|reused|turn/i);
    expect(second.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
  });

  it("allows only one concurrent batch to consume the same turn envelope", async () => {
    const turn = capturedTurn({ turnId: "turn-concurrent", clinicId: "clinic-a", ready: true });
    const first = deps();
    const second = deps();
    const results = await Promise.allSettled([
      runRegisteredBatch({ turns: [turn], ...first }),
      runRegisteredBatch({ turns: [turn], ...second }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(
      first.policyReader.getConversationEnginePolicy.mock.calls.length
      + second.policyReader.getConversationEnginePolicy.mock.calls.length,
    ).toBe(1);
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
    registry.bindTurn({ turnId: "turn-a", clinicId: "clinic-a", automationMode: "live" });
    expect(() => registry.bindTurn({
      turnId: "turn-a",
      clinicId: "clinic-b",
      automationMode: "live",
    })).toThrow(/clinic|binding/i);

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

  it("does not mislabel greeting or multi-compose V1 plans as the final outbound text", async () => {
    const turn = capturedTurn({
      turnId: "turn-multi-compose",
      clinicId: "clinic-a",
      ready: true,
      responsePlans: [
        { actionType: "greeting", responseDigest: "digest-greeting", responseCharacters: 12, modelId: "deterministic-fallback" },
        { actionType: "answer", responseDigest: "digest-answer", responseCharacters: 80, modelId: "gpt-4o-mini" },
      ],
    });
    const input = deps({
      recordConfig: {
        ...recordConfig,
        allowedModelIds: ["deterministic-fallback", "gpt-4o-mini"],
      },
    });

    await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({ persisted: 1 });
    expect(input.sink.append.mock.calls[0]![0].record.v1).toMatchObject({
      status: "observed",
      finalTextCharacters: null,
      finalTextDigest: null,
      model: null,
    });
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

  it.each([
    ["missing commit", { ...recordConfig, commit: "" }],
    ["invalid dataset digest", { ...recordConfig, datasetDigest: "raw-dataset-id" }],
    ["duplicate model id", { ...recordConfig, allowedModelIds: ["gpt-test", "gpt-test"] }],
    ["unknown config key", { ...recordConfig, extraAuthority: true }],
  ])("rejects %s before policy, evaluator, or sink I/O", async (_label, invalidConfig) => {
    const turn = capturedTurn({ turnId: `turn-invalid-${_label}`, clinicId: "clinic-a", ready: true });
    const input = deps({ recordConfig: invalidConfig });

    await expect(runRegisteredBatch({ turns: [turn], ...input })).rejects.toThrow(/config|commit|dataset|model|invalid/i);
    expect(input.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
    expect(input.evaluator.evaluate).not.toHaveBeenCalled();
    expect(input.sink.append).not.toHaveBeenCalled();
  });

  it("rejects proxy/accessor record config without executing traps or dependency I/O", async () => {
    let reads = 0;
    const proxy = new Proxy({ ...recordConfig }, {
      get(target, key, receiver) {
        reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const proxiedTurn = capturedTurn({ turnId: "turn-proxy-config", clinicId: "clinic-a", ready: true });
    const proxiedInput = deps({ recordConfig: proxy });
    await expect(runRegisteredBatch({ turns: [proxiedTurn], ...proxiedInput }))
      .rejects.toThrow(/config|invalid/i);
    expect(reads).toBe(0);
    expect(proxiedInput.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();

    const accessor = { ...recordConfig } as Record<string, unknown>;
    Object.defineProperty(accessor, "commit", {
      enumerable: true,
      get() {
        reads += 1;
        return recordConfig.commit;
      },
    });
    const accessorTurn = capturedTurn({ turnId: "turn-accessor-config", clinicId: "clinic-a", ready: true });
    const accessorInput = deps({ recordConfig: accessor });
    await expect(runRegisteredBatch({ turns: [accessorTurn], ...accessorInput }))
      .rejects.toThrow(/config|invalid/i);
    expect(reads).toBe(0);
    expect(accessorInput.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
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

  it.each(["disabled", "observe"] as const)(
    "preserves registered automation %s provenance and performs zero selector/model/write I/O",
    async (automationMode) => {
      const turn = capturedTurn({
        turnId: `turn-${automationMode}`,
        clinicId: "clinic-a",
        ready: true,
        automationMode,
      });
      const input = deps();

      await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({
        received: 1,
        selected: 0,
        attempted: 0,
        persisted: 0,
        skipped: 1,
      });
      expect(input.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
      expect(input.evaluator.evaluate).not.toHaveBeenCalled();
      expect(input.sink.append).not.toHaveBeenCalled();
      expect(input.selectionTrace.record).toHaveBeenCalledWith(expect.objectContaining({
        clinicId: "clinic-a",
        automationMode,
        configuredEngine: null,
        effectiveRoute: "v1",
        shadow: false,
        reason: "automation_not_live",
      }));
      expect(JSON.stringify(input.selectionTrace.record.mock.calls)).not.toContain(`turn-${automationMode}`);
    },
  );

  it("emits the sanitized effective selector route and reason for a live turn", async () => {
    const turn = capturedTurn({ turnId: "turn-selector-trace", clinicId: "clinic-a", ready: true });
    const input = deps({
      policyReader: {
        getConversationEnginePolicy: vi.fn().mockResolvedValue({
          clinicId: "clinic-a",
          engine: "v1",
          isTest: false,
        }),
      },
    });

    await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({ skipped: 1 });
    expect(input.selectionTrace.record).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: "clinic-a",
      automationMode: "live",
      configuredEngine: "v1",
      effectiveRoute: "v1",
      shadow: false,
      reason: "configured_v1",
      turnRef: expect.stringMatching(/^hmac:[a-f0-9]{64}$/),
    }));
    expect(JSON.stringify(input.selectionTrace.record.mock.calls)).not.toContain("turn-selector-trace");
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
    const expiredTurns = [
      capturedTurn({ turnId: "turn-expired-a", clinicId: "clinic-a", ready: true }),
      capturedTurn({ turnId: "turn-expired-b", clinicId: "clinic-b", ready: true }),
    ];
    await expect(runRegisteredBatch({ turns: expiredTurns, ...expired }))
      .resolves.toMatchObject({ attempted: 0, skipped: 2, deadlineReached: true });
    expect(expired.evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("aborts and awaits the evaluator at the deadline without work surviving the summary", async () => {
    const turn = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
    let settled = false;
    const input = deps({
      deadlineMs: 10,
      now: () => Date.now(),
      evaluator: {
        evaluate: vi.fn((_reads: unknown, signal?: AbortSignal) => new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            settled = true;
            resolve({ result: { status: "unsupported", reason: "unsupported_request" }, understandingRequest: null, model: null });
          }, 100);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            settled = true;
            reject(new Error("aborted"));
          }, { once: true });
        })),
      },
    });

    await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({
      received: 1,
      attempted: 1,
      evaluationErrors: 1,
      persisted: 0,
      deadlineReached: true,
    });
    expect(settled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(settled).toBe(true);
  });

  it.each(["policy", "sink"] as const)(
    "does not return while an already-started %s dependency is unsettled",
    async (dependency) => {
      const turn = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
      let release!: () => void;
      const controlled = () => new Promise<void>((resolve) => { release = resolve; });
      const input = deps({
        deadlineMs: 10,
        now: () => Date.now(),
        ...(dependency === "policy"
          ? { policyReader: { getConversationEnginePolicy: vi.fn(async (clinicId: string) => {
              await controlled();
              return { clinicId, engine: "v1_with_v2_shadow" as const, isTest: false };
            }) } }
          : { sink: { append: vi.fn(controlled) } }),
      });
      const running = runRegisteredBatch({ turns: [turn], ...input });
      const resolvedBeforeRelease = await Promise.race([
        running.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 30)),
      ]);
      release();
      const result = await running;

      expect(resolvedBeforeRelease).toBe(false);
      expect(result).toMatchObject(dependency === "policy"
        ? { received: 1, deadlineReached: true, attempted: 0, persisted: 0 }
        : { received: 1, selected: 1, attempted: 1, deadlineReached: true, persisted: 1 });
    },
  );

  it("checks the remaining budget before invoking a dependency thunk", async () => {
    const turn = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
    const ticks = [0, 0, 5];
    const input = deps({ deadlineMs: 5, now: () => ticks.shift() ?? 5 });

    await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({
      deadlineReached: true,
      attempted: 0,
      persisted: 0,
    });
    expect(input.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
    expect(input.evaluator.evaluate).not.toHaveBeenCalled();
    expect(input.sink.append).not.toHaveBeenCalled();
  });

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
