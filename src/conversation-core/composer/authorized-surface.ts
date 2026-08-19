import { authorizedPlanFor, type ValidatedDraftResponse } from "@/conversation-core/composer/validator";
import type { AuthorizedFact } from "@/conversation-core/authorized-response-plan";
import type { AuthorizedSurface } from "@/conversation-core/composer/verbalization-validator";
import type { AuthorizedStatement } from "@/conversation-core/composer/verbalization";
import { formatFactValue } from "@/conversation-core/composer/fact-format";

const BASE_CHARACTERS = 160;
const CHARACTERS_PER_ACT = 220;
const MAX_CHARACTERS = 900;

const DIGIT_RUN = /\p{Nd}[\p{Nd}.,:/h -]*\p{Nd}|\p{Nd}/gu;

function digitRunsIn(text: string): readonly string[] {
  return Object.freeze([...(text.match(DIGIT_RUN) ?? [])]
    .map((run) => run.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")));
}

/**
 * Deriva do rascunho já validado o único material que o texto final pode dizer:
 * cada valor divulgável na forma exata em que o leitor deve lê-lo. Fato interno
 * não entra — ele existe para a decisão, não para o leitor.
 *
 * Pergunta é autorizada apenas quando algum ato pede: informar um fato não dá
 * ao modelo a liberdade de propor um próximo passo que ninguém decidiu.
 */
export function authorizedSurfaceFor<OutcomeType extends string>(
  draft: ValidatedDraftResponse<OutcomeType>,
): AuthorizedSurface {
  const plan = authorizedPlanFor(draft);
  const facts = new Map(plan.facts.map((fact) => [fact.ref, fact]));
  const options = new Map(plan.options.map((option) => [option.ref, option]));
  const subjects = new Map(plan.subjects.map((subject) => [subject.ref, subject]));
  const reachable: AuthorizedFact[] = [];
  const namedSubjects = new Set<string>();

  const include = (factRef: string): void => {
    const fact = facts.get(factRef);
    if (fact && fact.disclosure === "allowed") reachable.push(fact);
  };
  const nameSubject = (subjectRef: string | null): void => {
    const subject = subjectRef === null ? undefined : subjects.get(subjectRef);
    if (subject) namedSubjects.add(subject.displayName);
  };

  for (const act of draft.acts) {
    nameSubject(act.subjectRef);
    if (act.kind === "inform_fact") include(act.factRef);
    if (act.kind === "confirm_effect") act.factRefs.forEach(include);
    if (act.kind === "offer_options") {
      for (const optionRef of act.optionRefs) {
        const option = options.get(optionRef);
        if (!option) continue;
        nameSubject(option.subjectRef);
        option.factRefs.forEach(include);
      }
    }
  }

  const values: string[] = [];
  const moneyValues: string[] = [];
  for (const fact of reachable) {
    const display = formatFactValue(fact.value);
    if (!values.includes(display)) values.push(display);
    if (fact.value.kind === "money" && !moneyValues.includes(display)) moneyValues.push(display);
  }

  const numbers = new Set<string>();
  for (const name of namedSubjects) {
    for (const run of digitRunsIn(name)) numbers.add(run);
  }

  return Object.freeze({
    values: Object.freeze(values),
    moneyValues: Object.freeze(moneyValues),
    numbers: Object.freeze([...numbers]),
    currencyAllowed: moneyValues.length > 0,
    maxQuestions: draft.acts.some(
      (act) => act.kind === "ask_clarification" || act.kind === "invite_engagement",
    ) ? 1 : 0,
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
