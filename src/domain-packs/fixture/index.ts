import type {
  Capability,
  CapabilityClaim,
} from "@/conversation-core/capability/contract";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import type { ActionResult, Decision } from "@/conversation-core/decision";
import {
  UNDERSTANDING_VERSION,
  type Understanding,
} from "@/conversation-core/understanding/schema";
import type { DomainPack } from "@/domain-packs/contract";

type FixtureRequest = "quote_glow_kite" | "reserve_wind_window";
type FixturePolicy = { quoteUnitAmount: number };
type FixtureClaimPayload =
  | { kind: "quote"; request: "quote_glow_kite" }
  | { kind: "reservation"; request: "reserve_wind_window" };
export const FIXTURE_OUTCOME_SCHEMA = defineOutcomeSchema({
  quote_prepared: {
    semanticClass: "information_authorized",
    subjectRequirement: "required",
    evidenceRequirement: "required",
  },
  wind_window_reserved: {
    semanticClass: "effect_completed",
    subjectRequirement: "required",
    evidenceRequirement: "required",
  },
} as const);

function claimFor(
  capabilityId: string,
  expectedRequest: FixtureRequest,
  understanding: Understanding<FixtureRequest>,
): CapabilityClaim<FixtureClaimPayload> | null {
  return understanding.request === expectedRequest
    ? {
        capabilityId,
        confidence: understanding.confidence,
        reason: "structured_request_match",
        payload:
          expectedRequest === "quote_glow_kite"
            ? { kind: "quote", request: expectedRequest }
            : { kind: "reservation", request: expectedRequest },
      }
    : null;
}

const quoteCapability: Capability<
  FixtureRequest,
  FixturePolicy,
  FixtureClaimPayload,
  typeof FIXTURE_OUTCOME_SCHEMA
> = {
  id: "glow-kite-quote",
  claim: (understanding) =>
    claimFor("glow-kite-quote", "quote_glow_kite", understanding),
  async decide(_claim, context): Promise<Decision> {
    return {
      kind: "answer",
      facts: [
        {
          key: "unit_amount",
          value: { kind: "integer", value: context.policy.quoteUnitAmount },
          subject: { type: "fixture_item", id: "glow-kite", displayName: "Glow kite" },
          evidence: { source: "policy", reference: "quote_unit_amount" },
          disclosure: "allowed",
        },
      ],
      nextBestStep: null,
    };
  },
  async execute(decision): Promise<ActionResult<typeof FIXTURE_OUTCOME_SCHEMA>> {
    const facts = decision.kind === "answer" ? decision.facts : [];
    const firstFact = facts[0];
    if (!firstFact?.subject) throw new Error("quote_prepared requires a subject");
    return {
      type: "quote_prepared",
      semanticClass: "information_authorized",
      origin: { capabilityId: "glow-kite-quote" },
      subject: firstFact.subject,
      evidence: [firstFact.evidence],
      facts,
    };
  },
};

const reservationCapability: Capability<
  FixtureRequest,
  FixturePolicy,
  FixtureClaimPayload,
  typeof FIXTURE_OUTCOME_SCHEMA
> = {
  id: "wind-window-reservation",
  claim: (understanding) =>
    claimFor("wind-window-reservation", "reserve_wind_window", understanding),
  async decide(): Promise<Decision> {
    return {
      kind: "execute",
      action: { type: "reserve_wind_window", parameters: {} },
      nextBestStep: null,
    };
  },
  async execute(): Promise<ActionResult<typeof FIXTURE_OUTCOME_SCHEMA>> {
    return {
      type: "wind_window_reserved",
      semanticClass: "effect_completed",
      origin: { capabilityId: "wind-window-reservation" },
      subject: { type: "fixture_window", id: "wind-window", displayName: "Wind window" },
      evidence: [{ source: "derived", reference: "fixture-reservation" }],
      facts: [],
    };
  },
};

export const fixturePack: DomainPack<
  FixtureRequest,
  FixturePolicy,
  FixtureClaimPayload,
  typeof FIXTURE_OUTCOME_SCHEMA
> = {
  id: "glow-kite-library",
  outcomeSchema: FIXTURE_OUTCOME_SCHEMA,
  capabilities: [quoteCapability, reservationCapability],
  journeys: [
    { id: "quote", capabilityIds: ["glow-kite-quote"] },
    { id: "reservation", capabilityIds: ["wind-window-reservation"] },
  ],
};

export function fixtureUnderstanding(
  request: FixtureRequest,
): Understanding<FixtureRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request,
    dialogueMove: "new_topic",
    entities: {},
    signals: {},
    safety: {},
    confidence: 1,
    ambiguity: null,
  };
}
