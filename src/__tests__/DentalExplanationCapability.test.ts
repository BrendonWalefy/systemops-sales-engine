import { describe, expect, it } from "vitest";
import type { CapabilityContext, ConversationState } from "@/conversation-core/capability/contract";
import type { Understanding } from "@/conversation-core/understanding/schema";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import { DENTAL_OUTCOME_SCHEMA, type DentalPolicy } from "@/domain-packs/dental/capabilities";
import { createDentalExplanationCapability } from "@/domain-packs/dental/explanation-capability";
import type { DentalCatalogReadPort, ServiceResolution } from "@/domain-packs/dental/ports";
import { parseDentalUnderstanding } from "@/domain-packs/dental/understanding";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const state: ConversationState = { phase: "idle", pendingStepId: null, completedStepIds: [] };
const context: CapabilityContext<DentalPolicy> = {
  state,
  policy: {
    priceDisclosureEnabled: true,
    humanEscalationRequired: false,
    schedulingMinimumLeadTimeHours: 2,
    schedulingRequiresEvaluationFirst: false,
  },
  now: new Date("2026-08-19T12:00:00.000Z"),
};

function understanding(overrides: Partial<Understanding<DentalRequest>> = {}): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request: "explain-service",
    dialogueMove: "new_topic",
    entities: { service: "lente de contato" },
    signals: {},
    safety: {},
    confidence: 0.9,
    ambiguity: null,
    ...overrides,
  } as Understanding<DentalRequest>;
}

function catalog(resolution: ServiceResolution): DentalCatalogReadPort {
  return { resolveService: async () => resolution };
}

const described: ServiceResolution = {
  kind: "exact",
  service: {
    id: "service-1",
    name: "Lentes de resina",
    priceCents: 400_000,
    priceDisclosable: true,
    description: "Camadas finas de resina aplicadas na frente dos dentes para mudar cor e formato.",
  },
  evidenceRef: "treatment:service-1",
};

describe("capability de explicação dental", () => {
  it("reivindica o turno em que o lead pergunta o que é o procedimento", () => {
    const capability = createDentalExplanationCapability(catalog(described));

    expect(capability.claim(understanding(), state)).toMatchObject({
      capabilityId: "dental-explanation",
      payload: { kind: "explanation", serviceQuery: "lente de contato" },
    });
  });

  it("não reivindica pedido de preço, que tem dono", () => {
    const capability = createDentalExplanationCapability(catalog(described));

    expect(capability.claim(understanding({ request: "price-of-service" }), state)).toBeNull();
  });

  it("devolve a descrição cadastrada como fato divulgável do próprio serviço", async () => {
    const capability = createDentalExplanationCapability(catalog(described));
    const claim = capability.claim(understanding(), state)!;

    const result = await capability.execute(await capability.decide(claim, context), context);

    expect(result).toMatchObject({
      type: "service_explained",
      semanticClass: "information_authorized",
      origin: { capabilityId: "dental-explanation" },
      subject: { type: "service", id: "service-1", displayName: "Lentes de resina" },
      facts: [{
        key: "service_description",
        value: {
          kind: "display_text",
          value: "Camadas finas de resina aplicadas na frente dos dentes para mudar cor e formato.",
        },
        disclosure: "allowed",
      }],
    });
    expect(DENTAL_OUTCOME_SCHEMA[result.type].semanticClass).toBe("information_authorized");
  });

  it("não inventa explicação quando o tratamento não tem descrição cadastrada", async () => {
    const capability = createDentalExplanationCapability(catalog({
      kind: "exact",
      service: { id: "service-2", name: "Clareamento", priceCents: null, priceDisclosable: false, description: null },
      evidenceRef: "treatment:service-2",
    }));
    const claim = capability.claim(understanding(), state)!;

    const decision = await capability.decide(claim, context);

    expect(decision).toMatchObject({ kind: "ask" });
  });

  it("pede esclarecimento quando o pedido casa com mais de um tratamento", async () => {
    const capability = createDentalExplanationCapability(catalog({
      kind: "ambiguous",
      candidates: [{ id: "a", name: "Lentes de resina" }, { id: "b", name: "Clareamento" }],
      evidenceRef: "treatment-catalog:clinic-1",
    }));
    const claim = capability.claim(understanding(), state)!;

    expect(await capability.decide(claim, context)).toMatchObject({ kind: "ask" });
  });

  it("aceita explain-service no vocabulário fechado, exigindo o serviço", () => {
    const base = {
      version: UNDERSTANDING_VERSION,
      request: "explain-service",
      dialogueMove: "new_topic",
      signals: {},
      safety: {},
      confidence: 1,
      ambiguity: null,
    };

    expect(parseDentalUnderstanding({ ...base, entities: { service: "lente" } }).request)
      .toBe("explain-service");
    expect(() => parseDentalUnderstanding({ ...base, entities: { service: null } })).toThrow();
  });
});
