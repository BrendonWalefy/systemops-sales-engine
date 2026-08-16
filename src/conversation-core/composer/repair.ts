import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { DraftResponse, DraftSpeechAct } from "@/conversation-core/composer/contract";
import { validateDraft } from "@/conversation-core/composer/validator";

export function repairDraft<OutcomeType extends string>(
  plan: V2AuthorizedResponsePlan<OutcomeType>,
  draft: DraftResponse,
): DraftResponse {
  const seen = new Set<string>();
  const acts: DraftSpeechAct[] = [];

  for (const candidate of draft.acts) {
    const validation = validateDraft(plan, { acts: [candidate] });
    if (!validation.valid) continue;
    const act = validation.draft.acts[0]!;
    const identity = JSON.stringify(act);
    if (seen.has(identity)) continue;
    seen.add(identity);
    acts.push(act);
  }

  return Object.freeze({ acts: Object.freeze(acts) });
}
