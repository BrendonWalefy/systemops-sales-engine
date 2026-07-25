import { describe, expect, it } from "vitest";
import {
  DECISION_TRACE_SCHEMA_VERSION,
  InMemoryDecisionTraceSink,
  recordDeterministicDecisionTraceCompletion,
  recordDecisionTrace,
  type DecisionTraceSink,
} from "@/core/observability/DecisionTrace";

describe("DecisionTrace", () => {
  it("mantém sequência independente por turno e permite filtrar a captura", async () => {
    const sink = new InMemoryDecisionTraceSink();

    await recordDecisionTrace(sink, {
      turnId: "turn-1",
      stage: "ingress.received",
      occurredAt: "2026-07-24T12:00:00.000Z",
      clinicId: "clinic-1",
    });
    await recordDecisionTrace(sink, {
      turnId: "turn-2",
      stage: "ingress.received",
      occurredAt: "2026-07-24T12:00:01.000Z",
      clinicId: "clinic-2",
    });
    await recordDecisionTrace(sink, {
      turnId: "turn-1",
      stage: "orchestrator.started",
      occurredAt: "2026-07-24T12:00:02.000Z",
      clinicId: "clinic-1",
    });

    expect(sink.getEvents("turn-1")).toEqual([
      expect.objectContaining({
        schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
        turnId: "turn-1",
        sequence: 0,
        stage: "ingress.received",
      }),
      expect.objectContaining({
        schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
        turnId: "turn-1",
        sequence: 1,
        stage: "orchestrator.started",
      }),
    ]);
    expect(sink.getEvents("turn-2")[0]?.sequence).toBe(0);
  });

  it("não deixa uma falha de observabilidade interromper o atendimento", async () => {
    const brokenSink: DecisionTraceSink = {
      record() {
        throw new Error("trace unavailable");
      },
    };

    await expect(
      recordDecisionTrace(brokenSink, {
        turnId: "turn-1",
        stage: "turn.failed",
        occurredAt: "2026-07-24T12:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });

  it("completa apenas os estágios pulados por uma decisão determinística", async () => {
    const sink = new InMemoryDecisionTraceSink();

    await recordDeterministicDecisionTraceCompletion(sink, {
      turnId: "turn-media",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      state: "awaiting_human_review",
      source: "human_review_media",
      classifiedIntent: "needs_human",
      finalIntent: "needs_human",
      confidence: 1,
      missingStages: [
        "state.loaded",
        "intent.classified",
        "intent.resolved",
      ],
    });

    expect(sink.getEvents("turn-media")).toEqual([
      expect.objectContaining({
        sequence: 0,
        stage: "state.loaded",
        metadata: expect.objectContaining({
          state: "awaiting_human_review",
          source: "human_review_media",
          deterministic: true,
        }),
      }),
      expect.objectContaining({
        sequence: 1,
        stage: "intent.classified",
        metadata: expect.objectContaining({
          intent: "needs_human",
          confidence: 1,
        }),
      }),
      expect.objectContaining({
        sequence: 2,
        stage: "intent.resolved",
        metadata: expect.objectContaining({
          finalIntent: "needs_human",
          classifierOverridden: false,
        }),
      }),
    ]);
  });

  it("não duplica os estágios que o ramo determinístico já registrou", async () => {
    const sink = new InMemoryDecisionTraceSink();

    await recordDeterministicDecisionTraceCompletion(sink, {
      turnId: "turn-opt-out",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      state: "none",
      source: "stop_contact_policy",
      classifiedIntent: "stop_contact",
      finalIntent: "stop_contact",
      missingStages: ["intent.resolved"],
    });

    expect(sink.getEvents("turn-opt-out").map((event) => event.stage)).toEqual([
      "intent.resolved",
    ]);
  });
});
