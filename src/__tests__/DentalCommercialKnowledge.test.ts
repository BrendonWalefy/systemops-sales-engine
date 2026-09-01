import { describe, expect, it } from "vitest";
import type { CapabilityContext, ConversationState } from "@/conversation-core/capability/contract";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { authorizedSurfaceFor } from "@/conversation-core/composer/authorized-surface";
import { buildDeterministicDraft } from "@/conversation-core/composer/deterministic-composer";
import { validateDraft } from "@/conversation-core/composer/validator";
import type { Understanding } from "@/conversation-core/understanding/schema";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import {
  createDentalEscalationCapability,
  DENTAL_OUTCOME_SCHEMA,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import { createDentalCommercialCapability } from "@/domain-packs/dental/commercial-capability";
import type {
  DentalCommercialReadPort,
  DentalCommercialServiceResolution,
  DentalPaymentConfigurationResolution,
  DentalRegisteredObjectionResolution,
} from "@/domain-packs/dental/ports";
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
  now: new Date("2026-09-01T12:00:00.000Z"),
};

const service: DentalCommercialServiceResolution = {
  kind: "exact",
  service: {
    id: "service-1",
    name: "Clareamento",
    priceDisclosable: true,
    priceKind: "fixed",
    priceCents: 100_000,
    originalPriceCents: null,
    campaignName: null,
    campaignEndsAt: null,
    quantityPrices: [],
  },
  evidenceRef: "treatment:service-1",
};

const payment: DentalPaymentConfigurationResolution = {
  kind: "resolved",
  organization: { id: "clinic-1", displayName: "Clínica Exemplo" },
  methods: [
    { code: "pix", label: "Pix", evidenceRef: "organization:clinic-1:payment-method:pix" },
    { code: "credit_card", label: "Cartão de crédito", evidenceRef: "organization:clinic-1:payment-method:credit_card" },
  ],
  installmentRates: [
    { installments: 4, ratePercent: 0, evidenceRef: "organization:clinic-1:installment-rate:4" },
    { installments: 10, ratePercent: 10, evidenceRef: "organization:clinic-1:installment-rate:10" },
  ],
};

const objection: DentalRegisteredObjectionResolution = {
  kind: "resolved",
  organization: { id: "clinic-1", displayName: "Clínica Exemplo" },
  answer: "Podemos apresentar as condições cadastradas e encontrar a melhor opção.",
  evidenceRef: "playbook:active-1:objection:0",
};

function port(overrides: Partial<DentalCommercialReadPort> = {}): DentalCommercialReadPort {
  return {
    resolveService: async () => service,
    resolvePaymentConfiguration: async () => payment,
    resolveRegisteredObjection: async () => objection,
    ...overrides,
  };
}

function understanding(
  request: DentalRequest,
  entities: Record<string, unknown> = {},
  signals: Record<string, unknown> = {},
): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request,
    dialogueMove: "new_topic",
    entities,
    signals,
    safety: {},
    confidence: 0.95,
    ambiguity: null,
  } as Understanding<DentalRequest>;
}

async function execute(
  request: DentalRequest,
  entities: Record<string, unknown>,
  readPort: DentalCommercialReadPort = port(),
  signals: Record<string, unknown> = {},
) {
  const capability = createDentalCommercialCapability(readPort);
  const claim = capability.claim(understanding(request, entities, signals), state)!;
  return capability.execute(await capability.decide(claim, context), context);
}

describe("dental-commercial payment and objection authority", () => {
  it("discloses only configured payment methods and available installment counts", async () => {
    const result = await execute("payment-options", {});
    expect(result).toMatchObject({
      type: "commercial_answered",
      subject: { type: "organization", id: "clinic-1" },
      facts: [
        { key: "payment_method", value: { kind: "display_text", value: "Pix" } },
        { key: "payment_method", value: { kind: "display_text", value: "Cartão de crédito" } },
        { key: "installment_count", value: { kind: "integer", value: 4 } },
        { key: "installment_count", value: { kind: "integer", value: 10 } },
      ],
    });
  });

  it("calculates exact installments from the effective service price and registered rate", async () => {
    const result = await execute("payment-options", { service: "Clareamento" });
    expect(result).toMatchObject({
      type: "commercial_answered",
      subject: { type: "service", id: "service-1" },
      facts: [
        { key: "installment_count", value: { kind: "integer", value: 4 } },
        { key: "installment_amount", value: { kind: "money", amountInMinor: 25_000 } },
        { key: "installment_count", value: { kind: "integer", value: 10 } },
        { key: "installment_amount", value: { kind: "money", amountInMinor: 11_112 } },
      ],
    });
  });

  it("fails closed for absent or malformed payment configuration", async () => {
    for (const resolution of [
      { kind: "missing" },
      { ...payment, installmentRates: [{ installments: 10, ratePercent: 100, evidenceRef: "bad" }] },
      { ...payment, installmentRates: Array.from({ length: 9 }, (_, index) => ({ installments: index + 1, ratePercent: 0, evidenceRef: `rate:${index}` })) },
    ] as DentalPaymentConfigurationResolution[]) {
      const result = await execute("payment-options", {}, port({
        resolvePaymentConfiguration: async () => resolution,
      }));
      expect(result.type).toBe("clarification_required");
    }
  });

  it("answers only the exact registered objection with playbook evidence", async () => {
    const result = await execute(
      "registered-objection",
      { objectionQuestion: "Está caro para mim" },
      port(),
      { objection: "price" },
    );
    expect(result).toMatchObject({
      type: "commercial_answered",
      origin: { capabilityId: "dental-commercial" },
      facts: [{
        key: "registered_objection_answer",
        value: { kind: "display_text", value: objection.answer },
        evidence: { reference: "playbook:active-1:objection:0" },
      }],
    });
  });

  it("escalates an unresolved registered objection and never answers a free signal", async () => {
    const unresolved = await execute(
      "registered-objection",
      { objectionQuestion: "Está caro para mim" },
      port({ resolveRegisteredObjection: async () => ({ kind: "missing" }) }),
      { objection: "price" },
    );
    expect(unresolved.type).toBe("escalation_required");

    const capability = createDentalCommercialCapability(port());
    expect(capability.claim(understanding("other", {}, { objection: "price" }), state)).toBeNull();
    const escalation = createDentalEscalationCapability();
    expect(escalation.claim(
      understanding("registered-objection", { objectionQuestion: "Está caro para mim" }, { objection: "price" }),
      state,
    )).toBeNull();
    expect(escalation.claim(understanding("other", {}, { objection: "price" }), state))
      .toMatchObject({ payload: { kind: "escalation", reason: "objection" } });
  });

  it("authorizes every installment number and amount on the response surface", async () => {
    const result = await execute("payment-options", { service: "Clareamento" });
    const plan = buildV2AuthorizedResponsePlan(DENTAL_OUTCOME_SCHEMA, [result]);
    const validation = validateDraft(plan, buildDeterministicDraft(plan));
    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
    expect(authorizedSurfaceFor(validation.draft).values).toEqual([
      "4",
      "R$ 250,00",
      "10",
      "R$ 111,12",
    ]);
  });
});
