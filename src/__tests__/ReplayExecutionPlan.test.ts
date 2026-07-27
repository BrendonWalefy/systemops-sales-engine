import { describe, expect, it } from "vitest";
import type { ReplayScenarioV1 } from "@/application/replay/contracts";
import { buildReplayExecutionGroups } from "@/application/replay/replay-execution-plan";

const scenario = {
  turns: [
    { id: "lead-1", author: "lead", offsetMs: 0 },
    { id: "lead-2", author: "lead", offsetMs: 1_000 },
    { id: "agent-1", author: "agent", offsetMs: 2_000 },
    { id: "lead-3", author: "lead", offsetMs: 3_000 },
    { id: "lead-4", author: "lead", offsetMs: 10_000 },
  ].map((turn) => ({
    ...turn,
    content: { type: "text" as const, text: turn.id },
  })),
} as ReplayScenarioV1;

describe("buildReplayExecutionGroups", () => {
  it("mantém cada mensagem isolada no closed loop", () => {
    expect(
      buildReplayExecutionGroups(scenario, "closed_loop").map((group) =>
        group.map((turn) => turn.id),
      ),
    ).toEqual([["lead-1"], ["lead-2"], ["lead-3"], ["lead-4"]]);
  });

  it("agrupa só mensagens consecutivas do lead dentro da janela", () => {
    expect(
      buildReplayExecutionGroups(scenario, "concurrency").map((group) =>
        group.map((turn) => turn.id),
      ),
    ).toEqual([["lead-1", "lead-2"], ["lead-3"], ["lead-4"]]);
  });
});
