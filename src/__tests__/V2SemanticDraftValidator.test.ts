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
