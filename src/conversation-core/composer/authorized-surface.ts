import { authorizedPlanFor, type ValidatedDraftResponse } from "@/conversation-core/composer/validator";
import type { AuthorizedFact } from "@/conversation-core/authorized-response-plan";
import type { FactValue } from "@/conversation-core/decision";
import { numbersIn, type AuthorizedSurface } from "@/conversation-core/composer/verbalization-validator";
import { formatFactValue } from "@/conversation-core/composer/fact-format";

const BASE_CHARACTERS = 160;
const CHARACTERS_PER_ACT = 220;
const MAX_CHARACTERS = 900;

function surfaceNumbers(value: FactValue): readonly string[] {
  if (value.kind === "boolean") return Object.freeze([]);
  return numbersIn(formatFactValue(value));
}

/**
 * Deriva do rascunho já validado o único material numérico que o texto final
 * pode conter. Fato interno não entra: ele existe para a decisão, não para o
 * leitor.
 */
export function authorizedSurfaceFor<OutcomeType extends string>(
  draft: ValidatedDraftResponse<OutcomeType>,
): AuthorizedSurface {
  const plan = authorizedPlanFor(draft);
  const facts = new Map(plan.facts.map((fact) => [fact.ref, fact]));
  const options = new Map(plan.options.map((option) => [option.ref, option]));
  const reachable: AuthorizedFact[] = [];

  const include = (factRef: string): void => {
    const fact = facts.get(factRef);
    if (fact && fact.disclosure === "allowed") reachable.push(fact);
  };

  for (const act of draft.acts) {
    if (act.kind === "inform_fact") include(act.factRef);
    if (act.kind === "confirm_effect") act.factRefs.forEach(include);
    if (act.kind === "offer_options") {
      for (const optionRef of act.optionRefs) {
        options.get(optionRef)?.factRefs.forEach(include);
      }
    }
  }

  const numbers = new Set<string>();
  let currencyAllowed = false;
  for (const fact of reachable) {
    if (fact.value.kind === "money") currencyAllowed = true;
    for (const number of surfaceNumbers(fact.value)) numbers.add(number);
  }

  return Object.freeze({
    numbers: Object.freeze([...numbers]),
    currencyAllowed,
    maxQuestions: 1,
    maxCharacters: Math.min(
      MAX_CHARACTERS,
      BASE_CHARACTERS + CHARACTERS_PER_ACT * draft.acts.length,
    ),
  });
}
