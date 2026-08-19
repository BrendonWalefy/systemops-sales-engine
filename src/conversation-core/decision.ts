export type Subject = { type: string; id: string; displayName: string };

export type Evidence = {
  source: "policy" | "read" | "write" | "derived";
  reference: string;
};

export type FactValue =
  | { kind: "display_text"; value: string }
  | { kind: "integer"; value: number }
  | { kind: "money"; amountInMinor: number; currency: "BRL" }
  | { kind: "boolean"; value: boolean };

export type Fact = {
  key: string;
  value: FactValue;
  subject: Subject | null;
  evidence: Evidence;
  disclosure: "allowed" | "internal";
};

export type Option = {
  id: string;
  facts: readonly Fact[];
};

export type PendingAction = {
  type: string;
  parameters: Readonly<Record<string, string | number | boolean>>;
};

export type NextStep = {
  id: string;
  repeatPolicy: "once_until_answered" | "every_turn" | "never_repeat";
};

export type Decision =
  | { kind: "answer"; facts: readonly Fact[]; nextBestStep: NextStep | null }
  | { kind: "ask"; questionId: string }
  | { kind: "offer"; subject: Subject; options: readonly Option[]; nextBestStep: NextStep | null }
  | { kind: "execute"; action: PendingAction; nextBestStep: NextStep | null }
  | { kind: "escalate"; reason: string }
  | { kind: "close" }
  | { kind: "suppress"; reason: string };

/**
 * Vocabulário fechado das classes semânticas de outcome.
 *
 * Fonte única: o tipo, a validação de schema e a validação de action result
 * derivam desta lista. Quando ela existia copiada em três lugares, acrescentar
 * uma classe compilava e só falhava em runtime, no meio do turno.
 */
export const OUTCOME_SEMANTIC_CLASSES = Object.freeze([
  "information_authorized",
  "options_found",
  "effect_completed",
  "effect_failed",
  "human_action_required",
  "clarification_required",
  // Turno social ou fora do escopo transacional: o sistema não tem fato a
  // informar nem dado a confirmar, e convidar o lead a dizer o que precisa é a
  // única resposta verdadeira disponível.
  "engagement_invited",
] as const);

export type OutcomeSemanticClass = typeof OUTCOME_SEMANTIC_CLASSES[number];

export type OutcomeDefinition = Readonly<{
  semanticClass: OutcomeSemanticClass;
  subjectRequirement: "required" | "optional" | "forbidden";
  evidenceRequirement: "required" | "write_required" | "optional";
}>;

export type OutcomeDefinitions = Readonly<Record<string, OutcomeDefinition>>;

declare const validatedOutcomeSchema: unique symbol;
export type OutcomeSchema<
  Definitions extends OutcomeDefinitions = OutcomeDefinitions,
> = Readonly<Definitions> & { readonly [validatedOutcomeSchema]: true };

const outcomeSchemas = new WeakSet<object>();

const semanticClasses: ReadonlySet<string> = new Set<string>(OUTCOME_SEMANTIC_CLASSES);
const subjectRequirements: ReadonlySet<string> = new Set([
  "required", "optional", "forbidden",
]);
const evidenceRequirements: ReadonlySet<string> = new Set([
  "required", "write_required", "optional",
]);

export function defineOutcomeSchema<const Definitions extends OutcomeDefinitions>(
  definitions: Definitions,
): OutcomeSchema<Definitions> {
  const entries = Object.entries(definitions);
  if (entries.length === 0) throw new Error("outcome schema must not be empty");
  const snapshot: Record<string, OutcomeDefinition> = {};
  for (const [type, definition] of entries) {
    if (typeof definition !== "object" || definition === null) {
      throw new Error(`invalid outcome schema definition: ${type}`);
    }
    const semanticClass: unknown = definition.semanticClass;
    const subjectRequirement: unknown = definition.subjectRequirement;
    const evidenceRequirement: unknown = definition.evidenceRequirement;
    if (
      type.length === 0 ||
      typeof semanticClass !== "string" ||
      typeof subjectRequirement !== "string" ||
      typeof evidenceRequirement !== "string" ||
      !semanticClasses.has(semanticClass) ||
      !subjectRequirements.has(subjectRequirement) ||
      !evidenceRequirements.has(evidenceRequirement)
    ) {
      throw new Error(`invalid outcome schema definition: ${type}`);
    }
    snapshot[type] = Object.freeze({
      semanticClass: semanticClass as OutcomeSemanticClass,
      subjectRequirement: subjectRequirement as OutcomeDefinition["subjectRequirement"],
      evidenceRequirement: evidenceRequirement as OutcomeDefinition["evidenceRequirement"],
    });
  }
  const schema = Object.freeze(snapshot) as OutcomeSchema<Definitions>;
  outcomeSchemas.add(schema);
  return schema;
}

