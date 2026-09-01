import { describe, expect, it } from "vitest";
import type {
  CapabilityContext,
  ConversationState,
} from "@/conversation-core/capability/contract";
import type { Understanding } from "@/conversation-core/understanding/schema";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import type { DentalPolicy } from "@/domain-packs/dental/capabilities";
import { DENTAL_OUTCOME_SCHEMA } from "@/domain-packs/dental/capabilities";
import { createDentalKnowledgeCapability } from "@/domain-packs/dental/knowledge-capability";
import type {
  DentalBusinessInformationResolution,
  DentalKnowledgeReadPort,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const state: ConversationState = {
  phase: "idle",
  pendingStepId: null,
  completedStepIds: [],
};

const context: CapabilityContext<DentalPolicy> = {
  state,
  policy: {
    priceDisclosureEnabled: true,
    humanEscalationRequired: false,
    schedulingMinimumLeadTimeHours: 2,
    schedulingRequiresEvaluationFirst: false,
  },
  now: new Date("2026-09-01T12:00:00.000Z"),
};

function understanding(
  overrides: Partial<Understanding<DentalRequest>> = {},
): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request: "business-information",
    dialogueMove: "new_topic",
    entities: {
      service: null,
      businessInformationTopic: "address",
      date: null,
      period: null,
      time: null,
      serviceCandidates: null,
      quantity: null,
      ordinal: null,
    },
    signals: {
      purchaseIntent: null,
      priceSensitivity: null,
      sentiment: null,
      objection: null,
    },
    safety: { optOut: false, requestsHuman: false, emergency: false },
    confidence: 0.9,
    ambiguity: null,
    ...overrides,
  } as Understanding<DentalRequest>;
}

function knowledge(
  resolution: DentalBusinessInformationResolution,
): DentalKnowledgeReadPort {
  return { resolveBusinessInformation: async () => resolution };
}

function resolved(value = "Rua Exemplo, 100"): DentalBusinessInformationResolution {
  return {
    kind: "resolved",
    topic: "address",
    organization: { id: "clinic-1", displayName: "Clínica Exemplo" },
    facts: [{ key: "address", value }],
    evidenceRef: "organization:clinic-1:address",
  };
}

describe("capability de conhecimento institucional", () => {
  it("autoriza somente o fato institucional resolvido para a organização", async () => {
    const capability = createDentalKnowledgeCapability(knowledge(resolved()));
    const claim = capability.claim(understanding(), state)!;

    const decision = await capability.decide(claim, context);
    const result = await capability.execute(decision, context);

    expect(claim).toMatchObject({
      capabilityId: "dental-knowledge",
      payload: { kind: "business-information", topic: "address" },
    });
    expect(decision).toMatchObject({
      kind: "answer",
      facts: [{
        key: "address",
        value: { kind: "display_text", value: "Rua Exemplo, 100" },
        subject: { type: "organization", id: "clinic-1", displayName: "Clínica Exemplo" },
        evidence: { source: "read", reference: "organization:clinic-1:address" },
        disclosure: "allowed",
      }],
    });
    expect(result).toMatchObject({
      type: "business_information_answered",
      semanticClass: "information_authorized",
      origin: { capabilityId: "dental-knowledge" },
      subject: { type: "organization", id: "clinic-1" },
    });
    expect(DENTAL_OUTCOME_SCHEMA[result.type].semanticClass).toBe("information_authorized");
  });

  it("pede esclarecimento quando a fonte canônica não possui o dado", async () => {
    const capability = createDentalKnowledgeCapability(knowledge({
      kind: "missing",
      topic: "parking",
      evidenceRef: "organization:clinic-1:parking:missing",
    }));
    const claim = capability.claim(understanding({
      entities: {
        ...understanding().entities,
        businessInformationTopic: "parking",
      },
    }), state)!;

    const decision = await capability.decide(claim, context);
    const result = await capability.execute(decision, context);

    expect(decision).toEqual({ kind: "ask", questionId: "business-information-not-registered" });
    expect(result).toMatchObject({
      type: "clarification_required",
      origin: { capabilityId: "dental-knowledge" },
      facts: [],
    });
  });

  it.each([
    ["emergência", { emergency: true, requestsHuman: false }],
    ["pedido humano", { emergency: false, requestsHuman: true }],
  ])("não reivindica %s", (_label, safety) => {
    const capability = createDentalKnowledgeCapability(knowledge(resolved()));

    expect(capability.claim(understanding({
      safety: { optOut: false, ...safety },
    }), state)).toBeNull();
  });

  it("não reivindica pedido pertencente a outro domínio", () => {
    const capability = createDentalKnowledgeCapability(knowledge(resolved()));

    expect(capability.claim(understanding({
      request: "price-of-service",
      entities: {
        ...understanding().entities,
        service: "clareamento",
        businessInformationTopic: null,
      },
    }), state)).toBeNull();
  });

  it.each([
    ["vazio", ""],
    ["não normalizado", " Rua Exemplo, 100 "],
    ["acima do limite", "x".repeat(241)],
  ])("não autoriza texto %s", async (_label, value) => {
    const capability = createDentalKnowledgeCapability(knowledge(resolved(value)));
    const claim = capability.claim(understanding(), state)!;

    const decision = await capability.decide(claim, context);

    expect(decision).toEqual({ kind: "ask", questionId: "business-information-not-registered" });
    expect(decision.kind).not.toBe("execute");
  });
});
