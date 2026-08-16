import { describe, expect, it, vi } from "vitest";
import type { Capability } from "@/conversation-core/capability/contract";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import { defineOutcomeSchema, type Decision } from "@/conversation-core/decision";
import {
  completeTurnPipeline,
  prepareTurnPipeline,
  runTurnPipeline,
  type PreparedTurn,
} from "@/conversation-core/turn-pipeline";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";

const outcomeSchema = defineOutcomeSchema({
  work_completed: {
    semanticClass: "effect_completed",
    subjectRequirement: "required",
    evidenceRequirement: "optional",
  },
} as const);
const noSafeResponseSchema = defineOutcomeSchema({
  no_safe_response: {
    semanticClass: "information_authorized",
    subjectRequirement: "forbidden",
    evidenceRequirement: "optional",
  },
} as const);
type WorkCapability = Capability<
  "work",
  Record<string, never>,
  Record<never, never>,
  typeof outcomeSchema
>;

const gateInput = {
  automationEnabled: true,
  duplicate: false,
  humanControlled: false,
  optedOut: false,
};
const state = { phase: "ready", pendingStepId: null, completedStepIds: [] };
const style = { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" } as const;
const response = { style, composer: new DeterministicResponseComposer() };

function understand() {
  return {
    version: UNDERSTANDING_VERSION,
    request: "work" as const,
    dialogueMove: "new_topic" as const,
    entities: {},
    signals: {},
    safety: {},
    confidence: 1,
    ambiguity: null,
  };
}

function completed(capabilityId: string) {
  return {
    type: "work_completed" as const,
    semanticClass: "effect_completed" as const,
    origin: { capabilityId },
    subject: { type: "work", id: capabilityId, displayName: capabilityId },
    evidence: [],
    facts: [],
  };
}

function capability(input: {
  id: string;
  decision?: Decision;
  execute?: WorkCapability["execute"];
  claim?: WorkCapability["claim"];
  decide?: WorkCapability["decide"];
}): WorkCapability {
  return {
    id: input.id,
    claim: input.claim ?? (() => ({
      capabilityId: input.id,
      confidence: 1,
      reason: "test",
      payload: {},
    })),
    decide: input.decide ?? (async () => input.decision ?? { kind: "close" }),
    execute: input.execute ?? (async () => completed(input.id)),
  };
}

describe("preparação do turno V2", () => {
  it("conclui entendimento, claims e decisões antes de qualquer execute", async () => {
    const events: string[] = [];
    const now = new Date("2026-08-16T12:00:00.000Z");
    const decision: Decision = {
      kind: "answer",
      facts: [{
        key: "amount",
        value: { kind: "integer", value: 37 },
        subject: null,
        evidence: { source: "policy", reference: "amount" },
        disclosure: "allowed",
      }],
      nextBestStep: { id: "next", repeatPolicy: "once_until_answered" },
    };
    const capabilities = ["alpha", "beta"].map((id) => capability({
      id,
      decision,
      claim: () => {
        events.push(`claim:${id}`);
        return { capabilityId: id, confidence: 1, reason: "test", payload: {} };
      },
      decide: async (_claim, context) => {
        events.push(`decide:${id}`);
        expect(context.now).not.toBe(now);
        expect(context.now).toEqual(now);
        return decision;
      },
      execute: async () => {
        events.push(`execute:${id}`);
        return completed(id);
      },
    }));

    const result = await prepareTurnPipeline({
      gateInput,
      state,
      policy: {},
      now,
      understand: async () => {
        events.push("understand");
        return understand();
      },
      capabilities,
    });

    expect(events).toEqual(["understand", "claim:alpha", "claim:beta", "decide:alpha", "decide:beta"]);
    expect(result.status).toBe("prepared");
    if (result.status !== "prepared") throw new Error("expected prepared turn");
    expect(result.prepared.capabilityIds).toEqual(["alpha", "beta"]);
    expect(Object.isFrozen(result.prepared)).toBe(true);
    expect(Object.isFrozen(result.prepared.capabilityIds)).toBe(true);
    expect(Object.isFrozen(result.prepared.decisions)).toBe(true);
    expect(Object.isFrozen(result.prepared.decisions[0])).toBe(true);
    expect(Object.isFrozen(result.prepared.decisions[0]!.decision)).toBe(true);
    const preparedDecision = result.prepared.decisions[0]!.decision;
    if (preparedDecision.kind !== "answer") throw new Error("expected answer decision");
    expect(Object.isFrozen(preparedDecision.facts)).toBe(true);
    expect(Object.isFrozen(preparedDecision.facts[0])).toBe(true);
    expect(Object.isFrozen(preparedDecision.facts[0]!.value)).toBe(true);
  });

  it("usa na execução exatamente o snapshot de decisão preparado, sem aliases mutáveis", async () => {
    const source: Decision = {
      kind: "answer",
      facts: [{
        key: "amount",
        value: { kind: "integer", value: 37 },
        subject: null,
        evidence: { source: "policy", reference: "amount" },
        disclosure: "allowed",
      }],
      nextBestStep: null,
    };
    const execute = vi.fn(async (...args: Parameters<WorkCapability["execute"]>) => {
      void args;
      return completed("alpha");
    });
    const prepared = await prepareTurnPipeline({
      gateInput, state, policy: {}, now: new Date(0), understand: async () => understand(),
      capabilities: [capability({ id: "alpha", decision: source, execute })],
    });
    if (prepared.status !== "prepared") throw new Error("expected prepared turn");

    (source.facts[0]!.value as { value: number }).value = 99;
    await completeTurnPipeline({ prepared: prepared.prepared, outcomeSchema, response });

    expect(execute).toHaveBeenCalledTimes(1);
    const executedDecision = execute.mock.calls[0]![0];
    expect(executedDecision).toBe(prepared.prepared.decisions[0]!.decision);
    expect(executedDecision).toEqual(expect.objectContaining({
      kind: "answer",
      facts: [expect.objectContaining({ value: { kind: "integer", value: 37 } })],
    }));
  });

  it("rejeita getter e proxy antes de criar um PreparedTurn", async () => {
    let accessorReads = 0;
    const accessor = Object.defineProperty({}, "kind", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "close";
      },
    }) as Decision;
    const proxy = new Proxy({ kind: "close" }, {}) as Decision;

    await expect(prepareTurnPipeline({
      gateInput, state, policy: {}, now: new Date(0), understand: async () => understand(),
      capabilities: [capability({ id: "accessor", decision: accessor })],
    })).rejects.toThrow(/invalid decision shape/i);
    expect(accessorReads).toBe(0);
    await expect(prepareTurnPipeline({
      gateInput, state, policy: {}, now: new Date(0), understand: async () => understand(),
      capabilities: [capability({ id: "proxy", decision: proxy })],
    })).rejects.toThrow(/decision could not be canonicalized/i);
  });

  it("rejeita preparação forjada fora do registry privado", async () => {
    const forged = {
      capabilityIds: [],
      decisions: [],
    } as unknown as PreparedTurn<"work", Record<string, never>, Record<never, never>, typeof outcomeSchema>;

    await expect(completeTurnPipeline({ prepared: forged, outcomeSchema, response }))
      .rejects.toThrow("unregistered prepared turn");
  });

  it("executa cada capability uma vez e mantém a checagem de owner", async () => {
    const alpha = vi.fn(async () => completed("alpha"));
    const beta = vi.fn(async () => completed("beta"));
    const prepared = await prepareTurnPipeline({
      gateInput, state, policy: {}, now: new Date(0), understand: async () => understand(),
      capabilities: [
        capability({ id: "alpha", execute: alpha }),
        capability({ id: "beta", execute: beta }),
      ],
    });
    if (prepared.status !== "prepared") throw new Error("expected prepared turn");

    const result = await completeTurnPipeline({ prepared: prepared.prepared, outcomeSchema, response });

    expect(alpha).toHaveBeenCalledTimes(1);
    expect(beta).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("delivered");

    const forgedOwner = await prepareTurnPipeline({
      gateInput, state, policy: {}, now: new Date(0), understand: async () => understand(),
      capabilities: [capability({
        id: "alpha",
        execute: async () => completed("other"),
      })],
    });
    if (forgedOwner.status !== "prepared") throw new Error("expected prepared turn");
    await expect(completeTurnPipeline({ prepared: forgedOwner.prepared, outcomeSchema, response }))
      .rejects.toThrow("action result owner mismatch: other");
  });

  it("consome uma preparação antes de executar para impedir duplicação de efeito", async () => {
    const execute = vi.fn(async () => completed("alpha"));
    const preparation = await prepareTurnPipeline({
      gateInput, state, policy: {}, now: new Date(0), understand: async () => understand(),
      capabilities: [capability({ id: "alpha", execute })],
    });
    if (preparation.status !== "prepared") throw new Error("expected prepared turn");

    await completeTurnPipeline({ prepared: preparation.prepared, outcomeSchema, response });
    await expect(completeTurnPipeline({ prepared: preparation.prepared, outcomeSchema, response }))
      .rejects.toThrow("unregistered prepared turn");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("mantém os estados de gate, clarification e conflito no wrapper legado", async () => {
    const base = {
      state,
      policy: {},
      now: new Date(0),
      understand: async () => understand(),
      outcomeSchema,
      response,
    };
    await expect(runTurnPipeline({
      ...base,
      gateInput: { ...gateInput, duplicate: true },
      capabilities: [],
    })).resolves.toEqual({ status: "suppressed", reason: "duplicate" });
    await expect(runTurnPipeline({ ...base, gateInput, capabilities: [] }))
      .resolves.toEqual({ status: "needs_clarification" });
    await expect(runTurnPipeline({
      ...base,
      gateInput,
      capabilities: [
        capability({ id: "alpha", claim: () => ({ capabilityId: "alpha", confidence: 1, reason: "test", payload: {}, conflictsWith: ["beta"] }) }),
        capability({ id: "beta", claim: () => ({ capabilityId: "beta", confidence: 1, reason: "test", payload: {}, conflictsWith: ["alpha"] }) }),
      ],
    })).resolves.toEqual({
      status: "escalated",
      reason: "capability_conflict",
      capabilityIds: ["alpha", "beta"],
    });
  });

  it("mantém rejected e os actionResults quando o composer não tem resposta segura", async () => {
    const capabilityWithoutSafeResponse: Capability<
      "work",
      Record<string, never>,
      Record<never, never>,
      typeof noSafeResponseSchema
    > = {
      id: "no-safe-response",
      claim: () => ({ capabilityId: "no-safe-response", confidence: 1, reason: "test", payload: {} }),
      decide: async () => ({ kind: "close" }),
      execute: async () => ({
        type: "no_safe_response",
        semanticClass: "information_authorized",
        origin: { capabilityId: "no-safe-response" },
        subject: null,
        evidence: [],
        facts: [],
      }),
    };

    await expect(runTurnPipeline({
      gateInput,
      state,
      policy: {},
      now: new Date(0),
      understand: async () => understand(),
      capabilities: [capabilityWithoutSafeResponse],
      outcomeSchema: noSafeResponseSchema,
      response: { style, composer: { compose: async () => ({ acts: [] }) } },
    })).resolves.toEqual({
      status: "rejected",
      actionResults: [{
        type: "no_safe_response",
        semanticClass: "information_authorized",
        origin: { capabilityId: "no-safe-response" },
        subject: null,
        evidence: [],
        facts: [],
      }],
    });
  });
});
