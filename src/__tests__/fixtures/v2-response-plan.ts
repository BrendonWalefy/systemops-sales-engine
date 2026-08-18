import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import type { ActionResult } from "@/conversation-core/decision";

export const RESPONSE_PLAN_FIXTURE_SCHEMA = defineOutcomeSchema({
  quote_ready: {
    semanticClass: "information_authorized",
    subjectRequirement: "required",
    evidenceRequirement: "required",
  },
  operation_failed: {
    semanticClass: "effect_failed",
    subjectRequirement: "forbidden",
    evidenceRequirement: "required",
  },
} as const);

const subject = { type: "item", id: "a", displayName: "Item A" } as const;
const evidence = { source: "read", reference: "snapshot" } as const;
const results: ActionResult<typeof RESPONSE_PLAN_FIXTURE_SCHEMA>[] = [
  {
    type: "quote_ready",
    semanticClass: "information_authorized",
    origin: { capabilityId: "quote" },
    subject,
    evidence: [evidence],
    facts: [
      { key: "amount", value: { kind: "integer", value: 1200 }, subject, evidence, disclosure: "allowed" },
      { key: "score", value: { kind: "integer", value: 1 }, subject: null, evidence, disclosure: "internal" },
    ],
  },
  {
    type: "operation_failed",
    semanticClass: "effect_failed",
    origin: { capabilityId: "operation" },
    subject: null,
    evidence: [evidence],
    facts: [],
  },
];

export const responsePlanFixture = buildV2AuthorizedResponsePlan(
  RESPONSE_PLAN_FIXTURE_SCHEMA,
  results,
);

export const emptyResponsePlanFixture = buildV2AuthorizedResponsePlan(
  RESPONSE_PLAN_FIXTURE_SCHEMA,
  [],
);

export const responsePlanFixtureRefs = Object.freeze({
  information: "outcome-0",
  failed: "outcome-1",
  fact: "fact-0",
  subject: "subject-0",
});
