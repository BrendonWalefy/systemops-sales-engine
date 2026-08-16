import { describe, expect, expectTypeOf, it } from "vitest";
import {
  recordV1TurnObservation,
  type V1TurnObservationEvent,
  type V1TurnObservationSink,
} from "@/core/observability/V1TurnObservation";
import {
  V1ObservationCollector,
  buildCapturedV2TurnReads,
  type CapturedV1Turn,
  type CapturedV1TurnSharedProjection,
} from "@/application/conversation-v2/v1-observation-collector";

const turnInput = (turnId: string, leadMessage = "Quero agendar") => ({
  kind: "turn_input" as const,
  turnId,
  now: "2026-08-16T12:00:00.000Z",
  leadMessage,
});

const turnContext = (turnId: string, body = "Quero agendar") => ({
  kind: "turn_context" as const,
  turnId,
  phase: "slots_offered",
  pendingStepId: `${turnId}:offer`,
  completedStepIds: ["welcome"],
  history: [{ author: "lead" as const, body }],
});

const tenantSnapshot = (turnId: string) => ({
  kind: "tenant_snapshot" as const,
  turnId,
  configFingerprint: `config:${turnId}`,
  policy: {
    priceDisclosureEnabled: true,
    humanEscalationRequired: false,
    schedulingMinimumLeadTimeHours: 2,
    schedulingRequiresEvaluationFirst: false,
  },
  catalog: [{
    id: `service:${turnId}`,
    name: "Avaliação",
    priceCents: 25_000,
    priceDisclosable: true,
  }],
});

const terminal = (turnId: string, replied = true) => ({
  kind: "turn_terminal" as const,
  turnId,
  replied,
  reason: replied ? null : "ai_paused",
});

const gateFacts = (turnId: string) => [
  { kind: "turn_gate_fact" as const, turnId, field: "automationEnabled" as const, value: true, source: "job_automation" as const },
  { kind: "turn_gate_fact" as const, turnId, field: "duplicate" as const, value: false, source: "v1_dedupe" as const },
  { kind: "turn_gate_fact" as const, turnId, field: "humanControlled" as const, value: false, source: "v1_human_control" as const },
  { kind: "turn_gate_fact" as const, turnId, field: "optedOut" as const, value: false, source: "v1_opt_out" as const },
];

