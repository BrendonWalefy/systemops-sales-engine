import { describe, expect, it } from "vitest";
import type { Capability } from "@/conversation-core/capability/contract";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import {
  completeTurnPipeline,
  prepareTurnPipeline,
  runTurnPipeline,
} from "@/conversation-core/turn-pipeline";
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

  it("valida provenance no mesmo snapshot usado para construir o plano", async () => {
    let originReads = 0;
    const outcomeSchema = defineOutcomeSchema({
      work_completed: {
        semanticClass: "effect_completed",
        subjectRequirement: "required",
        evidenceRequirement: "optional",
      },
    } as const);
    const capability: Capability<
      "work", Record<string, never>, Record<never, never>, typeof outcomeSchema
    > = {
      id: "cap",
      claim: () => ({ capabilityId: "cap", confidence: 1, reason: "test", payload: {} }),
      decide: async () => ({ kind: "close" }),
      execute: async () => Object.defineProperty({
        type: "work_completed",
        semanticClass: "effect_completed",
        subject: { type: "work", id: "work", displayName: "Work" },
        evidence: [],
        facts: [],
      }, "origin", {
        enumerable: true,
        get() {
          originReads += 1;
          return { capabilityId: originReads === 1 ? "cap" : "other" };
        },
      }) as never,
    };

    const result = await runTurnPipeline({
      gateInput: { automationEnabled: true, duplicate: false, humanControlled: false, optedOut: false },
      state: { phase: "ready", pendingStepId: null, completedStepIds: [] },
      policy: {},
      now: new Date(0),
      understand: async () => ({
        version: UNDERSTANDING_VERSION,
        request: "work",
        dialogueMove: "new_topic",
        entities: {}, signals: {}, safety: {}, confidence: 1, ambiguity: null,
      }),
      capabilities: [capability],
      outcomeSchema,
      response: {
        style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
        composer: new DeterministicResponseComposer(),
      },
    });
    expect(result.status).toBe("delivered");
    if (result.status !== "delivered") throw new Error("expected delivered");
    expect(result.actionResults[0]?.origin.capabilityId).toBe("cap");
    expect(originReads).toBe(1);
  });

  it("exposes canonical action results once before response composition", async () => {
    const outcomeSchema = defineOutcomeSchema({
      work_completed: {
        semanticClass: "effect_completed",
        subjectRequirement: "required",
        evidenceRequirement: "optional",
      },
    } as const);
    const events: string[] = [];
    const capability: Capability<
      "work", Record<string, never>, Record<never, never>, typeof outcomeSchema
    > = {
      id: "cap",
      claim: () => ({ capabilityId: "cap", confidence: 1, reason: "test", payload: {} }),
      decide: async () => ({ kind: "close" }),
      execute: async () => ({
        type: "work_completed",
        semanticClass: "effect_completed",
        origin: { capabilityId: "cap" },
        subject: { type: "work", id: "work", displayName: "Work" },
        evidence: [], facts: [],
      }),
    };
    const preparation = await prepareTurnPipeline({
      gateInput: { automationEnabled: true, duplicate: false, humanControlled: false, optedOut: false },
      state: { phase: "ready", pendingStepId: null, completedStepIds: [] },
      policy: {},
      now: new Date(0),
      understand: async () => ({
        version: UNDERSTANDING_VERSION,
        request: "work",
        dialogueMove: "new_topic",
        entities: {}, signals: {}, safety: {}, confidence: 1, ambiguity: null,
      }),
      capabilities: [capability],
    });
    if (preparation.status !== "prepared") throw new Error("expected prepared turn");

    const result = await completeTurnPipeline({
      prepared: preparation.prepared,
      outcomeSchema,
      onActionResults(actionResults) {
        events.push(`action:${actionResults[0]?.type}`);
      },
      response: {
        style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
        composer: {
          compose: async () => {
            events.push("compose");
            return { acts: [] };
          },
        },
      },
    });

    expect(result.status).toBe("delivered");
    expect(events).toEqual(["action:work_completed", "compose"]);
  });
});
