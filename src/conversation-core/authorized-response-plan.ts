import type {
  ActionResult,
  Evidence,
  Fact,
  FactValue,
  OutcomeSchema,
  OutcomeTypeOf,
  OutcomeSemanticClass,
  Subject,
} from "@/conversation-core/decision";
import {
  assertActionResultMatchesOutcomeSchema,
} from "@/conversation-core/decision";

export const V2_AUTHORIZED_RESPONSE_PLAN_VERSION = "authorized-response-plan.v2" as const;

export type AuthorizedSubject = Subject & { ref: string };
export type AuthorizedEvidence = Evidence & { ref: string };
export type AuthorizedFact = Omit<Fact, "subject" | "evidence"> & {
  ref: string;
  subjectRef: string | null;
  evidenceRef: string;
};
export type AuthorizedOption = {
  ref: string;
  id: string;
  subjectRef: string;
  factRefs: readonly string[];
};
export type AuthorizedOutcome<OutcomeType extends string = string> = {
  ref: string;
  outcomeType: OutcomeType;
  semanticClass: OutcomeSemanticClass;
  origin: { capabilityId: string };
  subjectRef: string | null;
  evidenceRefs: readonly string[];
  factRefs: readonly string[];
  optionRefs: readonly string[];
};

type V2AuthorizedResponsePlanData<OutcomeType extends string = string> = {
  version: typeof V2_AUTHORIZED_RESPONSE_PLAN_VERSION;
  outcomes: readonly AuthorizedOutcome<OutcomeType>[];
  options: readonly AuthorizedOption[];
  facts: readonly AuthorizedFact[];
  subjects: readonly AuthorizedSubject[];
  evidence: readonly AuthorizedEvidence[];
};

declare const validatedAuthorizedResponsePlan: unique symbol;
export type V2AuthorizedResponsePlan<OutcomeType extends string = string> =
  V2AuthorizedResponsePlanData<OutcomeType> & {
    readonly [validatedAuthorizedResponsePlan]: true;
  };

const validatedPlans = new WeakSet<object>();

export function assertV2AuthorizedResponsePlan(
  plan: V2AuthorizedResponsePlan,
): void {
  if (!validatedPlans.has(plan)) {
    throw new Error("validated plan required");
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`authorized plan contains duplicate ${label} refs`);
  }
}

function snapshotFactValue(value: FactValue): FactValue {
  if (value.kind === "text") {
    if (value.value.length === 0 || /[\r\n]/.test(value.value)) {
      throw new Error("authorized plan text value is invalid");
    }
    return Object.freeze({ kind: value.kind, value: value.value });
  }
  if (value.kind === "integer") {
    if (!Number.isSafeInteger(value.value)) {
      throw new Error("authorized plan integer value is invalid");
    }
    return Object.freeze({ kind: value.kind, value: value.value });
  }
  if (value.kind === "money") {
    if (
      value.currency !== "BRL" ||
      !Number.isSafeInteger(value.amountInMinor) ||
      value.amountInMinor < 0
    ) {
      throw new Error("authorized plan money value is invalid");
    }
    return Object.freeze({
      kind: value.kind,
      amountInMinor: value.amountInMinor,
      currency: value.currency,
    });
  }
  if (value.kind === "boolean" && typeof value.value === "boolean") {
    return Object.freeze({ kind: value.kind, value: value.value });
  }
  throw new Error("authorized plan fact value kind is invalid");
}

