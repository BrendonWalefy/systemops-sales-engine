import { describe, expect, it } from "vitest";
import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { DraftResponse, DraftSpeechAct } from "@/conversation-core/composer/contract";
import { validateDraft } from "@/conversation-core/composer/validator";

const plan: V2AuthorizedResponsePlan = {
  version: "authorized-response-plan.v2",
  subjects: [
    { ref: "subject-a", type: "item", id: "a" },
    { ref: "subject-b", type: "item", id: "b" },
    { ref: "subject-option", type: "window", id: "w1" },
  ],
  evidence: [{ ref: "evidence-0", source: "read", reference: "snapshot-1" }],
  facts: [
    { ref: "fact-a", key: "amount", value: 1200, subjectRef: "subject-a", evidenceRef: "evidence-0", disclosure: "allowed" },
    { ref: "fact-b", key: "amount", value: 1800, subjectRef: "subject-b", evidenceRef: "evidence-0", disclosure: "allowed" },
    { ref: "fact-option", key: "window_label", value: "15:00", subjectRef: "subject-option", evidenceRef: "evidence-0", disclosure: "allowed" },
    { ref: "fact-internal", key: "score", value: 0.9, subjectRef: null, evidenceRef: "evidence-0", disclosure: "internal" },
  ],
  options: [{ ref: "option-0", id: "w1", subjectRef: "subject-option", factRefs: ["fact-option"] }],
  outcomes: [
    { ref: "information-a", outcomeType: "quote-a", semanticClass: "information_authorized", origin: { capabilityId: "quote" }, subjectRef: "subject-a", evidenceRefs: ["evidence-0"], factRefs: ["fact-a", "fact-internal"], optionRefs: [] },
    { ref: "information-b", outcomeType: "quote-b", semanticClass: "information_authorized", origin: { capabilityId: "quote" }, subjectRef: "subject-b", evidenceRefs: ["evidence-0"], factRefs: ["fact-b"], optionRefs: [] },
    { ref: "options", outcomeType: "windows-found", semanticClass: "options_found", origin: { capabilityId: "reservation" }, subjectRef: "subject-b", evidenceRefs: ["evidence-0"], factRefs: [], optionRefs: ["option-0"] },
    { ref: "completed", outcomeType: "reservation-completed", semanticClass: "effect_completed", origin: { capabilityId: "reservation" }, subjectRef: "subject-a", evidenceRefs: ["evidence-0"], factRefs: ["fact-a"], optionRefs: [] },
    { ref: "failed", outcomeType: "reservation-failed", semanticClass: "effect_failed", origin: { capabilityId: "reservation" }, subjectRef: null, evidenceRefs: ["evidence-0"], factRefs: [], optionRefs: [] },
    { ref: "human", outcomeType: "operator-required", semanticClass: "human_action_required", origin: { capabilityId: "safety" }, subjectRef: null, evidenceRefs: [], factRefs: [], optionRefs: [] },
    { ref: "clarify", outcomeType: "details-required", semanticClass: "clarification_required", origin: { capabilityId: "qualification" }, subjectRef: null, evidenceRefs: [], factRefs: [], optionRefs: [] },
  ],
};

function draft(act: DraftSpeechAct): DraftResponse {
  return { acts: [act] };
}

function codes(response: DraftResponse): string[] {
  const result = validateDraft(plan, response);
  return result.valid ? [] : result.violations.map(({ code }) => code);
}

