import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { authorizedSurfaceFor } from "@/conversation-core/composer/authorized-surface";
import { buildDeterministicDraft } from "@/conversation-core/composer/deterministic-composer";
import { renderDeterministicResponse } from "@/conversation-core/composer/deterministic-renderer";
import { validateDraft } from "@/conversation-core/composer/validator";
import type { CapabilityContext, ConversationState } from "@/conversation-core/capability/contract";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import {
  createDentalCatalogCapability,
  createDentalReceptionCapability,
  DENTAL_OUTCOME_SCHEMA,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import { createDentalExplanationCapability } from "@/domain-packs/dental/explanation-capability";
import type { DentalCatalogReadPort, ServiceResolution } from "@/domain-packs/dental/ports";
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

const ambiguous: ServiceResolution = {
  kind: "ambiguous",
  candidates: [
    { id: "t1", name: "Lentes de resina" },
    { id: "t2", name: "Clareamento dental" },
  ],
  evidenceRef: "treatment-catalog:clinic-1",
};

function catalogPort(resolution: ServiceResolution): DentalCatalogReadPort {
  return { resolveService: async () => resolution };
}

function understanding(overrides: Partial<Understanding<DentalRequest>> = {}): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request: "price-of-service",
    dialogueMove: "new_topic",
    entities: { service: "lente" },
    signals: {},
    safety: {},
    confidence: 0.9,
    ambiguity: null,
    ...overrides,
  } as Understanding<DentalRequest>;
}

describe("serviço ambíguo vira escolha, não convite genérico", () => {
  it("oferece os candidatos reais quando o catálogo não consegue decidir", async () => {
    const capability = createDentalCatalogCapability(catalogPort(ambiguous));
    const claim = capability.claim(understanding(), state)!;

    const result = await capability.execute(await capability.decide(claim, context), context);

    expect(result).toMatchObject({
      type: "service_options_offered",
      semanticClass: "options_found",
      subject: null,
      options: [
        { id: "t1", subject: { type: "service", id: "t1", displayName: "Lentes de resina" } },
        { id: "t2", subject: { type: "service", id: "t2", displayName: "Clareamento dental" } },
      ],
    });
  });

  it("faz o mesmo quando o lead pergunta o que é e o pedido casa com dois", async () => {
    const capability = createDentalExplanationCapability(catalogPort(ambiguous));
    const claim = capability.claim(understanding({ request: "explain-service" }), state)!;

    const result = await capability.execute(await capability.decide(claim, context), context);

    expect(result.type).toBe("service_options_offered");
  });

  it("entrega ao verbalizador os dois nomes e o direito a uma pergunta", async () => {
    const capability = createDentalCatalogCapability(catalogPort(ambiguous));
    const claim = capability.claim(understanding(), state)!;
    const result = await capability.execute(await capability.decide(claim, context), context);

    const plan = buildV2AuthorizedResponsePlan(DENTAL_OUTCOME_SCHEMA, [result]);
    const validation = validateDraft(plan, buildDeterministicDraft(plan));
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
    const surface = authorizedSurfaceFor(validation.draft);

    expect(surface.values).toEqual(["Lentes de resina", "Clareamento dental"]);
    expect(surface.maxQuestions).toBe(1);
    expect(renderDeterministicResponse({ draft: validation.draft }).text)
      .toContain("Lentes de resina");
  });

  it("não oferece opção nenhuma quando o catálogo não conhece o pedido", async () => {
    const capability = createDentalCatalogCapability(catalogPort({
      kind: "unknown",
      evidenceRef: "treatment-catalog:clinic-1",
    }));
    const claim = capability.claim(understanding(), state)!;

    expect(await capability.decide(claim, context)).toMatchObject({ kind: "ask" });
  });
});

describe("lead repetindo é sinal de falha, não de abertura", () => {
  it("escala em vez de repetir o convite quando o lead repete o turno", async () => {
    const capability = createDentalReceptionCapability();
    const claim = capability.claim(
      understanding({ request: "other", entities: {}, dialogueMove: "repeats" }),
      state,
    )!;

    const result = await capability.execute(await capability.decide(claim, context), context);

    expect(result).toMatchObject({
      type: "escalation_required",
      semanticClass: "human_action_required",
    });
  });

  it("mantém o convite acolhedor quando o turno é uma abertura de verdade", async () => {
    const capability = createDentalReceptionCapability();
    const claim = capability.claim(
      understanding({ request: "greeting", entities: {}, dialogueMove: "new_topic" }),
      state,
    )!;

    const result = await capability.execute(await capability.decide(claim, context), context);

    expect(result.type).toBe("reception_answered");
  });
});
