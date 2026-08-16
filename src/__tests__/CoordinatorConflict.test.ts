import { describe, expect, it } from "vitest";
import type { Capability } from "@/conversation-core/capability/contract";
import { runTurnPipeline } from "@/conversation-core/turn-pipeline";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";

describe("conflitos entre capabilities", () => {
  it("escala antes de qualquer efeito quando claims são incompatíveis", async () => {
    let executions = 0;
    const capability = (
      id: string,
      conflictsWith: string,
    ): Capability<"work", Record<string, never>> => ({
      id,
      claim: () => ({ capabilityId: id, confidence: 1, reason: "fixture", attributes: {}, conflictsWith: [conflictsWith] }),
      decide: async () => ({ kind: "close" }),
      execute: async () => {
        executions += 1;
        return { type: `${id}_executed`, facts: [] };
      },
    });

    const result = await runTurnPipeline({
      gateInput: {
        automationEnabled: true,
        duplicate: false,
        humanControlled: false,
        optedOut: false,
      },
      state: { phase: "ready", pendingStepId: null, completedStepIds: [] },
      policy: {},
      now: new Date("2026-08-16T12:00:00.000Z"),
      understand: async () => ({
        version: UNDERSTANDING_VERSION,
        request: "work",
        dialogueMove: "new_topic",
        entities: {}, signals: {}, safety: {}, confidence: 1, ambiguity: null,
      }),
      capabilities: [capability("alpha", "beta"), capability("beta", "alpha")],
      buildPlan: () => ({}),
      compose: async () => ({ text: "unreachable", parts: [] }),
      validate: () => true,
    });

    expect(result).toEqual({
      status: "escalated",
      reason: "capability_conflict",
      capabilityIds: ["alpha", "beta"],
    });
    expect(executions).toBe(0);
  });
});
