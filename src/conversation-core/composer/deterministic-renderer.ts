import type { CoreResponse } from "@/conversation-core/composer/contract";
import type { FactValue } from "@/conversation-core/decision";
import {
  authorizedPlanFor,
  type ValidatedDraftResponse,
} from "@/conversation-core/composer/validator";

function formatValue(value: FactValue): string {
  if (value.kind === "money") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: value.currency,
    }).format(value.amountInMinor / 100).replace(/\u00a0/g, " ");
  }
  if (value.kind === "boolean") return value.value ? "sim" : "não";
  return String(value.value);
}

export function renderDeterministicResponse(input: {
  draft: ValidatedDraftResponse;
}): CoreResponse {
  const plan = authorizedPlanFor(input.draft);
  const options = new Map(plan.options.map((item) => [item.ref, item]));
  const facts = new Map(plan.facts.map((item) => [item.ref, item]));
  const subjects = new Map(plan.subjects.map((item) => [item.ref, item]));

  const actSubjectRef = (act: ValidatedDraftResponse["acts"][number]): string | null =>
    act.subjectRef;
  const relevantSubjectRefs = new Set(
    input.draft.acts.map(actSubjectRef).filter((ref): ref is string => ref !== null),
  );
  const qualify = (subjectRef: string | null, sentence: string): string => {
    if (subjectRef === null || relevantSubjectRefs.size <= 1) return sentence;
    const subject = subjects.get(subjectRef);
    if (!subject) throw new Error(`missing subject ${subjectRef}`);
    const continuation = sentence.charAt(0).toLocaleLowerCase("pt-BR") + sentence.slice(1);
    return `Para ${subject.displayName}, ${continuation}`;
  };

  const factText = (factRef: string, includeLabel: boolean): string => {
    const fact = facts.get(factRef);
    if (!fact || fact.disclosure !== "allowed") throw new Error(`fact ${factRef} is not renderable`);
    const value = formatValue(fact.value);
    const label = fact.value.kind === "money" ? "Valor" : "Informação";
    return includeLabel ? `${label}: ${value}` : value;
  };

  const sentences = input.draft.acts.map((act): string => {
    if (act.kind === "inform_fact") {
      return qualify(act.subjectRef, `${factText(act.factRef, true)}.`);
    }
    if (act.kind === "offer_options") {
      const surfaces = act.optionRefs.map((optionRef) => {
        const option = options.get(optionRef);
        if (!option) throw new Error(`missing option ${optionRef}`);
        return option.factRefs.map((ref) => factText(ref, false)).join(" — ");
      });
      return qualify(act.subjectRef, `Tenho estas opções: ${surfaces.join(", ")}.`);
    }
    if (act.kind === "confirm_effect") {
      const details = act.factRefs.map((ref) => `${factText(ref, true)}.`).join(" ");
      return qualify(
        act.subjectRef,
        `A ação foi concluída.${details ? ` ${details}` : ""}`,
      );
    }
    if (act.kind === "communicate_failure") {
      return qualify(act.subjectRef, "Não foi possível concluir a ação.");
    }
    if (act.kind === "inform_required_action") {
      return qualify(act.subjectRef, "É necessário atendimento humano.");
    }
    return qualify(act.subjectRef, "Pode confirmar os dados?");
  });

  return Object.freeze({
    text: sentences.join(" "),
    parts: Object.freeze([]),
  });
}
