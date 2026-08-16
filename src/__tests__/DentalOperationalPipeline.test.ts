import { describe, expect, it, vi } from "vitest";
import type { Capability } from "@/conversation-core/capability/contract";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { runTurnPipeline } from "@/conversation-core/turn-pipeline";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import { createDentalPack, type DentalPolicy } from "@/domain-packs/dental";

const policy: DentalPolicy = {
  priceDisclosureEnabled: true,
  humanEscalationRequired: false,
  schedulingMinimumLeadTimeHours: 2,
  schedulingRequiresEvaluationFirst: false,
};
const gateInput = {
  automationEnabled: true,
  duplicate: false,
  humanControlled: false,
  optedOut: false,
};

describe("pipeline operacional dental", () => {
  it("conflito de safety bloqueia reads e writes de todas as capabilities", async () => {
    const resolveService = vi.fn();
    const bookSlot = vi.fn();
    const pack = createDentalPack({
      catalogRead: { resolveService },
      schedulingRead: {
        listSlots: vi.fn(),
        resolveOfferedSlot: vi.fn(),
        resolvePendingAppointment: vi.fn(),
      },
      schedulingWrite: { bookSlot, confirmAppointment: vi.fn() },
    });
    const result = await runTurnPipeline({
      gateInput,
      state: { phase: "active", pendingStepId: null, completedStepIds: [] },
      policy,
      now: new Date(0),
      understand: async () => ({
        version: UNDERSTANDING_VERSION,
        request: "price-of-service",
        dialogueMove: "new_topic",
        entities: { service: "clareamento" },
        signals: {},
        safety: { requestsHuman: true },
        confidence: 1,
        ambiguity: null,
      }),
      capabilities: pack.capabilities,
      buildPlan: buildV2AuthorizedResponsePlan,
      compose: async () => ({ text: "unreachable", parts: [] }),
      validate: () => true,
    });
    expect(result.status).toBe("escalated");
    expect(resolveService).not.toHaveBeenCalled();
    expect(bookSlot).not.toHaveBeenCalled();
  });

  it("dependency ausente bloqueia execute", async () => {
    let writes = 0;
    const dependent: Capability<"work", Record<string, never>> = {
      id: "dependent",
      claim: () => ({
        capabilityId: "dependent",
        confidence: 1,
        reason: "test",
        payload: {},
        dependsOn: ["missing"],
      }),
      decide: async () => ({ kind: "close" }),
      execute: async () => {
        writes += 1;
        return {
          type: "written", semanticClass: "effect_completed",
          origin: { capabilityId: "dependent" }, subject: { type: "work", id: "written" }, evidence: [], facts: [],
        };
      },
    };
    const result = await runTurnPipeline({
      gateInput,
      state: { phase: "active", pendingStepId: null, completedStepIds: [] },
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
      capabilities: [dependent],
      buildPlan: buildV2AuthorizedResponsePlan,
      compose: async () => ({ text: "unreachable", parts: [] }),
      validate: () => true,
    });
    expect(result.status).toBe("escalated");
    expect(writes).toBe(0);
  });
});