describe("validator semântico V2", () => {
  it("valida e registra exatamente uma canonicalização do draft não confiável", () => {
    let reads = 0;
    const shiftingDraft = Object.defineProperty({}, "acts", {
      enumerable: true,
      get(): readonly DraftSpeechAct[] {
        reads += 1;
        if (reads <= 2) {
          return [{ kind: "communicate_failure", outcomeRef: "failed" }];
        }
        return [{
          kind: "confirm_effect",
          outcomeRef: "completed",
          subjectRef: "subject-a",
          factRefs: ["fact-a"],
        }];
      },
    }) as DraftResponse;

    const result = validateDraft(plan, shiftingDraft);

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected the failure draft to validate");
    expect(result.draft.acts).toEqual([
      { kind: "communicate_failure", outcomeRef: "failed" },
    ]);
    expect(reads).toBe(1);
    expect(Object.isFrozen(result.draft)).toBe(true);
    expect(Object.isFrozen(result.draft.acts)).toBe(true);
    expect(Object.isFrozen(result.draft.acts[0])).toBe(true);
  });

  it("não preserva aliases mutáveis depois da validação", () => {
    const sourceAct: DraftSpeechAct = {
      kind: "communicate_failure",
      outcomeRef: "failed",
    };
    const source: DraftResponse = { acts: [sourceAct] };

    const result = validateDraft(plan, source);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected draft to validate");

    Object.assign(sourceAct, {
      kind: "confirm_effect",
      outcomeRef: "completed",
      subjectRef: "subject-a",
      factRefs: ["fact-a"],
    });

    expect(result.draft.acts).toEqual([
      { kind: "communicate_failure", outcomeRef: "failed" },
    ]);
  });

  it("materializa accessors e proxies uma única vez e falha fechado quando lançam", () => {
    let kindReads = 0;
    const shiftingAct = Object.defineProperty({ outcomeRef: "failed" }, "kind", {
      enumerable: true,
      get() {
        kindReads += 1;
        return kindReads === 1 ? "communicate_failure" : "confirm_effect";
      },
    });
    let actsReads = 0;
    const proxyDraft = new Proxy({ acts: [shiftingAct] }, {
      get(target, property, receiver) {
        if (property === "acts") actsReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const result = validateDraft(plan, proxyDraft);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected canonical draft to validate");
    expect(result.draft.acts).toEqual([
      { kind: "communicate_failure", outcomeRef: "failed" },
    ]);
    expect({ actsReads, kindReads }).toEqual({ actsReads: 1, kindReads: 1 });

    const throwingDraft = Object.defineProperty({}, "acts", {
      get() { throw new Error("hostile accessor"); },
    });
    expect(validateDraft(plan, throwingDraft)).toEqual({
      valid: false,
      violations: [{ actIndex: -1, code: "invalid_draft_shape" }],
    });
  });

  it("rejeita refs inexistentes de outcome, fact, subject e option", () => {
    expect(codes(draft({ kind: "inform_fact", outcomeRef: "missing", factRef: "fact-a", subjectRef: "subject-a" }))).toContain("unknown_outcome_ref");
    expect(codes(draft({ kind: "inform_fact", outcomeRef: "information-a", factRef: "missing", subjectRef: "subject-a" }))).toContain("unknown_fact_ref");
    expect(codes(draft({ kind: "inform_fact", outcomeRef: "information-a", factRef: "fact-a", subjectRef: "missing" }))).toContain("unknown_subject_ref");
    expect(codes(draft({ kind: "offer_options", outcomeRef: "options", subjectRef: "subject-b", optionRefs: ["missing"] }))).toContain("unknown_option_ref");
  });

  it("rejeita fact de outro outcome", () => {
    expect(codes(draft({ kind: "inform_fact", outcomeRef: "information-a", factRef: "fact-b", subjectRef: "subject-b" }))).toContain("fact_outcome_mismatch");
  });

  it("rejeita troca de subject", () => {
    expect(codes(draft({ kind: "inform_fact", outcomeRef: "information-a", factRef: "fact-a", subjectRef: "subject-b" }))).toContain("subject_mismatch");
    expect(codes(draft({ kind: "offer_options", outcomeRef: "options", subjectRef: "subject-a", optionRefs: ["option-0"] }))).toContain("subject_mismatch");
  });

  it("rejeita opção pertencente a outro outcome", () => {
    const crossOutcomePlan: V2AuthorizedResponsePlan = {
      ...plan,
      options: [...plan.options, {
        ref: "option-1", id: "w2", subjectRef: "subject-option", factRefs: ["fact-option"],
      }],
      outcomes: [...plan.outcomes, {
        ref: "options-other", outcomeType: "other-windows-found",
        semanticClass: "options_found", origin: { capabilityId: "other-reservation" },
        subjectRef: "subject-b", evidenceRefs: ["evidence-0"], factRefs: [], optionRefs: ["option-1"],
      }],
    };
    const result = validateDraft(crossOutcomePlan, draft({
      kind: "offer_options", outcomeRef: "options-other", subjectRef: "subject-b", optionRefs: ["option-0"],
    }));

    expect(result.valid ? [] : result.violations.map(({ code }) => code))
      .toContain("option_outcome_mismatch");
  });

  it("rejeita fact interno", () => {
    expect(codes(draft({ kind: "inform_fact", outcomeRef: "information-a", factRef: "fact-internal", subjectRef: "subject-a" }))).toContain("fact_not_disclosable");
  });

  it.each([
    [{ kind: "inform_fact", outcomeRef: "information-a", factRef: "fact-a", subjectRef: "subject-a" }, true],
    [{ kind: "offer_options", outcomeRef: "options", subjectRef: "subject-b", optionRefs: ["option-0"] }, true],
    [{ kind: "confirm_effect", outcomeRef: "options", subjectRef: "subject-b", factRefs: [] }, false],
    [{ kind: "confirm_effect", outcomeRef: "completed", subjectRef: "subject-a", factRefs: ["fact-a"] }, true],
    [{ kind: "communicate_failure", outcomeRef: "failed" }, true],
    [{ kind: "confirm_effect", outcomeRef: "failed", subjectRef: "subject-a", factRefs: [] }, false],
    [{ kind: "inform_required_action", outcomeRef: "human" }, true],
    [{ kind: "confirm_effect", outcomeRef: "human", subjectRef: "subject-a", factRefs: [] }, false],
    [{ kind: "ask_clarification", outcomeRef: "clarify" }, true],
  ] as const)("aplica compatibilidade estruturada para %#", (act, expected) => {
    expect(validateDraft(plan, draft(act)).valid).toBe(expected);
  });
});