function assertGeneratedPlanGraph<OutcomeType extends string>(
  plan: V2AuthorizedResponsePlanData<OutcomeType>,
): void {
  if (plan.version !== V2_AUTHORIZED_RESPONSE_PLAN_VERSION) {
    throw new Error("authorized plan version is invalid");
  }
  assertUnique(plan.subjects.map(({ ref }) => ref), "subject");
  assertUnique(plan.evidence.map(({ ref }) => ref), "evidence");
  assertUnique(plan.facts.map(({ ref }) => ref), "fact");
  assertUnique(plan.options.map(({ ref }) => ref), "option");
  assertUnique(plan.outcomes.map(({ ref }) => ref), "outcome");

  const subjects = new Set(plan.subjects.map(({ ref }) => ref));
  const evidence = new Set(plan.evidence.map(({ ref }) => ref));
  const facts = new Map(plan.facts.map((fact) => [fact.ref, fact]));
  const options = new Map(plan.options.map((option) => [option.ref, option]));

  for (const fact of plan.facts) {
    if (fact.subjectRef !== null && !subjects.has(fact.subjectRef)) {
      throw new Error(`authorized plan contains dangling subject ref: ${fact.subjectRef}`);
    }
    if (!evidence.has(fact.evidenceRef)) {
      throw new Error(`authorized plan contains dangling evidence ref: ${fact.evidenceRef}`);
    }
  }
  for (const option of plan.options) {
    assertUnique(option.factRefs, `option ${option.ref} fact`);
    if (!subjects.has(option.subjectRef)) {
      throw new Error(`authorized plan contains dangling subject ref: ${option.subjectRef}`);
    }
    for (const factRef of option.factRefs) {
      const fact = facts.get(factRef);
      if (!fact) throw new Error(`authorized plan contains dangling fact ref: ${factRef}`);
      if (fact.subjectRef !== option.subjectRef) {
        throw new Error(`authorized plan option/fact subject mismatch: ${option.ref}`);
      }
    }
  }
  for (const outcome of plan.outcomes) {
    assertUnique(outcome.evidenceRefs, `outcome ${outcome.ref} evidence`);
    assertUnique(outcome.factRefs, `outcome ${outcome.ref} fact`);
    assertUnique(outcome.optionRefs, `outcome ${outcome.ref} option`);
    if (outcome.subjectRef !== null && !subjects.has(outcome.subjectRef)) {
      throw new Error(`authorized plan contains dangling subject ref: ${outcome.subjectRef}`);
    }
    for (const evidenceRef of outcome.evidenceRefs) {
      if (!evidence.has(evidenceRef)) {
        throw new Error(`authorized plan contains dangling evidence ref: ${evidenceRef}`);
      }
    }
    for (const factRef of outcome.factRefs) {
      const fact = facts.get(factRef);
      if (!fact) throw new Error(`authorized plan contains dangling fact ref: ${factRef}`);
      if (!outcome.evidenceRefs.includes(fact.evidenceRef)) {
        throw new Error(`authorized plan outcome/fact evidence mismatch: ${outcome.ref}`);
      }
      if (
        fact.disclosure === "allowed" &&
        fact.subjectRef !== outcome.subjectRef
      ) {
        throw new Error(`authorized plan outcome/fact subject mismatch: ${outcome.ref}`);
      }
    }
    for (const optionRef of outcome.optionRefs) {
      const option = options.get(optionRef);
      if (!option) throw new Error(`authorized plan contains dangling option ref: ${optionRef}`);
      for (const factRef of option.factRefs) {
        const fact = facts.get(factRef)!;
        if (!outcome.evidenceRefs.includes(fact.evidenceRef)) {
          throw new Error(`authorized plan outcome/option evidence mismatch: ${outcome.ref}`);
        }
      }
    }
    if (outcome.semanticClass === "options_found") {
      if (outcome.optionRefs.length === 0) {
        throw new Error(`authorized plan options outcome is empty: ${outcome.ref}`);
      }
    } else if (outcome.optionRefs.length > 0) {
      throw new Error(`authorized plan non-options outcome has options: ${outcome.ref}`);
    }
  }
}

function freezeAndRegisterPlan<OutcomeType extends string>(
  plan: V2AuthorizedResponsePlanData<OutcomeType>,
): V2AuthorizedResponsePlan<OutcomeType> {
  assertGeneratedPlanGraph(plan);
  const snapshot = Object.freeze({
    version: plan.version,
    subjects: Object.freeze(plan.subjects.map((subject) => Object.freeze({ ...subject }))),
    evidence: Object.freeze(plan.evidence.map((item) => Object.freeze({ ...item }))),
    facts: Object.freeze(plan.facts.map((fact) => Object.freeze({
      ...fact,
      value: snapshotFactValue(fact.value),
    }))),
    options: Object.freeze(plan.options.map((option) => Object.freeze({
      ...option,
      factRefs: Object.freeze([...option.factRefs]),
    }))),
    outcomes: Object.freeze(plan.outcomes.map((outcome) => Object.freeze({
      ...outcome,
      origin: Object.freeze({ ...outcome.origin }),
      evidenceRefs: Object.freeze([...outcome.evidenceRefs]),
      factRefs: Object.freeze([...outcome.factRefs]),
      optionRefs: Object.freeze([...outcome.optionRefs]),
    }))),
  }) as V2AuthorizedResponsePlan<OutcomeType>;
  validatedPlans.add(snapshot);
  return snapshot;
}

export function snapshotV2AuthorizedResponsePlan<OutcomeType extends string>(
  plan: V2AuthorizedResponsePlan<OutcomeType>,
): V2AuthorizedResponsePlan<OutcomeType> {
  assertV2AuthorizedResponsePlan(plan);
  return plan;
}

