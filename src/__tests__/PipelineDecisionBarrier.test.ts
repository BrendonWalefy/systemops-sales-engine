import { describe, expect, it } from "vitest";
import type { Capability } from "@/conversation-core/capability/contract";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import { runTurnPipeline } from "@/conversation-core/turn-pipeline";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";

describe("barreira entre decisão e efeitos", () => {
  it("não executa a primeira capability quando uma decisão posterior falha", async () => {
    let writes = 0;
    const outcomeSchema = defineOutcomeSchema({
      work_completed: {
        semanticClass: "effect_completed",
        subjectRequirement: "required",
        evidenceRequirement: "optional",
      },
    } as const);
    const capability = (id: string, fails: boolean): Capability<
      "work", Record<string, never>, Record<never, never>, typeof outcomeSchema
    > => ({
      id,
      claim: () => ({
        capabilityId: id,
        confidence: 1,
        reason: "test",
        payload: {},
      }),
      decide: async () => {
        if (fails) throw new Error("authorized read failed");
        return { kind: "close" };
      },
      execute: async () => {
        writes += 1;
        return {
          type: "work_completed", semanticClass: "effect_completed",
          origin: { capabilityId: id }, subject: { type: "work", id, displayName: id }, evidence: [], facts: [],
        };
      },
    });

    await expect(
      runTurnPipeline({
        gateInput: {
          automationEnabled: true,
          duplicate: false,
          humanControlled: false,
          optedOut: false,
        },
        state: { phase: "ready", pendingStepId: null, completedStepIds: [] },
        policy: {},
        now: new Date(0),
        understand: async () => ({
          version: UNDERSTANDING_VERSION,
          request: "work",
          dialogueMove: "new_topic",
          entities: {},
          signals: {},
          safety: {},
          confidence: 1,
          ambiguity: null,
        }),
        capabilities: [capability("first", false), capability("second", true)],
        outcomeSchema,
        response: {
          style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
          composer: new DeterministicResponseComposer(),
        },
      }),
    ).rejects.toThrow("authorized read failed");
    expect(writes).toBe(0);
  });
});
