import { describe, expect, it, vi } from "vitest";
import { APIUserAbortError } from "openai";
import {
  createShadowTurnCaptureRegistry,
  runAfterSenderDrainAttempt,
  runConversationV2ShadowBatch,
  type ShadowBatchTurn,
} from "@/application/conversation-v2/run-shadow-batch";
import { V1ObservationCollector } from "@/application/conversation-v2/v1-observation-collector";
import { V2ShadowRunner } from "@/application/conversation-v2/v2-shadow-runner";
import { V2ShadowSelectionRegistry } from "@/application/conversation-v2/tenant-engine-router";
import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import type { V1TurnObservationEvent } from "@/core/observability/V1TurnObservation";
import { DentalUnderstandingProvider } from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";
import { OpenAIDentalUnderstandingModel } from "@/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel";

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
    approval: null,
    runtimeIdentity: null,
    maxTurns: 10,
    deadlineMs: 1_000,
    now: () => 0,
    recordConfig,
    ...overrides,
  };
}

type TestShadowBatchInput = Omit<
  Parameters<typeof runConversationV2ShadowBatch>[0],
  "senderBarrier" | "selectedTurns"
> & Readonly<{
  selectedTurns?: Parameters<typeof runConversationV2ShadowBatch>[0]["selectedTurns"];
}>;

async function runRegisteredBatch(
  input: TestShadowBatchInput,
  outcome: "completed" | "failed_handled" = "completed",
) {
  const legacy = input as typeof input & {
    policyReader?: unknown;
    approval?: unknown;
    runtimeIdentity?: unknown;
  };
  const {
    policyReader: _policyReader,
    approval: _approval,
    runtimeIdentity: _runtimeIdentity,
    ...batchInput
  } = legacy;
  void _policyReader;
  void _approval;
  void _runtimeIdentity;
  let selectedTurns = input.selectedTurns;
  if (!selectedTurns) {
    const selectionRegistry = new V2ShadowSelectionRegistry();
    for (const turn of input.turns) {
      if (turn.automationMode === "live") {
        selectionRegistry.register({ turnId: turn.turn.turnId, clinicId: turn.clinicId });
      }
    }
    selectedTurns = selectionRegistry.consumeAll();
  }
  const postSender = await runAfterSenderDrainAttempt({
    turns: input.turns,
    drainSender: async () => {
      if (outcome === "failed_handled") throw new Error("handled sender failure");
    },
    onSenderFailure: () => undefined,
    occurredAt: () => "2026-08-16T12:00:00.000Z",
    afterAttempt: (senderBarrier, turns) => runConversationV2ShadowBatch({
      senderBarrier,
      ...batchInput,
      turns,
      selectedTurns,
    }),
  });
  return postSender.shadowResult;
}

function selectedTurnsFor(turns: readonly ShadowBatchTurn[]) {
  const registry = new V2ShadowSelectionRegistry();
  for (const turn of turns) {
    if (turn.automationMode === "live") {
      registry.register({ turnId: turn.turn.turnId, clinicId: turn.clinicId });
    }
  }
  return registry.consumeAll();
}

function batchDeps(input = deps()) {
  const { policyReader: _policyReader, approval: _approval, runtimeIdentity: _runtimeIdentity, ...rest } = input;
  void _policyReader;
  void _approval;
  void _runtimeIdentity;
  return rest;
}

async function runRawRegisteredBatch(
  turns: readonly ShadowBatchTurn[],
  makeInput: (registered: Readonly<{
    senderBarrier: Parameters<typeof runConversationV2ShadowBatch>[0]["senderBarrier"];
    turns: readonly ShadowBatchTurn[];
  }>) => unknown,
) {
  const postSender = await runAfterSenderDrainAttempt({
    turns,
    drainSender: async () => undefined,
    onSenderFailure: () => undefined,
    occurredAt: () => "2026-08-16T12:00:00.000Z",
    afterAttempt: (senderBarrier, registeredTurns) => runConversationV2ShadowBatch(
      makeInput({ senderBarrier, turns: registeredTurns }) as never,
    ),
  });
  return postSender.shadowResult;
}

