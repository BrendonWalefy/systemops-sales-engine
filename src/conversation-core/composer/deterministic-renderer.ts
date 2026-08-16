import type { CoreResponse, ComposerStyle } from "@/conversation-core/composer/contract";
import {
  assertValidatedResponseLanguageContribution,
  type ValidatedResponseLanguageContribution,
  type ValueFormat,
} from "@/conversation-core/composer/language";
import {
  authorizedPlanFor,
  type ValidatedDraftResponse,
} from "@/conversation-core/composer/validator";

function formatValue(
  value: string | number | boolean,
  format: ValueFormat,
): string {
  if (format === "currency_minor_brl") {
    if (typeof value !== "number") throw new Error("currency fact must be numeric");
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value / 100).replace(/\u00a0/g, " ");
  }
  if (format === "integer") {
    if (typeof value !== "number") throw new Error("integer fact must be numeric");
    return String(Math.trunc(value));
  }
  if (format === "boolean") {
    if (typeof value !== "boolean") throw new Error("boolean fact must be boolean");
    return value ? "sim" : "não";
  }
  return String(value);
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

export function renderDeterministicResponse(input: {
  draft: ValidatedDraftResponse;
  language: ValidatedResponseLanguageContribution;
  style: ComposerStyle;
}): CoreResponse {
  assertValidatedResponseLanguageContribution(input.language);
  const plan = authorizedPlanFor(input.draft);
  const outcomes = new Map(plan.outcomes.map((item) => [item.ref, item]));
  const options = new Map(plan.options.map((item) => [item.ref, item]));
  const facts = new Map(plan.facts.map((item) => [item.ref, item]));
  const factTerms = new Map(input.language.factTerms.map((item) => [item.factKey, item]));
  const outcomeTerms = new Map(input.language.outcomeTerms.map((item) => [item.outcomeType, item]));

  const factText = (factRef: string, includeLabel: boolean): string => {
    const fact = facts.get(factRef);
    if (!fact || fact.disclosure !== "allowed") throw new Error(`fact ${factRef} is not renderable`);
    const term = factTerms.get(fact.key);
    if (!term) throw new Error(`missing language term for fact ${fact.key}`);
    const value = formatValue(fact.value, term.format);
    return includeLabel ? `${term.label}: ${value}` : value;
  };

  const outcomeTerm = (outcomeRef: string) => {
    const outcome = outcomes.get(outcomeRef);
    if (!outcome) throw new Error(`missing outcome ${outcomeRef}`);
    const term = outcomeTerms.get(outcome.outcomeType);
    if (!term) throw new Error(`missing language term for outcome ${outcome.outcomeType}`);
    return term;
  };

  const sentences = input.draft.acts.map((act): string => {
    if (act.kind === "inform_fact") return `${factText(act.factRef, true)}.`;
    if (act.kind === "offer_options") {
      const surfaces = act.optionRefs.map((optionRef) => {
        const option = options.get(optionRef);
        if (!option) throw new Error(`missing option ${optionRef}`);
        return option.factRefs.map((ref) => factText(ref, false)).join(" — ");
      });
      return `Tenho estas opções: ${surfaces.join(", ")}.`;
    }
    const term = outcomeTerm(act.outcomeRef);
    if (act.kind === "confirm_effect") {
      const completion = term.gender === "feminine" ? "concluída" : "concluído";
      const details = act.factRefs.map((ref) => `${factText(ref, true)}.`).join(" ");
      return `${capitalize(term.label)} ${completion}.${details ? ` ${details}` : ""}`;
    }
    if (act.kind === "communicate_failure") {
      return `Não foi possível concluir ${term.label}.`;
    }
    if (act.kind === "inform_required_action") {
      return `É necessário ${term.label}.`;
    }
    return `Pode confirmar ${term.label}?`;
  });

  if (input.style.greeting === "include") {
    sentences.unshift(input.style.emoji === "light" ? "Olá! 🙂" : "Olá!");
  }

  return { text: sentences.join(" "), parts: [] };
}
