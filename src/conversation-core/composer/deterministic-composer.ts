import type {
  DraftResponse,
  DraftSpeechAct,
  ResponseComposerPort,
} from "@/conversation-core/composer/contract";
import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";

export function buildDeterministicDraft<OutcomeType extends string>(
  plan: V2AuthorizedResponsePlan<OutcomeType>,
): DraftResponse {
  const facts = new Map(plan.facts.map((fact) => [fact.ref, fact]));
  const acts: DraftSpeechAct[] = [];

  for (const outcome of plan.outcomes) {
    if (outcome.semanticClass === "information_authorized") {
      for (const factRef of outcome.factRefs) {
        const fact = facts.get(factRef);
        if (fact?.disclosure === "allowed" && fact.subjectRef) {
          acts.push({
            kind: "inform_fact",
            outcomeRef: outcome.ref,
            factRef,
            subjectRef: fact.subjectRef,
          });
        }
      }
      continue;
    }

    if (outcome.semanticClass === "options_found") {
      if (outcome.optionRefs.length > 0) {
        acts.push({
          kind: "offer_options",
          outcomeRef: outcome.ref,
          subjectRef: outcome.subjectRef,
          optionRefs: outcome.optionRefs,
        });
      }
      continue;
    }

    if (outcome.semanticClass === "effect_completed") {
      if (outcome.subjectRef) {
        acts.push({
          kind: "confirm_effect",
          outcomeRef: outcome.ref,
          subjectRef: outcome.subjectRef,
          factRefs: outcome.factRefs.filter(
            (ref) => facts.get(ref)?.disclosure === "allowed",
          ),
        });
      }
      continue;
    }

    if (outcome.semanticClass === "effect_failed") {
      acts.push({ kind: "communicate_failure", outcomeRef: outcome.ref, subjectRef: outcome.subjectRef });
      continue;
    }

    if (outcome.semanticClass === "human_action_required") {
      acts.push({ kind: "inform_required_action", outcomeRef: outcome.ref, subjectRef: outcome.subjectRef });
      continue;
    }

    acts.push({ kind: "ask_clarification", outcomeRef: outcome.ref, subjectRef: outcome.subjectRef });
  }

  return { acts };
}

export class DeterministicResponseComposer {
  async compose<OutcomeType extends string>(
    input: Parameters<ResponseComposerPort<OutcomeType>["compose"]>[0],
  ): Promise<DraftResponse> {
    return buildDeterministicDraft(input.plan);
  }
}
