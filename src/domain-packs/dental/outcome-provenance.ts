import type { Decision } from "@/conversation-core/decision";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalOutcomeType,
} from "@/domain-packs/dental/capabilities";

export type DentalCapabilityId =
  | "dental-explanation"
  | "dental-catalog"
  | "dental-scheduling"
  | "dental-escalation"
  | "dental-reception";

export type DentalExecuteAction = "book_slot" | "confirm_appointment";

type DentalOutcomeDefinition<Type extends DentalOutcomeType = DentalOutcomeType> =
  Readonly<{
    type: Type;
    semanticClass: (typeof DENTAL_OUTCOME_SCHEMA)[Type]["semanticClass"];
    subjectRequirement: (typeof DENTAL_OUTCOME_SCHEMA)[Type]["subjectRequirement"];
    evidenceRequirement: (typeof DENTAL_OUTCOME_SCHEMA)[Type]["evidenceRequirement"];
  }>;

type NonExecuteRule = Readonly<{
  capabilityId: DentalCapabilityId;
  decisionKind: Exclude<Decision["kind"], "execute">;
  outcomes: readonly DentalOutcomeDefinition[];
}>;

type ExecuteRule = Readonly<{
  capabilityId: DentalCapabilityId;
  decisionKind: "execute";
  decisionActionType: string;
  action: DentalExecuteAction;
  outcomes: readonly DentalOutcomeDefinition[];
}>;

type DentalOutcomeProvenanceRule = NonExecuteRule | ExecuteRule;

function outcome<const Type extends DentalOutcomeType>(
  type: Type,
): DentalOutcomeDefinition<Type> {
  const definition = DENTAL_OUTCOME_SCHEMA[type];
  return Object.freeze({
    type,
    semanticClass: definition.semanticClass,
    subjectRequirement: definition.subjectRequirement,
    evidenceRequirement: definition.evidenceRequirement,
  }) as DentalOutcomeDefinition<Type>;
}

const provenanceRules = [
  {
    capabilityId: "dental-explanation",
    decisionKind: "answer",
    outcomes: [outcome("service_explained")],
  },
  {
    capabilityId: "dental-explanation",
    decisionKind: "ask",
    outcomes: [outcome("clarification_required")],
  },
  {
    capabilityId: "dental-reception",
    decisionKind: "ask",
    outcomes: [outcome("reception_answered")],
  },
  {
    capabilityId: "dental-catalog",
    decisionKind: "answer",
    outcomes: [outcome("catalog_answered")],
  },
  {
    capabilityId: "dental-catalog",
    decisionKind: "ask",
    outcomes: [outcome("clarification_required")],
  },
  {
    capabilityId: "dental-catalog",
    decisionKind: "escalate",
    outcomes: [outcome("escalation_required")],
  },
  {
    capabilityId: "dental-scheduling",
    decisionKind: "ask",
    outcomes: [outcome("clarification_required")],
  },
  {
    capabilityId: "dental-scheduling",
    decisionKind: "offer",
    outcomes: [outcome("slots_found")],
  },
  {
    capabilityId: "dental-scheduling",
    decisionKind: "execute",
    decisionActionType: "book-slot",
    action: "book_slot",
    outcomes: [
      outcome("appointment_created"),
      outcome("appointment_create_failed"),
      outcome("scheduling_failed"),
    ],
  },
  {
    capabilityId: "dental-scheduling",
    decisionKind: "execute",
    decisionActionType: "confirm-appointment",
    action: "confirm_appointment",
    outcomes: [
      outcome("appointment_confirmed"),
      outcome("appointment_confirmation_failed"),
      outcome("scheduling_failed"),
    ],
  },
  {
    capabilityId: "dental-escalation",
    decisionKind: "escalate",
    outcomes: [outcome("escalation_required")],
  },
] as const satisfies readonly DentalOutcomeProvenanceRule[];

for (const rule of provenanceRules) {
  Object.freeze(rule.outcomes);
  Object.freeze(rule);
}

/**
 * The single domain-owned source for productive Dental Pack provenance.
 * Each mapped outcome carries its canonical semantic, subject and evidence
 * requirements from the registered outcome schema. This table drives both
 * the exported TypeScript unions and runtime tuple validation.
 */
export const DENTAL_OUTCOME_PROVENANCE = Object.freeze(provenanceRules);

type ProvenanceRule = (typeof DENTAL_OUTCOME_PROVENANCE)[number];

type DecisionIdentityForRule<Rule extends ProvenanceRule> =
  Rule extends Readonly<{
    capabilityId: infer CapabilityId;
    decisionKind: "execute";
    action: infer Action;
  }>
    ? Readonly<{
        capabilityId: CapabilityId;
        decisionKind: "execute";
        action: Action;
      }>
    : Rule extends Readonly<{
          capabilityId: infer CapabilityId;
          decisionKind: infer DecisionKind;
        }>
      ? Readonly<{
          capabilityId: CapabilityId;
          decisionKind: DecisionKind;
        }>
      : never;