describe("V1 turn observation seam", () => {
  it("mantém o observer opcional e torna falha do observer best-effort", () => {
    expect(() => recordV1TurnObservation(undefined, turnInput("turn-1"))).not.toThrow();

    const throwingSink: V1TurnObservationSink = {
      record() {
        throw new Error("observer unavailable");
      },
    };
    expect(() => recordV1TurnObservation(throwingSink, turnInput("turn-1"))).not.toThrow();
  });

  it("entrega clones profundamente congelados e sem alias com objetos V1", () => {
    const received: V1TurnObservationEvent[] = [];
    const sink: V1TurnObservationSink = { record: (event) => received.push(event) };
    const event = turnContext("turn-1");

    recordV1TurnObservation(sink, event);
    event.completedStepIds.push("mutated-after-record");
    event.history[0]!.body = "mutated-after-record";

    expect(received).toHaveLength(1);
    expect(received[0]).not.toBe(event);
    expect(received[0]).toMatchObject({
      completedStepIds: ["welcome"],
      history: [{ author: "lead", body: "Quero agendar" }],
    });
    expect(Object.isFrozen(received[0])).toBe(true);
    const capturedContext = received[0] as Extract<V1TurnObservationEvent, { kind: "turn_context" }>;
    expect(Object.isFrozen(capturedContext.completedStepIds)).toBe(true);
    expect(Object.isFrozen(capturedContext.history)).toBe(true);
    expect(Object.isFrozen(capturedContext.history[0])).toBe(true);
  });

  it("separa shared reads do braço V1 e não transporta outcome, digest ou replied para V2", () => {
    const collector = new V1ObservationCollector();
    const mutableContext = turnContext("turn-1");
    collector.record(turnInput("turn-1"));
    for (const event of gateFacts("turn-1")) collector.record(event);
    collector.record(mutableContext);
    collector.record(tenantSnapshot("turn-1"));
    collector.record({
      kind: "v1_response_plan",
      turnId: "turn-1",
      actionType: "slots_found",
      outcomeSummary: "slots_found",
      responseDigest: "sha256:control-only",
      responseCharacters: 42,
      latencyMs: 15,
      modelId: "gpt-4o-mini",
      inputTokens: 20,
      outputTokens: 10,
    });
    collector.record(terminal("turn-1"));

    mutableContext.completedStepIds.push("late-mutation");
    mutableContext.history[0]!.body = "late-mutation";
    const captured = collector.complete("turn-1");
    expect(captured).not.toBeNull();
    expect(captured!.sharedReads.gateFacts).toEqual(gateFacts("turn-1"));
    expect(captured!.controlArm.responsePlans[0]).toMatchObject({
      outcomeSummary: "slots_found",
      responseDigest: "sha256:control-only",
    });
    expect(captured!.sharedReads.context).toMatchObject({
      completedStepIds: ["welcome"],
      history: [{ author: "lead", body: "Quero agendar" }],
    });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured!.sharedReads.context!.history[0])).toBe(true);

    const reads = buildCapturedV2TurnReads(captured!);
    const serialized = JSON.stringify(reads);
    expect(serialized).not.toContain("outcomeSummary");
    expect(serialized).not.toContain("responseDigest");
    expect(serialized).not.toContain("replied");
    expect(serialized).not.toContain("control-only");
    expect(reads.gateInput).toEqual({
      status: "captured",
      value: {
        automationEnabled: true,
        duplicate: false,
        humanControlled: false,
        optedOut: false,
      },
    });
    expect(reads.history).toEqual([{ author: "lead", body: "Quero agendar" }]);
    expect(Object.isFrozen(reads)).toBe(true);
  });

  it("mantém gate unavailable quando qualquer campo não foi lido e nunca infere false do control arm", () => {
    const collector = new V1ObservationCollector();
    collector.record(turnInput("turn-1"));
    for (const event of gateFacts("turn-1").slice(0, 3)) collector.record(event);
    collector.record(turnContext("turn-1"));
    collector.record(tenantSnapshot("turn-1"));
    collector.record({
      kind: "v1_response_plan",
      turnId: "turn-1",
      actionType: "acknowledgment",
      outcomeSummary: "opted_out=false",
      responseDigest: "sha256:not-a-gate-fact",
      responseCharacters: 0,
      latencyMs: 0,
      modelId: null,
      inputTokens: null,
      outputTokens: null,
    });
    collector.record(terminal("turn-1", false));

    const captured = collector.complete("turn-1");
    expect(captured).not.toBeNull();
    expect(buildCapturedV2TurnReads(captured!).gateInput).toEqual({
      status: "unavailable",
      reason: "not_read_by_v1",
    });
  });

  it("isola turns concorrentes e não cruza leituras", () => {
    const collector = new V1ObservationCollector();
    collector.record(turnInput("turn-a", "mensagem A"));
    collector.record(turnInput("turn-b", "mensagem B"));
    for (const [a, b] of gateFacts("turn-a").map((event, index) => [event, gateFacts("turn-b")[index]!] as const)) {
      collector.record(a);
      collector.record(b);
    }
    collector.record(turnContext("turn-b", "mensagem B"));
    collector.record(turnContext("turn-a", "mensagem A"));
    collector.record(tenantSnapshot("turn-b"));
    collector.record(tenantSnapshot("turn-a"));
    collector.record(terminal("turn-a"));
    collector.record(terminal("turn-b"));

    const turnA = collector.complete("turn-a");
    const turnB = collector.complete("turn-b");
    expect(turnA?.sharedReads.input.leadMessage).toBe("mensagem A");
    expect(turnA?.sharedReads.context?.history[0]?.body).toBe("mensagem A");
    expect(turnB?.sharedReads.input.leadMessage).toBe("mensagem B");
    expect(turnB?.sharedReads.context?.history[0]?.body).toBe("mensagem B");
    expect(collector.drain().map((turn) => turn.turnId)).toEqual(["turn-a", "turn-b"]);
    expect(collector.drain()).toEqual([]);
  });

  it("falha fechado ao finalizar turn sem input, contexto, tenant ou terminal", () => {
    const collector = new V1ObservationCollector();
    collector.record(turnInput("missing-terminal"));
    collector.record(turnContext("missing-terminal"));
    collector.record(tenantSnapshot("missing-terminal"));
    expect(collector.complete("missing-terminal")).toBeNull();

    collector.record(turnInput("missing-context"));
    collector.record(tenantSnapshot("missing-context"));
    collector.record(terminal("missing-context"));
    expect(collector.complete("missing-context")).toBeNull();
    expect(collector.drain()).toEqual([]);
  });

  it("restringe o mapper ao projection type sem controlArm", () => {
    expectTypeOf<Parameters<typeof buildCapturedV2TurnReads>[0]>()
      .toEqualTypeOf<CapturedV1TurnSharedProjection>();
    expectTypeOf<CapturedV1Turn>()
      .toMatchTypeOf<CapturedV1TurnSharedProjection>();
    expectTypeOf<keyof CapturedV1TurnSharedProjection>()
      .toEqualTypeOf<"turnId" | "sharedReads">();
  });
});
