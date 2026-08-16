import type {
  AuthorizedFact,
  AuthorizedOption,
  AuthorizedOutcome,
  V2AuthorizedResponsePlan,
} from "@/conversation-core/authorized-response-plan";
import { snapshotV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { assertV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
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
  | "invalid_draft_shape"
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
  | "duplicate_reference"
  | "incompatible_speech_act";

export type DraftViolation = {
  actIndex: number;
  code: DraftViolationCode;
};

export type DraftValidationResult =
  | { valid: true; draft: ValidatedDraftResponse }
  | {
      valid: false;
      violations: readonly DraftViolation[];
      draft: DraftResponse | null;
    };

const authorizedPlans = new WeakMap<
  ValidatedDraftResponse,
  V2AuthorizedResponsePlan<string>
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function copyStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const length = value.length;
  const copied: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const item: unknown = value[index];
    if (typeof item !== "string") return null;
    copied.push(item);
  }
  return Object.freeze(copied);
}

function copyAct(value: unknown): DraftSpeechAct | null {
  if (!isRecord(value)) return null;
  const kind: unknown = value.kind;

  if (kind === "inform_fact") {
    const outcomeRef: unknown = value.outcomeRef;
    const factRef: unknown = value.factRef;
    const subjectRef: unknown = value.subjectRef;
    if (
      typeof outcomeRef !== "string" ||
      typeof factRef !== "string" ||
      typeof subjectRef !== "string"
    ) return null;
    return Object.freeze({ kind, outcomeRef, factRef, subjectRef });
  }

  if (kind === "offer_options") {
    const outcomeRef: unknown = value.outcomeRef;
    const subjectRef: unknown = value.subjectRef;
    const rawOptionRefs: unknown = value.optionRefs;
    const optionRefs = copyStringArray(rawOptionRefs);
    if (
      typeof outcomeRef !== "string" ||
      (typeof subjectRef !== "string" && subjectRef !== null) ||
      optionRefs === null
    ) return null;
    return Object.freeze({ kind, outcomeRef, subjectRef, optionRefs });
  }

  if (kind === "confirm_effect") {
    const outcomeRef: unknown = value.outcomeRef;
    const subjectRef: unknown = value.subjectRef;
    const rawFactRefs: unknown = value.factRefs;
    const factRefs = copyStringArray(rawFactRefs);
    if (
      typeof outcomeRef !== "string" ||
      typeof subjectRef !== "string" ||
      factRefs === null
    ) return null;
    return Object.freeze({ kind, outcomeRef, subjectRef, factRefs });
  }

  if (
    kind === "communicate_failure" ||
    kind === "inform_required_action" ||
    kind === "ask_clarification"
  ) {
    const outcomeRef: unknown = value.outcomeRef;
    const subjectRef: unknown = value.subjectRef;
    if (
      typeof outcomeRef !== "string" ||
      (typeof subjectRef !== "string" && subjectRef !== null)
    ) return null;
    return Object.freeze({ kind, outcomeRef, subjectRef });
  }

  return null;
}

function canonicalizeDraft(value: unknown): DraftResponse | null {
  if (!isRecord(value)) return null;
  const rawActs: unknown = value.acts;
  if (!Array.isArray(rawActs)) return null;
  const length = rawActs.length;
  const acts: DraftSpeechAct[] = [];
  for (let index = 0; index < length; index += 1) {
    const rawAct: unknown = rawActs[index];
    const act = copyAct(rawAct);
    if (!act) return null;
    acts.push(act);
  }
  return Object.freeze({ acts: Object.freeze(acts) });
}

export function authorizedPlanFor(
  draft: ValidatedDraftResponse,
): V2AuthorizedResponsePlan<string> {
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
  outcome: AuthorizedOutcome<string> | undefined;
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

export function validateDraft<OutcomeType extends string>(
  plan: V2AuthorizedResponsePlan<OutcomeType>,
  draft: unknown,
): DraftValidationResult {
  assertV2AuthorizedResponsePlan(plan);
  let canonicalDraft: DraftResponse | null = null;
  try {
    canonicalDraft = canonicalizeDraft(draft);
  } catch {
    canonicalDraft = null;
  }
  if (!canonicalDraft) {
    return {
      valid: false,
      violations: [{ actIndex: -1, code: "invalid_draft_shape" }],
      draft: null,
    };
  }

  const outcomes = new Map(plan.outcomes.map((item) => [item.ref, item]));
  const options = new Map(plan.options.map((item) => [item.ref, item]));
  const facts = new Map(plan.facts.map((item) => [item.ref, item]));
  const subjects = new Set(plan.subjects.map(({ ref }) => ref));
  const violations: DraftViolation[] = [];

  if (canonicalDraft.acts.length === 0) push(violations, -1, "empty_draft");

  canonicalDraft.acts.forEach((act, actIndex) => {
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
      if (new Set(act.optionRefs).size !== act.optionRefs.length) {
        push(violations, actIndex, "duplicate_reference");
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
      if (new Set(act.factRefs).size !== act.factRefs.length) {
        push(violations, actIndex, "duplicate_reference");
      }
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
      return;
    }

    if (act.subjectRef !== null && !subjects.has(act.subjectRef)) {
      push(violations, actIndex, "unknown_subject_ref");
    }
    if (outcome && outcome.subjectRef !== act.subjectRef) {
      push(violations, actIndex, "subject_mismatch");
    }
  });

  if (violations.length > 0) {
    return { valid: false, violations, draft: canonicalDraft };
  }
  const validated = canonicalDraft as ValidatedDraftResponse;
  authorizedPlans.set(validated, snapshotV2AuthorizedResponsePlan(plan));
  return { valid: true, draft: validated };
}