export type DentalDecisionProvenanceIdentity =
  ProvenanceRule extends infer Rule
    ? Rule extends ProvenanceRule
      ? DecisionIdentityForRule<Rule>
      : never
    : never;

export type DentalExecuteDecisionIdentity = Extract<
  DentalDecisionProvenanceIdentity,
  { decisionKind: "execute" }
>;

type SummaryForRule<Rule extends ProvenanceRule> =
  Rule["outcomes"][number] extends infer Outcome extends DentalOutcomeDefinition
    ? Outcome extends DentalOutcomeDefinition
      ? DecisionIdentityForRule<Rule> & Readonly<{
          type: Outcome["type"];
          semanticClass: Outcome["semanticClass"];
        }>
      : never
    : never;

export type DentalOutcomeStructuralSummary =
  ProvenanceRule extends infer Rule
    ? Rule extends ProvenanceRule
      ? SummaryForRule<Rule>
      : never
    : never;

function ruleMatchesDecision(
  rule: ProvenanceRule,
  capabilityId: string,
  decision: Decision,
): boolean {
  return rule.capabilityId === capabilityId
    && rule.decisionKind === decision.kind
    && (rule.decisionKind !== "execute"
      || (decision.kind === "execute"
        && rule.decisionActionType === decision.action.type));
}

export function dentalDecisionProvenanceIdentity(input: Readonly<{
  capabilityId: string;
  decision: Decision;
}>): DentalDecisionProvenanceIdentity | null {
  const rule = DENTAL_OUTCOME_PROVENANCE.find((candidate) =>
    ruleMatchesDecision(candidate, input.capabilityId, input.decision));
  if (!rule) return null;
  return rule.decisionKind === "execute"
    ? Object.freeze({
        capabilityId: rule.capabilityId,
        decisionKind: "execute",
        action: rule.action,
      })
    : Object.freeze({
        capabilityId: rule.capabilityId,
        decisionKind: rule.decisionKind,
      }) as DentalDecisionProvenanceIdentity;
}

function hasExactStringKeys(
  value: object,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expectedKeys.length
    && keys.every((key) => typeof key === "string" && expectedKeys.includes(key));
}

function identityMatchesRule(
  rule: ProvenanceRule,
  identity: Readonly<Record<string, unknown>>,
): boolean {
  return rule.capabilityId === identity.capabilityId
    && rule.decisionKind === identity.decisionKind
    && (rule.decisionKind !== "execute" || rule.action === identity.action);
}

export function isDentalExecuteDecisionIdentity(
  value: unknown,
): value is DentalExecuteDecisionIdentity {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || !hasExactStringKeys(value, ["capabilityId", "decisionKind", "action"])
  ) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return DENTAL_OUTCOME_PROVENANCE.some((rule) =>
    rule.decisionKind === "execute" && identityMatchesRule(rule, record));
}

export function isDentalOutcomeStructuralSummary(
  value: unknown,
): value is DentalOutcomeStructuralSummary {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) return false;
  const record = value as Readonly<Record<string, unknown>>;
  const execute = record.decisionKind === "execute";
  if (!hasExactStringKeys(
    value,
    execute
      ? ["capabilityId", "decisionKind", "action", "type", "semanticClass"]
      : ["capabilityId", "decisionKind", "type", "semanticClass"],
  )) return false;
  const rule = DENTAL_OUTCOME_PROVENANCE.find((candidate) =>
    identityMatchesRule(candidate, record));
  if (!rule) return false;
  const definition = rule.outcomes.find((candidate) => candidate.type === record.type);
  return definition?.semanticClass === record.semanticClass;
}

export function dentalOutcomeStructuralSummary(input: Readonly<{
  capabilityId: string;
  decision: Decision;
  outcome: Readonly<{
    type: DentalOutcomeType;
    semanticClass: (typeof DENTAL_OUTCOME_SCHEMA)[DentalOutcomeType]["semanticClass"];
    origin: Readonly<{ capabilityId: string }>;
  }>;
}>): DentalOutcomeStructuralSummary {
  if (input.outcome.origin.capabilityId !== input.capabilityId) {
    throw new Error("dental outcome owner does not match prepared decision provenance");
  }
  const identity = dentalDecisionProvenanceIdentity(input);
  if (!identity) throw new Error("unknown dental decision provenance identity");
  const candidate = {
    ...identity,
    type: input.outcome.type,
    semanticClass: input.outcome.semanticClass,
  };
  if (!isDentalOutcomeStructuralSummary(candidate)) {
    throw new Error("dental outcome does not match capability decision provenance");
  }
  return Object.freeze(candidate);
}
