import type {
  AuthorizedFact,
  AuthorizedOption,
  AuthorizedOutcome,
  V2AuthorizedResponsePlan,
} from "@/conversation-core/authorized-response-plan";
import { snapshotV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type {
  DraftResponse,
  DraftSpeechAct,
} from "@/conversation-core/composer/contract";
import type { OutcomeSemanticClass } from "@/conversation-core/decision";

declare const validatedDraft: unique symbol;
export type ValidatedDraftResponse = DraftResponse & {
  readonly [validatedDraft]: true;
};

export type DraftViolationCode =
  | "unknown_outcome_ref"
  | "unknown_fact_ref"
  | "unknown_subject_ref"
  | "unknown_option_ref"
  | "fact_outcome_mismatch"
  | "option_outcome_mismatch"
  | "subject_mismatch"
  | "fact_not_disclosable"
  | "empty_draft"
  | "empty_reference_set"
  | "incompatible_speech_act";

export type DraftViolation = {
  actIndex: number;
  code: DraftViolationCode;
};

export type DraftValidationResult =
  | { valid: true; draft: ValidatedDraftResponse }
  | { valid: false; violations: readonly DraftViolation[] };

const authorizedPlans = new WeakMap<ValidatedDraftResponse, V2AuthorizedResponsePlan>();

function snapshotDraft(draft: DraftResponse): ValidatedDraftResponse {
  const acts = draft.acts.map((act): DraftSpeechAct => {
    if (act.kind === "offer_options") {
      return Object.freeze({ ...act, optionRefs: Object.freeze([...act.optionRefs]) });
    }
    if (act.kind === "confirm_effect") {
      return Object.freeze({ ...act, factRefs: Object.freeze([...act.factRefs]) });
    }
    return Object.freeze({ ...act });
  });
  return Object.freeze({ acts: Object.freeze(acts) }) as ValidatedDraftResponse;
}

export function authorizedPlanFor(
  draft: ValidatedDraftResponse,
): V2AuthorizedResponsePlan {
  const plan = authorizedPlans.get(draft);
  if (!plan) throw new Error("draft was not validated by the semantic validator");
  return plan;
}

const compatibleClass: Record<DraftSpeechAct["kind"], OutcomeSemanticClass> = {
  inform_fact: "information_authorized",
  offer_options: "options_found",
  confirm_effect: "effect_completed",
  communicate_failure: "effect_failed",
  inform_required_action: "human_action_required",
  ask_clarification: "clarification_required",
};

function push(
  violations: DraftViolation[],
  actIndex: number,
  code: DraftViolationCode,
): void {
  if (!violations.some((item) => item.actIndex === actIndex && item.code === code)) {
    violations.push({ actIndex, code });
  }
}

function validateFact(input: {
  factRef: string;
  outcome: AuthorizedOutcome | undefined;
  expectedSubjectRef: string | null;
  facts: ReadonlyMap<string, AuthorizedFact>;
  allowedFactRefs: readonly string[];
  subjects: ReadonlySet<string>;
  violations: DraftViolation[];
  actIndex: number;
}): void {
  const fact = input.facts.get(input.factRef);
  if (!fact) {
    push(input.violations, input.actIndex, "unknown_fact_ref");
    return;
  }
  if (!input.allowedFactRefs.includes(fact.ref)) {
    push(input.violations, input.actIndex, "fact_outcome_mismatch");
  }
  if (fact.disclosure !== "allowed") {
    push(input.violations, input.actIndex, "fact_not_disclosable");
  }
  if (fact.subjectRef !== input.expectedSubjectRef) {
    push(input.violations, input.actIndex, "subject_mismatch");
  }
  if (fact.subjectRef !== null && !input.subjects.has(fact.subjectRef)) {
    push(input.violations, input.actIndex, "unknown_subject_ref");
  }
}

export function validateDraft(
  plan: V2AuthorizedResponsePlan,
  draft: DraftResponse,
): DraftValidationResult {
  const outcomes = new Map(plan.outcomes.map((item) => [item.ref, item]));
  const options = new Map(plan.options.map((item) => [item.ref, item]));
  const facts = new Map(plan.facts.map((item) => [item.ref, item]));
  const subjects = new Set(plan.subjects.map(({ ref }) => ref));
  const violations: DraftViolation[] = [];

  if (draft.acts.length === 0) push(violations, -1, "empty_draft");

  draft.acts.forEach((act, actIndex) => {
    const outcome = outcomes.get(act.outcomeRef);
    if (!outcome) {
      push(violations, actIndex, "unknown_outcome_ref");
    } else if (outcome.semanticClass !== compatibleClass[act.kind]) {
      push(violations, actIndex, "incompatible_speech_act");
    }

    if (act.kind === "inform_fact") {
      if (!subjects.has(act.subjectRef)) {
        push(violations, actIndex, "unknown_subject_ref");
      }
      validateFact({
        factRef: act.factRef,
        outcome,
        expectedSubjectRef: act.subjectRef,
        facts,
        allowedFactRefs: outcome?.factRefs ?? [],
        subjects,
        violations,
        actIndex,
      });
      if (outcome && outcome.subjectRef !== act.subjectRef) {
        push(violations, actIndex, "subject_mismatch");
      }
      return;
    }

    if (act.kind === "offer_options") {
      if (act.optionRefs.length === 0) {
        push(violations, actIndex, "empty_reference_set");
      }
      if (act.subjectRef !== null && !subjects.has(act.subjectRef)) {
        push(violations, actIndex, "unknown_subject_ref");
      }
      if (outcome && outcome.subjectRef !== act.subjectRef) {
        push(violations, actIndex, "subject_mismatch");
      }
      for (const optionRef of act.optionRefs) {
        const option: AuthorizedOption | undefined = options.get(optionRef);
        if (!option) {
          push(violations, actIndex, "unknown_option_ref");
          continue;
        }
        if (!outcome?.optionRefs.includes(optionRef)) {
          push(violations, actIndex, "option_outcome_mismatch");
        }
        if (!subjects.has(option.subjectRef)) {
          push(violations, actIndex, "unknown_subject_ref");
        }
        for (const factRef of option.factRefs) {
          validateFact({
            factRef,
            outcome,
            expectedSubjectRef: option.subjectRef,
            facts,
            allowedFactRefs: option.factRefs,
            subjects,
            violations,
            actIndex,
          });
        }
      }
      return;
    }

    if (act.kind === "confirm_effect") {
      if (!subjects.has(act.subjectRef)) {
        push(violations, actIndex, "unknown_subject_ref");
      }
      if (outcome && outcome.subjectRef !== act.subjectRef) {
        push(violations, actIndex, "subject_mismatch");
      }
      for (const factRef of act.factRefs) {
        validateFact({
          factRef,
          outcome,
          expectedSubjectRef: act.subjectRef,
          facts,
          allowedFactRefs: outcome?.factRefs ?? [],
          subjects,
          violations,
          actIndex,
        });
      }
    }
  });

  if (violations.length > 0) return { valid: false, violations };
  const validated = snapshotDraft(draft);
  authorizedPlans.set(validated, snapshotV2AuthorizedResponsePlan(plan));
  return { valid: true, draft: validated };
}
