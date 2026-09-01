import { describe, expect, it, vi } from "vitest";
import type { Capability } from "@/conversation-core/capability/contract";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import { completeTurnPipeline, prepareTurnPipeline, runTurnPipeline } from "@/conversation-core/turn-pipeline";
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
const unavailablePlaybookKnowledge = {
  resolveDifferentials: vi.fn(),
  resolveFaq: vi.fn(),
};
const unavailableCommercial = { resolveService: vi.fn() };

describe("pipeline operacional dental", () => {
  it("routes institutional knowledge without invoking a write port", async () => {
    const bookSlot = vi.fn();
    const pack = createDentalPack({
      knowledgeRead: {
        resolveBusinessInformation: vi.fn().mockResolvedValue({
          kind: "resolved",
          topic: "address",
          organization: { id: "clinic-1", displayName: "Clínica Exemplo" },
          facts: [{ key: "address", value: "Rua Exemplo, 100" }],
          evidenceRef: "organization:clinic-1:address",
        }),
      },
      playbookKnowledgeRead: unavailablePlaybookKnowledge,
      commercialRead: unavailableCommercial,
      catalogRead: { resolveService: vi.fn(), resolveServices: vi.fn() },
      schedulingRead: {
        listSlots: vi.fn(),
        resolveOfferedSlot: vi.fn(),
        resolvePendingAppointment: vi.fn(),
      },
      schedulingWrite: {
        persistSlotOffer: vi.fn(),
        bookSlot,
        confirmAppointment: vi.fn(),
      },
    });

    const result = await runTurnPipeline({
      gateInput,
      state: { phase: "idle", pendingStepId: null, completedStepIds: [] },
      policy,
      now: new Date("2026-09-01T12:00:00.000Z"),
      understand: async () => ({
        version: UNDERSTANDING_VERSION,
        request: "business-information" as const,
        dialogueMove: "new_topic" as const,
        entities: { businessInformationTopic: "address" },
        signals: {},
        safety: {},
        confidence: 1,
        ambiguity: null,
      }),
      capabilities: pack.capabilities,
      outcomeSchema: pack.outcomeSchema,
      response: {
        style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
        composer: new DeterministicResponseComposer(),
      },
    });

    expect(result).toMatchObject({
      status: "delivered",
      actionResults: [{ type: "business_information_answered" }],
    });
    expect(bookSlot).not.toHaveBeenCalled();
  });

  it("conflito de safety bloqueia reads e writes de todas as capabilities", async () => {
    const resolveService = vi.fn();
    const bookSlot = vi.fn();
    const pack = createDentalPack({
      knowledgeRead: { resolveBusinessInformation: vi.fn() },
      playbookKnowledgeRead: unavailablePlaybookKnowledge,
      commercialRead: unavailableCommercial,
      catalogRead: { resolveService, resolveServices: vi.fn() },
      schedulingRead: {
        listSlots: vi.fn(),
        resolveOfferedSlot: vi.fn(),
        resolvePendingAppointment: vi.fn(),
      },
      schedulingWrite: { persistSlotOffer: vi.fn(), bookSlot, confirmAppointment: vi.fn() },
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
      outcomeSchema: pack.outcomeSchema,
      response: {
        style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
        composer: new DeterministicResponseComposer(),
      },
    });
    expect(result.status).toBe("escalated");
    expect(resolveService).not.toHaveBeenCalled();
    expect(bookSlot).not.toHaveBeenCalled();
  });

  it("keeps slot-offer persistence behind the prepared token", async () => {
    const persistSlotOffer = vi.fn().mockResolvedValue({
      service: { id: "whitening", name: "Clareamento" },
      slots: [{
        id: "dental-slot:persisted-state:1:whitening",
        label: "Ter 18/08 às 15h",
        evidenceRef: "conversation-state:persisted-state:slot:1",
      }],
    });
    const pack = createDentalPack({
      knowledgeRead: { resolveBusinessInformation: vi.fn() },
      playbookKnowledgeRead: unavailablePlaybookKnowledge,
      commercialRead: unavailableCommercial,
      catalogRead: { resolveService: vi.fn(), resolveServices: vi.fn() },
      schedulingRead: {
        listSlots: vi.fn().mockResolvedValue({
          service: { id: "whitening", name: "Clareamento" },
          slots: [{
            id: "candidate:turn-1:1",
            label: "Ter 18/08 às 15h",
            evidenceRef: "candidate:turn-1:1",
          }],
        }),
        resolveOfferedSlot: vi.fn(),
        resolvePendingAppointment: vi.fn(),
      },
      schedulingWrite: {
        persistSlotOffer,
        bookSlot: vi.fn(),
        confirmAppointment: vi.fn(),
      },
    });
    const preparation = await prepareTurnPipeline({
      gateInput,
      state: { phase: "idle", pendingStepId: null, completedStepIds: [] },
      policy,
      now: new Date("2026-08-17T12:00:00.000Z"),
      understand: async () => ({
        version: UNDERSTANDING_VERSION,
        request: "book-appointment" as const,
        dialogueMove: "new_topic" as const,
        entities: { service: "clareamento", date: "amanhã" },
        signals: {}, safety: {}, confidence: 1, ambiguity: null,
      }),
      capabilities: pack.capabilities,
    });

    expect(preparation.status).toBe("prepared");
    expect(persistSlotOffer).not.toHaveBeenCalled();
    if (preparation.status !== "prepared") throw new Error("expected prepared turn");

    const completed = await completeTurnPipeline({
      prepared: preparation.prepared,
      outcomeSchema: pack.outcomeSchema,
      response: {
        style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
        composer: new DeterministicResponseComposer(),
      },
    });

    expect(completed.status).toBe("delivered");
    expect(persistSlotOffer).toHaveBeenCalledOnce();
    expect(completed.status === "delivered" && completed.actionResults[0]).toMatchObject({
      type: "slots_found",
      options: [{ id: "dental-slot:persisted-state:1:whitening" }],
    });
  });

  it("honors the exactly resolved treatment evaluation gate before listing or persisting slots", async () => {
    const persistSlotOffer = vi.fn();
    const listSlots = vi.fn().mockResolvedValue({
      service: {
        id: "facets",
        name: "Facetas",
        requiresEvaluationFirst: true,
      },
      slots: [],
    });
    const pack = createDentalPack({
      knowledgeRead: { resolveBusinessInformation: vi.fn() },
      playbookKnowledgeRead: unavailablePlaybookKnowledge,
      commercialRead: unavailableCommercial,
      catalogRead: { resolveService: vi.fn(), resolveServices: vi.fn() },
      schedulingRead: {
        listSlots,
        resolveOfferedSlot: vi.fn(),
        resolvePendingAppointment: vi.fn(),
      },
      schedulingWrite: {
        persistSlotOffer,
        bookSlot: vi.fn(),
        confirmAppointment: vi.fn(),
      },
    });

    const result = await runTurnPipeline({
      gateInput,
      state: { phase: "idle", pendingStepId: null, completedStepIds: [] },
      policy,
      now: new Date("2026-08-17T12:00:00.000Z"),
      understand: async () => ({
        version: UNDERSTANDING_VERSION,
        request: "book-appointment" as const,
        dialogueMove: "new_topic" as const,
        entities: { service: "facetas", date: "amanhã" },
        signals: {}, safety: {}, confidence: 1, ambiguity: null,
      }),
      capabilities: pack.capabilities,
      outcomeSchema: pack.outcomeSchema,
      response: {
        style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
        composer: new DeterministicResponseComposer(),
      },
    });

    expect(listSlots).toHaveBeenCalledOnce();
    expect(persistSlotOffer).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "delivered",
      actionResults: [{ type: "clarification_required" }],
    });
  });

  it("dependency ausente bloqueia execute", async () => {
    let writes = 0;
    const outcomeSchema = defineOutcomeSchema({
      written: {
        semanticClass: "effect_completed",
        subjectRequirement: "required",
        evidenceRequirement: "optional",
      },
    } as const);
    const dependent: Capability<
      "work", Record<string, never>, Record<never, never>, typeof outcomeSchema
    > = {
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
          origin: { capabilityId: "dependent" }, subject: { type: "work", id: "written", displayName: "Written" }, evidence: [], facts: [],
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
      outcomeSchema,
      response: {
        style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
        composer: new DeterministicResponseComposer(),
      },
    });
    expect(result.status).toBe("escalated");
    expect(writes).toBe(0);
  });
});
