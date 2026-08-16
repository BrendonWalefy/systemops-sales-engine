import { describe, expect, expectTypeOf, it } from "vitest";
import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { DraftSpeechAct } from "@/conversation-core/composer/contract";
import {
  renderDeterministicResponse,
} from "@/conversation-core/composer/deterministic-renderer";
import { validateDraft, type ValidatedDraftResponse } from "@/conversation-core/composer/validator";

const plan: V2AuthorizedResponsePlan = {
  version: "authorized-response-plan.v2",
  subjects: [
    { ref: "subject-a", type: "item", id: "a" },
    { ref: "subject-option", type: "window", id: "w1" },
  ],
  evidence: [{ ref: "evidence-0", source: "read", reference: "snapshot" }],
  facts: [
    { ref: "fact-a", key: "amount", value: 120000, subjectRef: "subject-a", evidenceRef: "evidence-0", disclosure: "allowed" },
    { ref: "fact-option", key: "window_label", value: "15:00", subjectRef: "subject-option", evidenceRef: "evidence-0", disclosure: "allowed" },
  ],
  options: [{ ref: "option-0", id: "w1", subjectRef: "subject-option", factRefs: ["fact-option"] }],
  outcomes: [
    { ref: "info", outcomeType: "quote-ready", semanticClass: "information_authorized", origin: { capabilityId: "quote" }, subjectRef: "subject-a", evidenceRefs: ["evidence-0"], factRefs: ["fact-a"], optionRefs: [] },
    { ref: "options", outcomeType: "windows-found", semanticClass: "options_found", origin: { capabilityId: "reservation" }, subjectRef: null, evidenceRefs: ["evidence-0"], factRefs: [], optionRefs: ["option-0"] },
    { ref: "completed", outcomeType: "reservation-completed", semanticClass: "effect_completed", origin: { capabilityId: "reservation" }, subjectRef: "subject-a", evidenceRefs: ["evidence-0"], factRefs: ["fact-a"], optionRefs: [] },
    { ref: "failed", outcomeType: "reservation-failed", semanticClass: "effect_failed", origin: { capabilityId: "reservation" }, subjectRef: null, evidenceRefs: [], factRefs: [], optionRefs: [] },
    { ref: "human", outcomeType: "operator-required", semanticClass: "human_action_required", origin: { capabilityId: "safety" }, subjectRef: null, evidenceRefs: [], factRefs: [], optionRefs: [] },
    { ref: "clarify", outcomeType: "details-required", semanticClass: "clarification_required", origin: { capabilityId: "qualification" }, subjectRef: null, evidenceRefs: [], factRefs: [], optionRefs: [] },
  ],
};

function render(act: DraftSpeechAct): string {
  const validation = validateDraft(plan, { acts: [act] });
  if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
  return renderDeterministicResponse({ draft: validation.draft }).text;
}

describe("renderer determinístico V2", () => {
  it("aceita somente draft validado no contrato", () => {
    expectTypeOf<Parameters<typeof renderDeterministicResponse>[0]["draft"]>()
      .toEqualTypeOf<ValidatedDraftResponse>();
    expectTypeOf<Parameters<typeof renderDeterministicResponse>[0]>()
      .not.toHaveProperty("language");
    expectTypeOf<Parameters<typeof renderDeterministicResponse>[0]>()
      .not.toHaveProperty("style");
  });

  it("verbaliza fact autorizado sem ampliar o valor", () => {
    expect(render({ kind: "inform_fact", outcomeRef: "info", factRef: "fact-a", subjectRef: "subject-a" }))
      .toBe("Informação: 120000.");
  });

  it("oferece opções sem alegar conclusão", () => {
    const text = render({ kind: "offer_options", outcomeRef: "options", subjectRef: null, optionRefs: ["option-0"] });
    expect(text).toBe("Tenho estas opções: 15:00.");
    expect(text).not.toMatch(/conclu|confirm/i);
  });

  it("confirma somente effect_completed", () => {
    expect(render({ kind: "confirm_effect", outcomeRef: "completed", subjectRef: "subject-a", factRefs: ["fact-a"] }))
      .toBe("A ação foi concluída. Informação: 120000.");
  });

  it("comunica falha sem texto de sucesso", () => {
    const text = render({ kind: "communicate_failure", outcomeRef: "failed" });
    expect(text).toBe("Não foi possível concluir a ação.");
    expect(text).not.toMatch(/confirmad|concluíd/i);
  });

  it("informa ação humana necessária sem alegar handoff", () => {
    expect(render({ kind: "inform_required_action", outcomeRef: "human" }))
      .toBe("É necessário atendimento humano.");
  });

  it("pede clarificação sem inventar fact", () => {
    expect(render({ kind: "ask_clarification", outcomeRef: "clarify" }))
      .toBe("Pode confirmar os dados?");
  });

  it("renderiza snapshots imutáveis do draft e do plano validados", () => {
    const mutablePlan = structuredClone(plan) as V2AuthorizedResponsePlan;
    const acts: DraftSpeechAct[] = [
      { kind: "inform_fact", outcomeRef: "info", factRef: "fact-a", subjectRef: "subject-a" },
    ];
    const validation = validateDraft(mutablePlan, { acts });
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));

    mutablePlan.facts[0]!.value = 999;
    acts.push({
      kind: "confirm_effect",
      outcomeRef: "completed",
      subjectRef: "subject-a",
      factRefs: ["fact-a"],
    });

    expect(renderDeterministicResponse({ draft: validation.draft }).text)
      .toBe("Informação: 120000.");
  });

  it("ignora material lexical hostil mesmo quando chega por cast em runtime", () => {
    const validation = validateDraft(plan, {
      acts: [{ kind: "inform_fact", outcomeRef: "info", factRef: "fact-a", subjectRef: "subject-a" }],
    });
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
    const hostileInput = {
      draft: validation.draft,
      language: {
        factTerms: [{ factKey: "amount", label: "Desconto garantido" }],
      },
      style: { greeting: "include", emoji: "light" },
    } as unknown as Parameters<typeof renderDeterministicResponse>[0];

    const text = renderDeterministicResponse(hostileInput).text;
    expect(text).not.toMatch(/desconto|garantid/i);
    expect(text).toBe("Informação: 120000.");
  });
});
