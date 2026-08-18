import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { buildDeterministicDraft } from "@/conversation-core/composer/deterministic-composer";
import { validateDraft, type ValidatedDraftResponse } from "@/conversation-core/composer/validator";

export function buildSafeFallback<OutcomeType extends string>(
  plan: V2AuthorizedResponsePlan<OutcomeType>,
): ValidatedDraftResponse<OutcomeType> | null {
  const complete = buildDeterministicDraft(plan);
  const seenOutcomes = new Set<string>();
  const acts = complete.acts.filter((act) => {
    if (seenOutcomes.has(act.outcomeRef)) return false;
    seenOutcomes.add(act.outcomeRef);
    return true;
  });
  if (acts.length === 0) return null;
  const result = validateDraft(plan, { acts });
  return result.valid ? result.draft : null;
}
