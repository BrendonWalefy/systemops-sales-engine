import { describe, expect, it } from "vitest";
import type { CapabilityContext, ConversationState } from "@/conversation-core/capability/contract";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { authorizedSurfaceFor } from "@/conversation-core/composer/authorized-surface";
import { buildDeterministicDraft } from "@/conversation-core/composer/deterministic-composer";
import { validateDraft } from "@/conversation-core/composer/validator";
import type { Understanding } from "@/conversation-core/understanding/schema";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import { createDentalCommercialCapability } from "@/domain-packs/dental/commercial-capability";
import type {
  DentalCommercialReadPort,
  DentalCommercialServiceResolution,
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

function understanding(entities: Record<string, unknown> = {}): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request: "price-of-service",
    dialogueMove: "new_topic",
    entities: { service: "Lentes", quantity: null, quantityScope: null, ...entities },
    signals: {},
    safety: {},
    confidence: 0.95,
    ambiguity: null,
  } as Understanding<DentalRequest>;
}

function port(resolution: DentalCommercialServiceResolution): DentalCommercialReadPort {
  return { resolveService: async () => resolution };
}

const campaign: DentalCommercialServiceResolution = {
  kind: "exact",
  service: {
    id: "treatment-1",
    name: "Lentes de resina",
    priceDisclosable: true,
    priceKind: "fixed",
    priceCents: 350_000,
    originalPriceCents: 400_000,
    campaignName: "Semana do sorriso",
    campaignEndsAt: new Date("2026-09-30T23:59:59.000Z"),
    quantityPrices: [],
  },
  evidenceRef: "price-campaign:campaign-1",
};

async function resultFor(
  resolution: DentalCommercialServiceResolution,
  entities: Record<string, unknown> = {},
) {
  const capability = createDentalCommercialCapability(port(resolution));
  const claim = capability.claim(understanding(entities), state)!;
  const decision = await capability.decide(claim, context);
  return capability.execute(decision, context);
}

describe("dental-commercial price authority", () => {
  it("authorizes the effective campaign price with original value and campaign provenance", async () => {
    const result = await resultFor(campaign);
    expect(result).toMatchObject({
      type: "commercial_answered",
      origin: { capabilityId: "dental-commercial" },
      subject: { id: "treatment-1", displayName: "Lentes de resina" },
      evidence: [{ source: "read", reference: "price-campaign:campaign-1" }],
      facts: [
        { key: "price_cents", value: { kind: "money", amountInMinor: 350_000 } },
        { key: "original_price_cents", value: { kind: "money", amountInMinor: 400_000 } },
        { key: "campaign_name", value: { kind: "display_text", value: "Semana do sorriso" } },
        { key: "campaign_end_date", value: { kind: "display_text", value: "30/09/2026" } },
      ],
    });
  });

  it("marks a registered minimum price as a partir de", async () => {
    const result = await resultFor({
      ...campaign,
      service: {
        ...campaign.service,
        priceKind: "from",
        priceCents: 250_000,
        originalPriceCents: null,
        campaignName: null,
        campaignEndsAt: null,
      },
      evidenceRef: "treatment:treatment-1",
    });
    expect(result.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "price_qualifier", value: { kind: "display_text", value: "a partir de" } }),
    ]));
  });

  it("quotes only the exact registered quantity and scope", async () => {
    const result = await resultFor({
      ...campaign,
      service: {
        ...campaign.service,
        priceCents: null,
        originalPriceCents: null,
        campaignName: null,
        campaignEndsAt: null,
        quantityPrices: [
          { quantity: 10, scope: "superior", priceCents: 150_000 },
          { quantity: 20, scope: "total", priceCents: 280_000 },
        ],
      },
      evidenceRef: "treatment:treatment-1",
    }, { quantity: 10, quantityScope: "superior" });
    expect(result).toMatchObject({
      type: "commercial_answered",
      facts: [
        { key: "package_quantity", value: { kind: "integer", value: 10 } },
        { key: "package_scope", value: { kind: "display_text", value: "arcada superior" } },
        { key: "price_cents", value: { kind: "money", amountInMinor: 150_000 } },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("280000");
  });

  it("offers only registered packages when quantity is absent or unsupported", async () => {
    const resolution: DentalCommercialServiceResolution = {
      ...campaign,
      service: {
        ...campaign.service,
        priceCents: null,
        originalPriceCents: null,
        campaignName: null,
        campaignEndsAt: null,
        quantityPrices: [
          { quantity: 10, scope: "total", priceCents: 150_000 },
          { quantity: 20, scope: "total", priceCents: 280_000 },
        ],
      },
    };
    for (const entities of [{}, { quantity: 12 }]) {
      const result = await resultFor(resolution, entities);
      expect(result).toMatchObject({
        type: "commercial_options_offered",
        options: [
          { facts: [{ key: "package_quantity", value: { kind: "integer", value: 10 } }, expect.anything()] },
          { facts: [{ key: "package_quantity", value: { kind: "integer", value: 20 } }, expect.anything()] },
        ],
      });
      expect(JSON.stringify(result)).not.toContain("12");
    }
  });

  it("fails closed for a non-quotable, missing or ambiguous service", async () => {
    const nonQuotable = await resultFor({
      ...campaign,
      service: { ...campaign.service, priceDisclosable: false },
    });
    expect(nonQuotable.type).toBe("clarification_required");

    for (const resolution of [
      { kind: "unknown", evidenceRef: "catalog:tenant" },
      { kind: "ambiguous", candidates: [{ id: "a", name: "Lente A" }, { id: "b", name: "Lente B" }], evidenceRef: "catalog:tenant" },
    ] as const) {
      expect((await resultFor(resolution)).type).not.toBe("commercial_answered");
    }
  });

  it("does not claim a free model objection as price authority", () => {
    const capability = createDentalCommercialCapability(port(campaign));
    expect(capability.claim(understanding({}), state)).not.toBeNull();
    expect(capability.claim({
      ...understanding({}),
      signals: { objection: "price" },
    }, state)).toBeNull();
  });

  it("exposes every current campaign value to the validator and no alleged historical value", async () => {
    const result = await resultFor(campaign);
    const plan = buildV2AuthorizedResponsePlan(DENTAL_OUTCOME_SCHEMA, [result]);
    const validation = validateDraft(plan, buildDeterministicDraft(plan));
    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
    const surface = authorizedSurfaceFor(validation.draft);
    expect(surface.values).toEqual(expect.arrayContaining([
      "R$ 3.500,00",
      "R$ 4.000,00",
      "Semana do sorriso",
      "30/09/2026",
    ]));
    expect(surface.values).not.toContain("R$ 2.999,00");
  });
});