async function flushMicrotasksUntil(
  predicate: () => boolean,
  failureMessage: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(failureMessage);
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
            selectedTurns: selectedTurnsFor(turns),
            ...batchDeps(),
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
      selectedTurns: selectedTurnsFor([turn]),
      ...batchDeps(),
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
          selectedTurns: selectedTurnsFor([turnB]),
          ...batchDeps(input),
        })).rejects.toThrow(/barrier|batch|snapshot|registered/i);
        await expect(runConversationV2ShadowBatch({
          senderBarrier: barrier,
          turns: [turnA],
          selectedTurns: selectedTurnsFor([turnA]),
          ...batchDeps(input),
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
      first.evaluator.evaluate.mock.calls.length
      + second.evaluator.evaluate.mock.calls.length,
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
    await expect(runRegisteredBatch({
      turns: proxy,
      selectedTurns: selectedTurnsFor([]),
      ...deps(),
    })).rejects.toThrow(/turn|array|batch/i);
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
    await expect(runRegisteredBatch({
      turns: accessor,
      selectedTurns: selectedTurnsFor([]),
      ...deps(),
    })).rejects.toThrow(/turn|array|batch/i);
    expect(reads).toBe(0);
  });

  it("consumes only the immutable turn ids preselected by the router", async () => {
    const turnA = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
    const turnB = capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true });
    const turns = [turnA, turnB];
    const selectedTurns = selectedTurnsFor([turnB]);
    const input = deps();

    await expect(runRegisteredBatch({ turns, selectedTurns, ...input }))
      .resolves.toMatchObject({ received: 2, selected: 1, skipped: 1, persisted: 1 });
    expect(input.evaluator.evaluate).toHaveBeenCalledTimes(1);
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

  it("does not mark a V1 arm observed or derive divergence without final outbound authority", async () => {
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
      evaluator: {
        evaluate: vi.fn(async () => ({
          result: {
            status: "evaluated" as const,
            decisions: [{
              capabilityId: "dental-escalation",
              decision: { kind: "escalate" as const, reason: "human_required" },
            }],
            actionResults: [{
              type: "escalation_required" as const,
              semanticClass: "human_action_required" as const,
              origin: { capabilityId: "dental-escalation" },
              subject: null,
              evidence: [],
              facts: [],
            }],
            response: { text: "É necessário atendimento humano.", parts: [] },
          },
          understandingRequest: "price-of-service" as const,
          model: null,
        })),
      },
    });

    await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({ persisted: 1 });
    const record = input.sink.append.mock.calls[0]![0].record;
    expect(record.version).toBe("conversation-v2-live-comparison.v2");
    expect(record.v1).toMatchObject({
      status: "unavailable",
      finalTextCharacters: null,
      finalTextDigest: null,
      model: null,
      errorCode: "final_response_unavailable",
    });
    expect(record.v2).toMatchObject({
      status: "observed",
      capabilityIds: ["dental-escalation"],
      decisionKinds: ["escalate"],
      outcomes: [{
        capabilityId: "dental-escalation",
        decisionKind: "escalate",
        type: "escalation_required",
        semanticClass: "human_action_required",
      }],
    });
    expect(record).toMatchObject({
      comparisonStatus: "not_measurable",
      comparisonReason: "v1_final_response_unavailable",
      divergenceCodes: [],
    });
  });

  it.each([
    {
      label: "prepared capability owner",
      decision: {
        capabilityId: "dental-catalog",
        decision: { kind: "answer" as const, facts: [], nextBestStep: null },
      },
      actionResult: {
        type: "escalation_required" as const,
        semanticClass: "human_action_required" as const,
        origin: { capabilityId: "dental-escalation" },
        subject: null,
        evidence: [],
        facts: [],
      },
    },
    {
      label: "concrete execute action",
      decision: {
        capabilityId: "dental-scheduling",
        decision: {
          kind: "execute" as const,
          action: { type: "book-slot", parameters: { slotId: "slot-secret" } },
          nextBestStep: null,
        },
      },
      actionResult: {
        type: "appointment_confirmed" as const,
        semanticClass: "effect_completed" as const,
        origin: { capabilityId: "dental-scheduling" },
        subject: { type: "appointment", id: "appointment-secret", displayName: "appointment" },
        evidence: [{ source: "write" as const, reference: "write-secret" }],
        facts: [],
      },
    },
  ])("fails closed before persistence when an evaluator mismatches $label provenance", async ({ decision, actionResult }) => {
    const turn = capturedTurn({ turnId: `turn-forged-${decision.capabilityId}`, clinicId: "clinic-a", ready: true });
    const input = deps({
      evaluator: {
        evaluate: vi.fn(async () => ({
          result: {
            status: "evaluated" as const,
            decisions: [decision],
            actionResults: [actionResult],
            response: { text: "Resposta forjada.", parts: [] },
          },
          understandingRequest: "price-of-service" as const,
          model: null,
        })),
      },
    });

    await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({
      persisted: 0,
      recordValidationErrors: 1,
      sinkErrors: 0,
    });
    expect(input.sink.append).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "appointment_created without a subject",
      decision: {
        capabilityId: "dental-scheduling",
        decision: { kind: "execute" as const, action: { type: "book-slot", parameters: { slotId: "slot-1" } }, nextBestStep: null },
      },
      actionResult: {
        type: "appointment_created" as const,
        semanticClass: "effect_completed" as const,
        origin: { capabilityId: "dental-scheduling" },
        subject: null,
        evidence: [{ source: "write" as const, reference: "write-1" }],
        facts: [],
      },
    },
    {
      label: "appointment_created without write evidence",
      decision: {
        capabilityId: "dental-scheduling",
        decision: { kind: "execute" as const, action: { type: "book-slot", parameters: { slotId: "slot-1" } }, nextBestStep: null },
      },
      actionResult: {
        type: "appointment_created" as const,
        semanticClass: "effect_completed" as const,
        origin: { capabilityId: "dental-scheduling" },
        subject: { type: "appointment", id: "appointment-1", displayName: "Agendamento" },
        evidence: [],
        facts: [],
      },
    },
    {
      label: "appointment_created with only read evidence",
      decision: {
        capabilityId: "dental-scheduling",
        decision: { kind: "execute" as const, action: { type: "book-slot", parameters: { slotId: "slot-1" } }, nextBestStep: null },
      },
      actionResult: {
        type: "appointment_created" as const,
        semanticClass: "effect_completed" as const,
        origin: { capabilityId: "dental-scheduling" },
        subject: { type: "appointment", id: "appointment-1", displayName: "Agendamento" },
        evidence: [{ source: "read" as const, reference: "read-1" }],
        facts: [],
      },
    },
    {
      label: "catalog_answered without a subject",
      decision: {
        capabilityId: "dental-catalog",
        decision: { kind: "answer" as const, facts: [], nextBestStep: null },
      },
      actionResult: {
        type: "catalog_answered" as const,
        semanticClass: "information_authorized" as const,
        origin: { capabilityId: "dental-catalog" },
        subject: null,
        evidence: [{ source: "read" as const, reference: "catalog-1" }],
        facts: [],
      },
    },
    {
      label: "catalog_answered without evidence",
      decision: {
        capabilityId: "dental-catalog",
        decision: { kind: "answer" as const, facts: [], nextBestStep: null },
      },
      actionResult: {
        type: "catalog_answered" as const,
        semanticClass: "information_authorized" as const,
        origin: { capabilityId: "dental-catalog" },
        subject: { type: "service", id: "service-1", displayName: "Limpeza" },
        evidence: [],
        facts: [],
      },
    },
    {
      label: "escalation_required with a forbidden subject",
      decision: {
        capabilityId: "dental-escalation",
        decision: { kind: "escalate" as const, reason: "human_required" },
      },
      actionResult: {
        type: "escalation_required" as const,
        semanticClass: "human_action_required" as const,
        origin: { capabilityId: "dental-escalation" },
        subject: { type: "service", id: "service-1", displayName: "Limpeza" },
        evidence: [],
        facts: [],
      },
    },
    {
      label: "slots_found without options",
      decision: {
        capabilityId: "dental-scheduling",
        decision: {
          kind: "offer" as const,
          subject: { type: "service", id: "service-1", displayName: "Limpeza" },
          options: [],
          nextBestStep: null,
        },
      },
      actionResult: {
        type: "slots_found" as const,
        semanticClass: "options_found" as const,
        origin: { capabilityId: "dental-scheduling" },
        subject: { type: "service", id: "service-1", displayName: "Limpeza" },
        evidence: [{ source: "read" as const, reference: "slots-1" }],
        facts: [],
      },
    },
  ])("re-canonicalizes an evaluator result and rejects $label before sink admission", async ({ label, decision, actionResult }) => {
    const turn = capturedTurn({ turnId: `turn-invalid-result-${label}`, clinicId: "clinic-a", ready: true });
    const input = deps({
      evaluator: {
        evaluate: vi.fn(async () => ({
          result: {
            status: "evaluated" as const,
            decisions: [decision],
            actionResults: [actionResult],
            response: { text: "Resposta forjada.", parts: [] },
          },
          understandingRequest: "price-of-service" as const,
          model: null,
        })),
      },
    });

    await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({
      persisted: 0,
      recordValidationErrors: 1,
      sinkErrors: 0,
    });
    expect(input.sink.append).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "appointment_created",
      decision: {
        capabilityId: "dental-scheduling",
        decision: { kind: "execute" as const, action: { type: "book-slot", parameters: { slotId: "slot-1" } }, nextBestStep: null },
      },
      actionResult: {
        type: "appointment_created" as const,
        semanticClass: "effect_completed" as const,
        origin: { capabilityId: "dental-scheduling" },
        subject: { type: "appointment", id: "appointment-1", displayName: "Agendamento" },
        evidence: [{ source: "write" as const, reference: "write-1" }],
        facts: [],
      },
    },
    {
      label: "catalog_answered",
      decision: {
        capabilityId: "dental-catalog",
        decision: { kind: "answer" as const, facts: [], nextBestStep: null },
      },
      actionResult: {
        type: "catalog_answered" as const,
        semanticClass: "information_authorized" as const,
        origin: { capabilityId: "dental-catalog" },
        subject: { type: "service", id: "service-1", displayName: "Limpeza" },
        evidence: [{ source: "read" as const, reference: "catalog-1" }],
        facts: [],
      },
    },
    {
      label: "escalation_required",
      decision: {
        capabilityId: "dental-escalation",
        decision: { kind: "escalate" as const, reason: "human_required" },
      },
      actionResult: {
        type: "escalation_required" as const,
        semanticClass: "human_action_required" as const,
        origin: { capabilityId: "dental-escalation" },
        subject: null,
        evidence: [],
        facts: [],
      },
    },
    {
      label: "slots_found",
      decision: {
        capabilityId: "dental-scheduling",
        decision: {
          kind: "offer" as const,
          subject: { type: "service", id: "service-1", displayName: "Limpeza" },
          options: [],
          nextBestStep: null,
        },
      },
      actionResult: {
        type: "slots_found" as const,
        semanticClass: "options_found" as const,
        origin: { capabilityId: "dental-scheduling" },
        subject: { type: "service", id: "service-1", displayName: "Limpeza" },
        evidence: [{ source: "read" as const, reference: "slots-1" }],
        facts: [],
        options: [{
          id: "slot-1",
          subject: { type: "slot", id: "slot-1", displayName: "17/08 15:00" },
          facts: [],
        }],
      },
    },
  ])("accepts a schema-valid evaluator result for $label", async ({ label, decision, actionResult }) => {
    const turn = capturedTurn({ turnId: `turn-valid-result-${label}`, clinicId: "clinic-a", ready: true });
    const input = deps({
      evaluator: {
        evaluate: vi.fn(async () => ({
          result: {
            status: "evaluated" as const,
            decisions: [decision],
            actionResults: [actionResult],
            response: { text: "Resposta validada.", parts: [] },
          },
          understandingRequest: "price-of-service" as const,
          model: null,
        })),
      },
    });

    await expect(runRegisteredBatch({ turns: [turn], ...input })).resolves.toMatchObject({
      persisted: 1,
      recordValidationErrors: 0,
      sinkErrors: 0,
    });
    expect(input.sink.append).toHaveBeenCalledTimes(1);
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

  it("skips every captured turn absent from the registered router selection", async () => {
    const turns = [
      capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true }),
      capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true }),
    ];
    const input = deps();
    const result = await runRegisteredBatch({
      turns,
      selectedTurns: selectedTurnsFor([]),
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

      const summary = await runRegisteredBatch({ turns: [turn], ...input });
      expect(summary).toMatchObject({
        received: 1,
        selected: 0,
        attempted: 0,
        persisted: 0,
        skipped: 1,
      });
      expect(input.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
      expect(input.evaluator.evaluate).not.toHaveBeenCalled();
      expect(input.sink.append).not.toHaveBeenCalled();
      expect(summary.selections).toEqual([]);
      expect(JSON.stringify(summary.selections)).not.toContain(`turn-${automationMode}`);
      expect(JSON.stringify(summary.selections)).not.toContain("clinic-a");
    },
  );

  it("rejects forged and reused selection snapshots before evaluator I/O", async () => {
    const turn = capturedTurn({ turnId: "turn-forged-selection", clinicId: "clinic-a", ready: true });
    const input = deps();
    await expect(runRegisteredBatch({ turns: [turn], selectedTurns: [{
      turnId: turn.turn.turnId,
      clinicId: turn.clinicId,
    }], ...input })).rejects.toThrow(/selection|registered/i);
    expect(input.evaluator.evaluate).not.toHaveBeenCalled();

    const selectedTurns = selectedTurnsFor([turn]);
    await expect(runRegisteredBatch({ turns: [turn], selectedTurns, ...deps() }))
      .resolves.toMatchObject({ persisted: 1 });
    const freshTurn = capturedTurn({ turnId: "turn-fresh", clinicId: "clinic-a", ready: true });
    await expect(runRegisteredBatch({ turns: [freshTurn], selectedTurns, ...deps() }))
      .rejects.toThrow(/selection|registered|fresh/i);
  });

  it("returns frozen sanitized selection metadata without an async trace dependency", async () => {
    const turn = capturedTurn({ turnId: "turn-summary-selection", clinicId: "clinic-a", ready: true });
    const input = deps();
    const summary = await runRegisteredBatch({ turns: [turn], ...input });

    expect(summary.selections).toEqual([expect.objectContaining({
      turnRef: expect.stringMatching(/^hmac:[a-f0-9]{64}$/),
      clinicRef: expect.stringMatching(/^hmac:[a-f0-9]{64}$/),
      automationMode: "live",
    })]);
    expect(Object.isFrozen(summary.selections)).toBe(true);
    expect(Object.isFrozen(summary.selections[0])).toBe(true);
    expect(JSON.stringify(summary.selections)).not.toContain("turn-summary-selection");
    expect(JSON.stringify(summary.selections)).not.toContain("clinic-a");
  });

  it("honors empty batch, maxTurns and the admission deadline before starting extra model work", async () => {
    await expect(runRegisteredBatch({ turns: [], ...deps() }))
      .resolves.toMatchObject({
        received: 0,
        attempted: 0,
        deadline: {
          admissionClosed: false,
          overrun: false,
          overrunMs: 0,
          clockStatus: "valid",
        },
        drain: {
          admitted: 0,
          settled: 0,
          activeAtReturn: 0,
        },
      });

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

  it.each(["evaluator", "sink"] as const)(
    "does not start a %s dependency thunk at or after the admission deadline",
    async (blockedDependency) => {
      const turn = capturedTurn({
        turnId: `turn-admission-${blockedDependency}`,
        clinicId: "clinic-a",
        ready: true,
      });
      let current = 0;
      const starts: Readonly<{ dependency: string; at: number }>[] = [];
      const input = deps({
        deadlineMs: 5,
        now: () => current,
        evaluator: {
          evaluate: vi.fn(async () => {
            starts.push({ dependency: "evaluator", at: current });
            if (blockedDependency === "sink") current = 5;
            return {
              result: { status: "unsupported" as const, reason: "unsupported_request" as const },
              understandingRequest: null,
              model: null,
            };
          }),
        },
        sink: {
          append: vi.fn(async () => {
            starts.push({ dependency: "sink", at: current });
          }),
        },
      });
      if (blockedDependency === "evaluator") {
        const ticks = [0, 0, 5];
        input.now = () => ticks.shift() ?? 5;
      }

      const summary = await runRegisteredBatch({ turns: [turn], ...input });

      expect(starts.every(({ at }) => at < 5)).toBe(true);
      expect(starts.some(({ dependency }) => dependency === blockedDependency)).toBe(false);
      expect(summary).toMatchObject({
        deadlineReached: true,
        deadline: {
          admissionClosed: true,
          clockStatus: "valid",
        },
        drain: { activeAtReturn: 0 },
      });
      expect(summary.deadline.overrun)
        .toBe(summary.deadline.overrunMs > 0);
    },
  );

  it("aborts and awaits the evaluator at the deadline without work surviving the summary", async () => {
    vi.useFakeTimers({ now: 0 });
    const turn = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
    let settled = false;
    const receivedSignals: AbortSignal[] = [];
    const input = deps({
      deadlineMs: 10,
      now: () => Date.now(),
      evaluator: {
        evaluate: vi.fn((_reads: unknown, signal?: AbortSignal) => new Promise((resolve, reject) => {
          if (signal) receivedSignals.push(signal);
          const timer = setTimeout(() => {
            settled = true;
            resolve({ result: { status: "unsupported", reason: "unsupported_request" }, understandingRequest: null, model: null });
          }, 100);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            settled = true;
            reject(signal.reason);
          }, { once: true });
        })),
      },
    });

    try {
      const running = runRegisteredBatch({ turns: [turn], ...input });
      await flushMicrotasksUntil(
        () => receivedSignals.length === 1,
        "evaluator was not admitted before the controlled deadline",
      );
      await vi.advanceTimersByTimeAsync(10);
      const summary = await running;
      expect(summary).toMatchObject({
        received: 1,
        attempted: 1,
        evaluationErrors: 1,
        persisted: 0,
        deadlineReached: true,
      });
      expect(receivedSignals).toHaveLength(1);
      expect(receivedSignals[0]!.aborted).toBe(true);
      expect(settled).toBe(true);
      expect(summary).toMatchObject({
        deadline: {
          admissionClosed: true,
          clockStatus: "valid",
        },
        drain: {
          admitted: 1,
          settled: 1,
          completed: 0,
          failed: 1,
          abortRequested: 1,
          cooperativelyAborted: 1,
          activeAtReturn: 0,
        },
      });
      expect(summary.deadline.overrunMs).toBeGreaterThanOrEqual(0);
      expect(Object.isFrozen(summary.deadline)).toBe(true);
      expect(Object.isFrozen(summary.drain)).toBe(true);
      await vi.advanceTimersByTimeAsync(120);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains a provider that ignores abort without claiming cooperative cancellation", async () => {
    vi.useFakeTimers({ now: 0 });
    const turn = capturedTurn({ turnId: "turn-provider-ignored-abort", clinicId: "clinic-a", ready: true });
    let providerStarted = false;
    let providerSettled = false;
    const input = deps({
      deadlineMs: 5,
      now: () => Date.now(),
      evaluator: {
        evaluate: vi.fn(() => new Promise((resolve) => {
          providerStarted = true;
          setTimeout(() => {
            providerSettled = true;
            resolve({
              result: { status: "unsupported", reason: "unsupported_request" },
              understandingRequest: null,
              model: null,
            });
          }, 25);
        })),
      },
    });

    try {
      const running = runRegisteredBatch({ turns: [turn], ...input });
      await flushMicrotasksUntil(
        () => providerStarted,
        "provider was not admitted before the controlled deadline",
      );
      await vi.advanceTimersByTimeAsync(25);
      const summary = await running;

      expect(providerSettled).toBe(true);
      expect(summary).toMatchObject({
        attempted: 1,
        evaluationErrors: 1,
        persisted: 0,
        deadlineReached: true,
        deadline: {
          admissionClosed: true,
          overrun: true,
        },
        drain: {
          admitted: 1,
          settled: 1,
          completed: 0,
          failed: 1,
          abortRequested: 1,
          cooperativelyAborted: 0,
          activeAtReturn: 0,
        },
      });
      expect(summary.deadline.overrunMs).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the productive OpenAI cancellation acknowledgement through runner and batch", async () => {
    vi.useFakeTimers({ now: 0 });
    const turn = capturedTurn({ turnId: "turn-productive-abort-ack", clinicId: "clinic-a", ready: true });
    let providerAcknowledgedAbort = false;
    const create = vi.fn((_request: unknown, options?: Readonly<{ signal?: AbortSignal }>) => (
      new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          providerAcknowledgedAbort = true;
          reject(new APIUserAbortError());
        }, { once: true });
      })
    ));
    const provider = new DentalUnderstandingProvider(
      new OpenAIDentalUnderstandingModel({ chat: { completions: { create } } }, "gpt-test"),
    );
    const input = deps({
      deadlineMs: 5,
      now: () => Date.now(),
      evaluator: {
        evaluate: vi.fn(async (reads, signal: AbortSignal) => {
          const runner = new V2ShadowRunner({
            hmacKey: recordConfig.hmacKey,
            style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
            understand: async (captured) => provider.understand({
              leadMessage: captured.leadMessage,
              history: captured.history,
              state: captured.state,
              catalog: captured.catalog.status === "captured"
                ? captured.catalog.value.map((service) => ({
                    id: service.id,
                    displayName: service.name,
                    aliases: [],
                  }))
                : [],
            }, { signal }),
          });
          const result = await runner.run(reads, { signal });
          return { result, understandingRequest: null, model: null };
        }),
      },
    });

    try {
      const running = runRegisteredBatch({ turns: [turn], ...input });
      await flushMicrotasksUntil(
        () => create.mock.calls.length === 1,
        "productive provider was not admitted before the controlled deadline",
      );
      await vi.advanceTimersByTimeAsync(5);
      const summary = await running;

      expect(providerAcknowledgedAbort).toBe(true);
      expect(summary).toMatchObject({
        attempted: 1,
        evaluationErrors: 1,
        persisted: 0,
        deadlineReached: true,
        drain: {
          admitted: 1,
          settled: 1,
          completed: 0,
          failed: 1,
          abortRequested: 1,
          cooperativelyAborted: 1,
          activeAtReturn: 0,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not return while an already-started sink dependency is unsettled", async () => {
      const turn = capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true });
      let release!: () => void;
      const controlled = () => new Promise<void>((resolve) => { release = resolve; });
      const input = deps({
        deadlineMs: 10,
        now: () => Date.now(),
        sink: { append: vi.fn(controlled) },
      });
      const running = runRegisteredBatch({ turns: [turn], ...input });
      const resolvedBeforeRelease = await Promise.race([
        running.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 30)),
      ]);
      release();
      const result = await running;

      expect(resolvedBeforeRelease).toBe(false);
      expect(result).toMatchObject({
        received: 1, selected: 1, attempted: 1, deadlineReached: true, persisted: 1,
      });
      expect(result.drain).toMatchObject({
        admitted: 2,
        settled: 2,
        activeAtReturn: 0,
      });
  });

  it("drains an admitted non-cancelable DB write, measures overrun, and starts no later write", async () => {
    const turn = capturedTurn({ turnId: "turn-db-overrun", clinicId: "clinic-a", ready: true });
    let current = 0;
    let release!: () => void;
    const sink = {
      append: vi.fn(() => new Promise<void>((resolve) => { release = resolve; })),
    };
    const input = deps({ deadlineMs: 5, now: () => current, sink });
    const running = runRegisteredBatch({ turns: [turn], ...input });
    while (!release) await Promise.resolve();

    current = 12;
    let returned = false;
    void running.then(() => { returned = true; });
    await Promise.resolve();
    expect(returned).toBe(false);
    release();
    const summary = await running;

    expect(sink.append).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      persisted: 1,
      deadlineReached: true,
      deadline: {
        deadlineAt: 5,
        admissionClosed: true,
        returnedAt: 12,
        overrun: true,
        overrunMs: 7,
        clockStatus: "valid",
      },
      drain: {
        admitted: 2,
        settled: 2,
        completed: 2,
        failed: 0,
        cooperativelyAborted: 0,
        activeAtReturn: 0,
      },
    });
    await Promise.resolve();
    expect(sink.append).toHaveBeenCalledTimes(1);
  });

  it("marks a post-admission malformed clock without hiding a real overrun", async () => {
    const turn = capturedTurn({ turnId: "turn-malformed-overrun", clinicId: "clinic-a", ready: true });
    let malformed = false;
    const sink = {
      append: vi.fn(() => new Promise<void>((resolve) => {
        setTimeout(() => {
          malformed = true;
          resolve();
        }, 25);
      })),
    };
    const input = deps({
      deadlineMs: 5,
      now: () => malformed ? Number.NaN : 0,
      sink,
    });

    const summary = await runRegisteredBatch({ turns: [turn], ...input });

    expect(summary).toMatchObject({
      persisted: 1,
      deadlineReached: true,
      deadline: {
        admissionClosed: true,
        returnedAt: null,
        overrun: true,
        clockStatus: "malformed",
      },
      drain: {
        admitted: 2,
        settled: 2,
        activeAtReturn: 0,
      },
    });
    expect(summary.deadline.overrunMs).toBeGreaterThan(0);
  });

  it.each([
    ["non-finite", Number.NaN],
    ["backward", 5],
  ] as const)(
    "preserves proven overrun when the return clock becomes %s",
    async (_label, malformedSample) => {
      const turn = capturedTurn({
        turnId: `turn-proven-overrun-${_label}`,
        clinicId: "clinic-a",
        ready: true,
      });
      const ticks = [0, 0, 0, 0, 0, 6, malformedSample];
      const sink = { append: vi.fn().mockResolvedValue(undefined) };
      const input = deps({ deadlineMs: 5, now: () => ticks.shift() ?? malformedSample, sink });

      const summary = await runRegisteredBatch({ turns: [turn], ...input });

      expect(sink.append).toHaveBeenCalledTimes(1);
      expect(summary).toMatchObject({
        persisted: 1,
        deadlineReached: true,
        deadline: {
          deadlineAt: 5,
          admissionClosed: true,
          admissionClosedAt: 5,
          returnedAt: null,
          overrun: true,
          clockStatus: "malformed",
        },
        drain: { activeAtReturn: 0 },
      });
      expect(summary.deadline.overrunMs).toBeGreaterThanOrEqual(1);
    },
  );

  it.each([
    ["empty", "non-finite", Number.NaN],
    ["empty", "backward", 5],
    ["maxTurns-zero", "non-finite", Number.NaN],
    ["maxTurns-zero", "backward", 5],
  ] as const)(
    "anchors deadline closure at T for a %s batch with a %s return clock",
    async (batchKind, _clockKind, malformedSample) => {
      const ticks = [0, 6, malformedSample];
      const turns = batchKind === "empty"
        ? []
        : [capturedTurn({ turnId: `turn-${batchKind}-${_clockKind}`, clinicId: "clinic-a", ready: true })];
      const input = deps({
        deadlineMs: 5,
        maxTurns: batchKind === "maxTurns-zero" ? 0 : 10,
        now: () => ticks.shift() ?? malformedSample,
      });

      const summary = await runRegisteredBatch({ turns, ...input });

      expect(summary.deadline).toMatchObject({
        deadlineAt: 5,
        admissionClosed: true,
        admissionClosedAt: 5,
        returnedAt: null,
        overrun: true,
        clockStatus: "malformed",
      });
      expect(summary.deadline.overrunMs).toBeGreaterThanOrEqual(1);
      expect(summary.drain).toMatchObject({ admitted: 0, settled: 0, activeAtReturn: 0 });
      expect(input.evaluator.evaluate).not.toHaveBeenCalled();
    },
  );

  it("keeps the comparison sink uncalled when admission closes after evaluation", async () => {
    const turn = capturedTurn({ turnId: "turn-sink-not-admitted", clinicId: "clinic-a", ready: true });
    let current = 0;
    const sink = { append: vi.fn().mockResolvedValue(undefined) };
    const input = deps({
      deadlineMs: 5,
      now: () => current,
      evaluator: {
        evaluate: vi.fn(async () => {
          current = 5;
          return {
            result: { status: "unsupported" as const, reason: "unsupported_request" as const },
            understandingRequest: null,
            model: null,
          };
        }),
      },
      sink,
    });

    const summary = await runRegisteredBatch({ turns: [turn], ...input });

    expect(sink.append).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      attempted: 1,
      persisted: 0,
      deadlineReached: true,
      drain: {
        admitted: 1,
        settled: 1,
        activeAtReturn: 0,
      },
    });
  });

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

  it("validates config before consuming the registered turn", async () => {
    const turn = capturedTurn({ turnId: "turn-config-retry", clinicId: "clinic-a", ready: true });
    const invalid = deps({
      recordConfig: { ...deps().recordConfig, commit: "missing_commit" },
    });
    await expect(runRegisteredBatch({ turns: [turn], ...invalid }))
      .rejects.toThrow(/commit|config/i);

    const valid = deps();
    await expect(runRegisteredBatch({ turns: [turn], ...valid }))
      .resolves.toMatchObject({ received: 1, attempted: 1, persisted: 1 });
  });

  it.each(["maxTurns", "deadlineMs"] as const)(
    "rejects a top-level %s accessor sequence without reading it or consuming the turn",
    async (field) => {
      const turn = capturedTurn({ turnId: `turn-input-accessor-${field}`, clinicId: "clinic-a", ready: true });
      const input = deps();
      let reads = 0;
      await expect(runRawRegisteredBatch([turn], ({ senderBarrier, turns }) => {
        const raw = { senderBarrier, turns, ...input } as Record<string, unknown>;
        Object.defineProperty(raw, field, {
          enumerable: true,
          get() {
            reads += 1;
            return reads === 1 ? 1 : 100;
          },
        });
        return raw;
      })).rejects.toThrow(/batch|input|invalid/i);
      expect(reads).toBe(0);
      expect(input.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
      await expect(runRegisteredBatch({ turns: [turn], ...deps() }))
        .resolves.toMatchObject({ received: 1, persisted: 1 });
    },
  );

  it.each(["proxy", "symbol", "unknown"] as const)(
    "rejects a %s top-level batch envelope before traps, dependency I/O, or turn consumption",
    async (kind) => {
      const turn = capturedTurn({ turnId: `turn-input-${kind}`, clinicId: "clinic-a", ready: true });
      const input = deps();
      let reads = 0;
      await expect(runRawRegisteredBatch([turn], ({ senderBarrier, turns }) => {
        const raw = { senderBarrier, turns, ...input };
        if (kind === "proxy") {
          return new Proxy(raw, {
            get(target, key, receiver) {
              reads += 1;
              return Reflect.get(target, key, receiver);
            },
          });
        }
        if (kind === "symbol") return Object.assign(raw, { [Symbol("authority")]: true });
        return { ...raw, unexpectedAuthority: true };
      })).rejects.toThrow(/batch|input|invalid/i);
      expect(reads).toBe(0);
      expect(input.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
      await expect(runRegisteredBatch({ turns: [turn], ...deps() }))
        .resolves.toMatchObject({ received: 1, persisted: 1 });
    },
  );

  it.each([
    ["maxTurns", Number.MAX_SAFE_INTEGER],
    ["deadlineMs", Number.MAX_VALUE],
  ] as const)(
    "rejects an unbounded %s before dependency I/O or turn consumption",
    async (field, value) => {
      const turn = capturedTurn({ turnId: `turn-unbounded-${field}`, clinicId: "clinic-a", ready: true });
      const input = deps({ [field]: value });
      await expect(runRegisteredBatch({ turns: [turn], ...input }))
        .rejects.toThrow(/maxTurns|deadline|invalid|bound/i);
      expect(input.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
      await expect(runRegisteredBatch({ turns: [turn], ...deps() }))
        .resolves.toMatchObject({ received: 1, persisted: 1 });
    },
  );

  it.each([
    ["non-finite", () => Number.NaN],
    ["backward", (() => {
      const ticks = [10, 9];
      return () => ticks.shift() ?? 9;
    })()],
  ] as const)(
    "rejects a %s clock before dependency I/O or turn consumption",
    async (_label, now) => {
      const turn = capturedTurn({ turnId: `turn-clock-${_label}`, clinicId: "clinic-a", ready: true });
      const input = deps({ now });
      await expect(runRegisteredBatch({ turns: [turn], ...input }))
        .rejects.toThrow(/clock|time|monotonic|finite/i);
      expect(input.policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
      await expect(runRegisteredBatch({ turns: [turn], ...deps() }))
        .resolves.toMatchObject({ received: 1, persisted: 1 });
    },
  );

  it("contains evaluator and sink failures per turn and continues the batch", async () => {
    const turns = [
      capturedTurn({ turnId: "turn-a", clinicId: "clinic-a", ready: true }),
      capturedTurn({ turnId: "turn-b", clinicId: "clinic-b", ready: true }),
      capturedTurn({ turnId: "turn-c", clinicId: "clinic-c", ready: true }),
    ];
    const evaluator = {
      evaluate: vi.fn(async () => {
        if (evaluator.evaluate.mock.calls.length === 1) throw new Error("provider down");
        return { result: { status: "unsupported" as const, reason: "unsupported_request" as const }, understandingRequest: null, model: null };
      }),
    };
    const sink = { append: vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined) };
    const result = await runRegisteredBatch({
      turns,
      ...deps({ evaluator, sink }),
    }, "failed_handled");
    expect(result).toMatchObject({
      received: 3,
      evaluationErrors: 1,
      recordValidationErrors: 0,
      sinkErrors: 1,
    });
  });
});
