export type Subject = { type: string; id: string };

export type Evidence = {
  source: "policy" | "read" | "write" | "derived";
  reference: string;
};

export type Fact = {
  key: string;
  value: string | number | boolean;
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
  | { kind: "offer"; options: readonly Option[]; nextBestStep: NextStep | null }
  | { kind: "execute"; action: PendingAction; nextBestStep: NextStep | null }
  | { kind: "escalate"; reason: string }
  | { kind: "close" }
  | { kind: "suppress"; reason: string };

export type OutcomeSemanticClass =
  | "information_authorized"
  | "options_found"
  | "effect_completed"
  | "effect_failed"
  | "human_action_required"
  | "clarification_required";

export type ActionResultOption = {
  id: string;
  subject: Subject;
  facts: readonly Fact[];
};

type ActionResultBase<OutcomeType extends string> = {
  type: OutcomeType;
  semanticClass: OutcomeSemanticClass;
  origin: { capabilityId: string };
  subject: Subject | null;
  evidence: readonly Evidence[];
  facts: readonly Fact[];
};

export type ActionResult<OutcomeType extends string = string> =
  | (ActionResultBase<OutcomeType> & {
      semanticClass: "options_found";
      options: readonly ActionResultOption[];
    })
  | (ActionResultBase<OutcomeType> & {
      semanticClass: Exclude<OutcomeSemanticClass, "options_found">;
      options?: never;
    });
