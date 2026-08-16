import type {
  ActionResult,
  Evidence,
  Fact,
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

export type V2AuthorizedResponsePlan<OutcomeType extends string = string> = {
  version: typeof V2_AUTHORIZED_RESPONSE_PLAN_VERSION;
  outcomes: readonly AuthorizedOutcome<OutcomeType>[];
  options: readonly AuthorizedOption[];
  facts: readonly AuthorizedFact[];
  subjects: readonly AuthorizedSubject[];
  evidence: readonly AuthorizedEvidence[];
};

export function snapshotV2AuthorizedResponsePlan<OutcomeType extends string>(
  plan: V2AuthorizedResponsePlan<OutcomeType>,
): V2AuthorizedResponsePlan<OutcomeType> {
  return Object.freeze({
    version: plan.version,
    subjects: Object.freeze(plan.subjects.map((subject) => Object.freeze({ ...subject }))),
    evidence: Object.freeze(plan.evidence.map((item) => Object.freeze({ ...item }))),
    facts: Object.freeze(plan.facts.map((fact) => Object.freeze({ ...fact }))),
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
  });
}

export function buildV2AuthorizedResponsePlan<Schema extends OutcomeSchema>(
  schema: Schema,
  actionResults: readonly ActionResult<Schema>[],
): V2AuthorizedResponsePlan<OutcomeTypeOf<Schema>> {
  const subjects: AuthorizedSubject[] = [];
  const evidence: AuthorizedEvidence[] = [];
  const facts: AuthorizedFact[] = [];
  const options: AuthorizedOption[] = [];
  const outcomes: AuthorizedOutcome<OutcomeTypeOf<Schema>>[] = [];
  const subjectRefs = new Map<string, string>();
  const evidenceRefs = new Map<string, string>();

  const registerSubject = (subject: Subject | null): string | null => {
    if (!subject) return null;
    const identity = JSON.stringify([subject.type, subject.id]);
    const existing = subjectRefs.get(identity);
    if (existing) return existing;
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
      value: fact.value,
      subjectRef: registerSubject(fact.subject),
      evidenceRef: registerEvidence(fact.evidence),
      disclosure: fact.disclosure,
    });
    return ref;
  };

  for (const [resultIndex, result] of actionResults.entries()) {
    assertActionResultMatchesOutcomeSchema(schema, result);
    const resultOptions = "options" in result ? result.options : undefined;
    if (result.semanticClass === "options_found") {
      if (!resultOptions || resultOptions.length === 0) {
        throw new Error("options_found requires at least one option");
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

  return {
    version: V2_AUTHORIZED_RESPONSE_PLAN_VERSION,
    outcomes,
    options,
    facts,
    subjects,
    evidence,
  };
}
