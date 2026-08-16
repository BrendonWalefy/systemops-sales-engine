import type { CoreResponse } from "@/conversation-core/composer/contract";
import {
  authorizedPlanFor,
  type ValidatedDraftResponse,
} from "@/conversation-core/composer/validator";

function formatValue(
  value: string | number | boolean,
): string {
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "number") return String(value);
  return String(value);
}

export function renderDeterministicResponse(input: {
  draft: ValidatedDraftResponse;
}): CoreResponse {
  const plan = authorizedPlanFor(input.draft);
  const options = new Map(plan.options.map((item) => [item.ref, item]));
  const facts = new Map(plan.facts.map((item) => [item.ref, item]));

  const factText = (factRef: string, includeLabel: boolean): string => {
    const fact = facts.get(factRef);
    if (!fact || fact.disclosure !== "allowed") throw new Error(`fact ${factRef} is not renderable`);
    const value = formatValue(fact.value);
    return includeLabel ? `Informação: ${value}` : value;
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
    if (act.kind === "confirm_effect") {
      const details = act.factRefs.map((ref) => `${factText(ref, true)}.`).join(" ");
      return `A ação foi concluída.${details ? ` ${details}` : ""}`;
    }
    if (act.kind === "communicate_failure") {
      return "Não foi possível concluir a ação.";
    }
    if (act.kind === "inform_required_action") {
      return "É necessário atendimento humano.";
    }
    return "Pode confirmar os dados?";
  });

  return { text: sentences.join(" "), parts: [] };
}
