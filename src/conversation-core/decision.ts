export type Fact = {
  key: string;
  value: string | number | boolean;
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

export type ActionResult = {
  type: string;
  facts: readonly Fact[];
};
