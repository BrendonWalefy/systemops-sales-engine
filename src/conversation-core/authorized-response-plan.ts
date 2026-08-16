import type { ActionResult, Fact } from "@/conversation-core/decision";

export const V2_AUTHORIZED_RESPONSE_PLAN_VERSION = "authorized-response-plan.v2" as const;

export type V2AuthorizedResponsePlan = {
  version: typeof V2_AUTHORIZED_RESPONSE_PLAN_VERSION;
  actionTypes: readonly string[];
  authorizedFacts: readonly Fact[];
};

export function buildV2AuthorizedResponsePlan(
  actionResults: readonly ActionResult[],
): V2AuthorizedResponsePlan {
  const authorizedFacts = actionResults.flatMap(({ facts }) =>
    facts.filter(({ disclosure }) => disclosure === "allowed"),
  );
  const unscoped = authorizedFacts.find(({ subject }) => subject === null);
  if (unscoped) {
    throw new Error(`disclosable fact ${unscoped.key} requires a subject`);
  }
  return {
    version: V2_AUTHORIZED_RESPONSE_PLAN_VERSION,
    actionTypes: [...new Set(actionResults.map(({ type }) => type))],
    authorizedFacts,
  };
}