export function assertOutcomeSchema(
  schema: OutcomeSchema,
): void {
  if (!outcomeSchemas.has(schema)) throw new Error("outcome schema was not registered");
}

export type OutcomeTypeOf<Schema extends OutcomeSchema> = Extract<keyof Schema, string>;

export type ActionResultOption = {
  id: string;
  subject: Subject;
  facts: readonly Fact[];
};

type SubjectFor<Definition extends OutcomeDefinition> =
  Definition["subjectRequirement"] extends "required"
    ? Subject
    : Definition["subjectRequirement"] extends "forbidden"
      ? null
      : Subject | null;

type EvidenceFor<Definition extends OutcomeDefinition> =
  Definition["evidenceRequirement"] extends "write_required"
    ? readonly [Evidence & { source: "write" }, ...Evidence[]]
    : Definition["evidenceRequirement"] extends "required"
      ? readonly [Evidence, ...Evidence[]]
      : readonly Evidence[];

type ActionResultBase<
  OutcomeType extends string,
  Definition extends OutcomeDefinition,
> = {
  type: OutcomeType;
  semanticClass: Definition["semanticClass"];
  origin: { capabilityId: string };
  subject: SubjectFor<Definition>;
  evidence: EvidenceFor<Definition>;
  facts: readonly Fact[];
};

type OptionsFor<SemanticClass extends OutcomeSemanticClass> =
  SemanticClass extends "options_found"
    ? { options: readonly [ActionResultOption, ...ActionResultOption[]] }
    : { options?: never };

type ActionResultForDefinition<
  OutcomeType extends string,
  Definition extends OutcomeDefinition,
> = ActionResultBase<OutcomeType, Definition> &
  OptionsFor<Definition["semanticClass"]>;

export type ActionResult<Schema extends OutcomeSchema> = {
  [OutcomeType in OutcomeTypeOf<Schema>]: Schema[OutcomeType] extends OutcomeDefinition
    ? ActionResultForDefinition<OutcomeType, Schema[OutcomeType]>
    : never;
}[OutcomeTypeOf<Schema>];

export function assertActionResultMatchesOutcomeSchema<Schema extends OutcomeSchema>(
  schema: Schema,
  result: ActionResult<Schema>,
): void {
  assertOutcomeSchema(schema);
  const definition: OutcomeDefinition | undefined = schema[result.type];
  if (!definition || result.semanticClass !== definition.semanticClass) {
    throw new Error(`outcome schema mismatch: ${String(result.type)}`);
  }
  if (definition.subjectRequirement === "required" && result.subject === null) {
    throw new Error(`outcome schema subject required: ${String(result.type)}`);
  }
  if (definition.subjectRequirement === "forbidden" && result.subject !== null) {
    throw new Error(`outcome schema subject forbidden: ${String(result.type)}`);
  }
  if (
    definition.evidenceRequirement === "required" &&
    result.evidence.length === 0
  ) {
    throw new Error(`outcome schema evidence required: ${String(result.type)}`);
  }
  if (
    definition.evidenceRequirement === "write_required" &&
    !result.evidence.some(({ source }) => source === "write")
  ) {
    throw new Error(`outcome schema write evidence required: ${String(result.type)}`);
  }
  const options = "options" in result ? result.options : undefined;
  if (definition.semanticClass === "options_found") {
    if (!options || options.length === 0) {
      throw new Error(`outcome schema options required: ${String(result.type)}`);
    }
  } else if (options !== undefined) {
    throw new Error(`outcome schema options forbidden: ${String(result.type)}`);
  }
}