export function buildV2AuthorizedResponsePlan<Schema extends OutcomeSchema>(
  schema: Schema,
  actionResults: readonly ActionResult<Schema>[],
): V2AuthorizedResponsePlan<OutcomeTypeOf<Schema>> {
  let canonicalResults: readonly ActionResult<Schema>[];
  try {
    canonicalResults = structuredClone(actionResults) as readonly ActionResult<Schema>[];
  } catch {
    throw new Error("action results could not be canonicalized");
  }
  const subjects: AuthorizedSubject[] = [];
  const evidence: AuthorizedEvidence[] = [];
  const facts: AuthorizedFact[] = [];
  const options: AuthorizedOption[] = [];
  const outcomes: AuthorizedOutcome<OutcomeTypeOf<Schema>>[] = [];
  const subjectRefs = new Map<string, string>();
  const evidenceRefs = new Map<string, string>();

  const registerSubject = (subject: Subject | null): string | null => {
    if (!subject) return null;
    if (
      subject.type.length === 0 ||
      subject.id.length === 0 ||
      subject.displayName.length === 0 ||
      subject.displayName.length > 120 ||
      subject.displayName !== subject.displayName.trim() ||
      /[\r\n]/.test(subject.displayName)
    ) {
      throw new Error("authorized subject requires a valid public display name");
    }
    const identity = JSON.stringify([subject.type, subject.id]);
    const existing = subjectRefs.get(identity);
    if (existing) {
      const registered = subjects.find(({ ref }) => ref === existing)!;
      if (registered.displayName !== subject.displayName) {
        throw new Error(`authorized subject display mismatch: ${subject.type}/${subject.id}`);
      }
      return existing;
    }
    const ref = `subject-${subjects.length}`;
    subjectRefs.set(identity, ref);
    subjects.push({ ref, ...subject });
    return ref;
  };

  const registerEvidence = (item: Evidence): string => {
    const identity = JSON.stringify([item.source, item.reference]);
    const existing = evidenceRefs.get(identity);
    if (existing) return existing;
    const ref = `evidence-${evidence.length}`;
    evidenceRefs.set(identity, ref);
    evidence.push({ ref, ...item });
    return ref;
  };

  const registerFact = (fact: Fact): string => {
    if (fact.disclosure === "allowed" && fact.subject === null) {
      throw new Error(`disclosable fact ${fact.key} requires a subject`);
    }
    const ref = `fact-${facts.length}`;
    facts.push({
      ref,
      key: fact.key,
      value: snapshotFactValue(fact.value),
      subjectRef: registerSubject(fact.subject),
      evidenceRef: registerEvidence(fact.evidence),
      disclosure: fact.disclosure,
    });
    return ref;
  };

  for (const [resultIndex, result] of canonicalResults.entries()) {
    assertActionResultMatchesOutcomeSchema(schema, result);
    const resultOptions = "options" in result ? result.options : undefined;
    if (result.semanticClass === "options_found") {
      if (!resultOptions || resultOptions.length === 0) {
        throw new Error("options_found requires at least one option");
      }
      const optionIds = resultOptions.map(({ id }) => id);
      if (new Set(optionIds).size !== optionIds.length) {
        throw new Error("duplicate option id");
      }
      if (resultOptions.some(({ facts: optionFacts }) => optionFacts.length === 0)) {
        throw new Error("option requires at least one fact");
      }
    } else if (resultOptions !== undefined) {
      throw new Error("options are only valid for options_found");
    }

    const outcomeSubjectRef = registerSubject(result.subject);
    const outcomeEvidenceRefs = result.evidence.map(registerEvidence);
    const outcomeFactRefs = result.facts.map(registerFact);
    const optionRefs = (resultOptions ?? []).map((option) => {
      const ref = `option-${options.length}`;
      options.push({
        ref,
        id: option.id,
        subjectRef: registerSubject(option.subject)!,
        factRefs: option.facts.map(registerFact),
      });
      return ref;
    });

    outcomes.push({
      ref: `outcome-${resultIndex}`,
      outcomeType: result.type,
      semanticClass: result.semanticClass,
      origin: result.origin,
      subjectRef: outcomeSubjectRef,
      evidenceRefs: outcomeEvidenceRefs,
      factRefs: outcomeFactRefs,
      optionRefs,
    });
  }

  return freezeAndRegisterPlan({
    version: V2_AUTHORIZED_RESPONSE_PLAN_VERSION,
    outcomes,
    options,
    facts,
    subjects,
    evidence,
  });
}
