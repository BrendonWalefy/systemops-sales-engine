import { describe, expect, it } from "vitest";
import { isReplayTurnTraceComplete } from "@/application/replay/replay-trace-contract";

const base = [
  { turnId: "turn-1", stage: "ingress.received" },
  { turnId: "turn-1", stage: "orchestrator.started" },
];

describe("ReplayTraceContract", () => {
  it("aceita resposta somente com decisão, outbox e entrega completas", () => {
    expect(isReplayTurnTraceComplete([
      ...base,
      { turnId: "turn-1", stage: "state.loaded" },
      { turnId: "turn-1", stage: "intent.classified" },
      { turnId: "turn-1", stage: "intent.resolved" },
      { turnId: "turn-1", stage: "outbound.enqueued" },
      {
        turnId: "turn-1",
        stage: "orchestrator.completed",
        metadata: { replied: true },
      },
      { turnId: "turn-1", stage: "delivery.sent" },
    ], "turn-1")).toBe(true);
  });

  it("aceita silêncio intencional somente com turn.ignored e sem entrega", () => {
    expect(isReplayTurnTraceComplete([
      ...base,
      {
        turnId: "turn-1",
        stage: "orchestrator.completed",
        metadata: { replied: false },
      },
      {
        turnId: "turn-1",
        stage: "turn.ignored",
        metadata: { reason: "ai_paused" },
      },
    ], "turn-1")).toBe(true);
  });

  it("recusa silêncio ambíguo ou contraditório", () => {
    const completedWithoutReason = [
      ...base,
      {
        turnId: "turn-1",
        stage: "orchestrator.completed",
        metadata: { replied: false },
      },
    ];
    expect(isReplayTurnTraceComplete(
      completedWithoutReason,
      "turn-1",
    )).toBe(false);
    expect(isReplayTurnTraceComplete([
      ...completedWithoutReason,
      { turnId: "turn-1", stage: "turn.ignored" },
      { turnId: "turn-1", stage: "outbound.enqueued" },
    ], "turn-1")).toBe(false);
  });
});
