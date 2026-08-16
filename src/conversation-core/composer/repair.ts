import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { DraftResponse, DraftSpeechAct } from "@/conversation-core/composer/contract";
import { validateDraft } from "@/conversation-core/composer/validator";

export function repairDraft(
  plan: V2AuthorizedResponsePlan,
  draft: DraftResponse,
): DraftResponse {
  const seen = new Set<string>();
  const acts: DraftSpeechAct[] = [];

  for (const act of draft.acts) {
    const identity = JSON.stringify(act);
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (validateDraft(plan, { acts: [act] }).valid) acts.push(act);
  }

  return { acts };
}
