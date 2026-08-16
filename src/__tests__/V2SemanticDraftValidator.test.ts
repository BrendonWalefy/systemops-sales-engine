import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { DraftResponse, DraftSpeechAct } from "@/conversation-core/composer/contract";
import { validateDraft } from "@/conversation-core/composer/validator";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import type { ActionResult } from "@/conversation-core/decision";

const outcomeSchema = defineOutcomeSchema({
  quote_a: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
  quote_b: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
  windows_found: { semanticClass: "options_found", subjectRequirement: "required", evidenceRequirement: "required" },
  reservation_completed: { semanticClass: "effect_completed", subjectRequirement: "required", evidenceRequirement: "required" },
  reservation_failed: { semanticClass: "effect_failed", subjectRequirement: "forbidden", evidenceRequirement: "required" },
  operator_required: { semanticClass: "human_action_required", subjectRequirement: "forbidden", evidenceRequirement: "optional" },
  details_required: { semanticClass: "clarification_required", subjectRequirement: "forbidden", evidenceRequirement: "optional" },
  other_windows_found: { semanticClass: "options_found", subjectRequirement: "required", evidenceRequirement: "required" },
} as const);
const subjectA = { type: "item", id: "a", displayName: "Item A" } as const;
const subjectB = { type: "item", id: "b", displayName: "Item B" } as const;
const optionSubject = { type: "window", id: "w1", displayName: "15:00" } as const;
const evidence = { source: "read", reference: "snapshot-1" } as const;
const factA = { key: "amount", value: { kind: "integer", value: 1200 }, subject: subjectA, evidence, disclosure: "allowed" } as const;
const factB = { key: "amount", value: { kind: "integer", value: 1800 }, subject: subjectB, evidence, disclosure: "allowed" } as const;
const internalFact = { key: "score", value: { kind: "integer", value: 1 }, subject: null, evidence, disclosure: "internal" } as const;
const optionFact = { key: "window_label", value: { kind: "text", value: "15:00" }, subject: optionSubject, evidence, disclosure: "allowed" } as const;
const results: ActionResult<typeof outcomeSchema>[] = [
  { type: "quote_a", semanticClass: "information_authorized", origin: { capabilityId: "quote" }, subject: subjectA, evidence: [evidence], facts: [factA, internalFact] },
  { type: "quote_b", semanticClass: "information_authorized", origin: { capabilityId: "quote" }, subject: subjectB, evidence: [evidence], facts: [factB] },
  { type: "windows_found", semanticClass: "options_found", origin: { capabilityId: "reservation" }, subject: subjectB, evidence: [evidence], facts: [], options: [{ id: "w1", subject: optionSubject, facts: [optionFact] }] },
  { type: "reservation_completed", semanticClass: "effect_completed", origin: { capabilityId: "reservation" }, subject: subjectA, evidence: [evidence], facts: [factA] },
  { type: "reservation_failed", semanticClass: "effect_failed", origin: { capabilityId: "reservation" }, subject: null, evidence: [evidence], facts: [] },
  { type: "operator_required", semanticClass: "human_action_required", origin: { capabilityId: "safety" }, subject: null, evidence: [], facts: [] },
  { type: "details_required", semanticClass: "clarification_required", origin: { capabilityId: "qualification" }, subject: null, evidence: [], facts: [] },
];
const plan = buildV2AuthorizedResponsePlan(outcomeSchema, results);
const refs = Object.freeze({
  subjectA: "subject-0", subjectB: "subject-1", optionSubject: "subject-2",
  factA: "fact-0", internalFact: "fact-1", factB: "fact-2", optionFact: "fact-3",
  informationA: "outcome-0", informationB: "outcome-1", options: "outcome-2",
  completed: "outcome-3", failed: "outcome-4", human: "outcome-5", clarify: "outcome-6",
});

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
          return [{ kind: "communicate_failure", outcomeRef: refs.failed }];
        }
        return [{
          kind: "confirm_effect",
          outcomeRef: refs.completed,
          subjectRef: refs.subjectA,
          factRefs: ["fact-4"],
        }];
      },
    }) as DraftResponse;

    const result = validateDraft(plan, shiftingDraft);

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected the failure draft to validate");
    expect(result.draft.acts).toEqual([
      { kind: "communicate_failure", outcomeRef: refs.failed },
    ]);
    expect(reads).toBe(1);
    expect(Object.isFrozen(result.draft)).toBe(true);
    expect(Object.isFrozen(result.draft.acts)).toBe(true);
    expect(Object.isFrozen(result.draft.acts[0])).toBe(true);
  });

  it("não preserva aliases mutáveis depois da validação", () => {
    const sourceAct: DraftSpeechAct = {
      kind: "communicate_failure",
      outcomeRef: refs.failed,
    };
    const source: DraftResponse = { acts: [sourceAct] };

    const result = validateDraft(plan, source);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected draft to validate");

    Object.assign(sourceAct, {
      kind: "confirm_effect",
      outcomeRef: refs.completed,
      subjectRef: refs.subjectA,
      factRefs: ["fact-4"],
    });

    expect(result.draft.acts).toEqual([
      { kind: "communicate_failure", outcomeRef: refs.failed },
    ]);
  });

  it("materializa accessors e proxies uma única vez e falha fechado quando lançam", () => {
    let kindReads = 0;
    const shiftingAct = Object.defineProperty({ outcomeRef: refs.failed }, "kind", {
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
      { kind: "communicate_failure", outcomeRef: refs.failed },
    ]);
    expect({ actsReads, kindReads }).toEqual({ actsReads: 1, kindReads: 1 });

    const throwingDraft = Object.defineProperty({}, "acts", {
      get() { throw new Error("hostile accessor"); },
    });
    expect(validateDraft(plan, throwingDraft)).toEqual({
      valid: false,
      violations: [{ actIndex: -1, code: "invalid_draft_shape" }],
      draft: null,
    });
  });

  it("rejeita refs inexistentes de outcome, fact, subject e option", () => {
    expect(codes(draft({ kind: "inform_fact", outcomeRef: "missing", factRef: refs.factA, subjectRef: refs.subjectA }))).toContain("unknown_outcome_ref");
    expect(codes(draft({ kind: "inform_fact", outcomeRef: refs.informationA, factRef: "missing", subjectRef: refs.subjectA }))).toContain("unknown_fact_ref");
    expect(codes(draft({ kind: "inform_fact", outcomeRef: refs.informationA, factRef: refs.factA, subjectRef: "missing" }))).toContain("unknown_subject_ref");
    expect(codes(draft({ kind: "offer_options", outcomeRef: refs.options, subjectRef: refs.subjectB, optionRefs: ["missing"] }))).toContain("unknown_option_ref");
  });

  it("rejeita fact de outro outcome", () => {
    expect(codes(draft({ kind: "inform_fact", outcomeRef: refs.informationA, factRef: refs.factB, subjectRef: refs.subjectB }))).toContain("fact_outcome_mismatch");
  });

  it("rejeita troca de subject", () => {
    expect(codes(draft({ kind: "inform_fact", outcomeRef: refs.informationA, factRef: refs.factA, subjectRef: refs.subjectB }))).toContain("subject_mismatch");
    expect(codes(draft({ kind: "offer_options", outcomeRef: refs.options, subjectRef: refs.subjectA, optionRefs: ["option-0"] }))).toContain("subject_mismatch");
  });

  it("rejeita opção pertencente a outro outcome", () => {
    const crossOutcomePlan = buildV2AuthorizedResponsePlan(outcomeSchema, [
      ...results,
      {
        type: "other_windows_found",
        semanticClass: "options_found",
        origin: { capabilityId: "other-reservation" },
        subject: subjectB,
        evidence: [evidence],
        facts: [],
        options: [{ id: "w2", subject: optionSubject, facts: [optionFact] }],
      },
    ]);
    const result = validateDraft(crossOutcomePlan, draft({
      kind: "offer_options", outcomeRef: "outcome-7", subjectRef: refs.subjectB, optionRefs: ["option-0"],
    }));

    expect(result.valid ? [] : result.violations.map(({ code }) => code))
      .toContain("option_outcome_mismatch");
  });

  it("rejeita fact interno", () => {
    expect(codes(draft({ kind: "inform_fact", outcomeRef: refs.informationA, factRef: refs.internalFact, subjectRef: refs.subjectA }))).toContain("fact_not_disclosable");
  });

  it("rejeita refs duplicadas dentro do mesmo speech act", () => {
    const duplicateOptions = validateDraft(plan, {
      acts: [{
        kind: "offer_options",
        outcomeRef: refs.options,
        subjectRef: refs.subjectB,
        optionRefs: ["option-0", "option-0"],
      }],
    });
    expect(duplicateOptions.valid ? [] : duplicateOptions.violations.map(({ code }) => code))
      .toContain("duplicate_reference");

    const duplicateFacts = validateDraft(plan, {
      acts: [{
        kind: "confirm_effect",
        outcomeRef: refs.completed,
        subjectRef: refs.subjectA,
        factRefs: ["fact-4", "fact-4"],
      }],
    });
    expect(duplicateFacts.valid ? [] : duplicateFacts.violations.map(({ code }) => code))
      .toContain("duplicate_reference");
  });

  it.each([
    [{ kind: "inform_fact", outcomeRef: refs.informationA, factRef: refs.factA, subjectRef: refs.subjectA }, true],
    [{ kind: "offer_options", outcomeRef: refs.options, subjectRef: refs.subjectB, optionRefs: ["option-0"] }, true],
    [{ kind: "confirm_effect", outcomeRef: refs.options, subjectRef: refs.subjectB, factRefs: [] }, false],
    [{ kind: "confirm_effect", outcomeRef: refs.completed, subjectRef: refs.subjectA, factRefs: ["fact-4"] }, true],
    [{ kind: "communicate_failure", outcomeRef: refs.failed }, true],
    [{ kind: "confirm_effect", outcomeRef: refs.failed, subjectRef: refs.subjectA, factRefs: [] }, false],
    [{ kind: "inform_required_action", outcomeRef: refs.human }, true],
    [{ kind: "confirm_effect", outcomeRef: refs.human, subjectRef: refs.subjectA, factRefs: [] }, false],
    [{ kind: "ask_clarification", outcomeRef: refs.clarify }, true],
  ] as const)("aplica compatibilidade estruturada para %#", (act, expected) => {
    expect(validateDraft(plan, draft(act)).valid).toBe(expected);
  });
});
