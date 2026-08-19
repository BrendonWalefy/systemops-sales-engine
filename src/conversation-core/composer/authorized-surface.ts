import { authorizedPlanFor, type ValidatedDraftResponse } from "@/conversation-core/composer/validator";
import type { AuthorizedFact } from "@/conversation-core/authorized-response-plan";
import type { FactValue } from "@/conversation-core/decision";
import { numbersIn, type AuthorizedSurface } from "@/conversation-core/composer/verbalization-validator";
import type { AuthorizedStatement } from "@/conversation-core/composer/verbalization";
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
  const moneyNumbers = new Set<string>();
  let currencyAllowed = false;
  for (const fact of reachable) {
    if (fact.value.kind === "money") currencyAllowed = true;
    for (const number of surfaceNumbers(fact.value)) {
      numbers.add(number);
      if (fact.value.kind === "money") moneyNumbers.add(number);
    }
  }

  return Object.freeze({
    numbers: Object.freeze([...numbers]),
    moneyNumbers: Object.freeze([...moneyNumbers]),
    currencyAllowed,
    maxQuestions: 1,
    maxCharacters: Math.min(
      MAX_CHARACTERS,
      BASE_CHARACTERS + CHARACTERS_PER_ACT * draft.acts.length,
    ),
  });
}

/**
 * Traduz o rascunho validado em intencoes com os valores que cada uma pode
 * dizer. Nada aqui e frase pronta: e o que precisa ser dito.
 */
export function authorizedStatementsFor<OutcomeType extends string>(
  draft: ValidatedDraftResponse<OutcomeType>,
): readonly AuthorizedStatement[] {
  const plan = authorizedPlanFor(draft);
  const facts = new Map(plan.facts.map((fact) => [fact.ref, fact]));
  const options = new Map(plan.options.map((option) => [option.ref, option]));
  const subjects = new Map(plan.subjects.map((subject) => [subject.ref, subject]));
  const display = (factRef: string): string | null => {
    const fact = facts.get(factRef);
    return fact && fact.disclosure === "allowed" ? formatFactValue(fact.value) : null;
  };
  const named = (subjectRef: string | null): string | null =>
    subjectRef === null ? null : subjects.get(subjectRef)?.displayName ?? null;

  return Object.freeze(draft.acts.map((act): AuthorizedStatement => {
    if (act.kind === "inform_fact") {
      return Object.freeze({
        meaning: act.kind,
        subject: named(act.subjectRef),
        values: Object.freeze([display(act.factRef)].filter((value): value is string => value !== null)),
      });
    }
    if (act.kind === "confirm_effect") {
      return Object.freeze({
        meaning: act.kind,
        subject: named(act.subjectRef),
        values: Object.freeze(act.factRefs
          .map(display)
          .filter((value): value is string => value !== null)),
      });
    }
    if (act.kind === "offer_options") {
      return Object.freeze({
        meaning: act.kind,
        subject: named(act.subjectRef),
        values: Object.freeze(act.optionRefs.map((optionRef) => (options.get(optionRef)?.factRefs ?? [])
          .map(display)
          .filter((value): value is string => value !== null)
          .join(" - "))),
      });
    }
    return Object.freeze({
      meaning: act.kind,
      subject: named(act.subjectRef),
      values: Object.freeze([]),
    });
  }));
}
