export const UNDERSTANDING_VERSION = "understanding.v1" as const;

export type DialogueMove =
  | "new_topic"
  | "answers_pending"
  | "acknowledges"
  | "repeats"
  | "closes";

export type Understanding<Request extends string = string> = {
  version: typeof UNDERSTANDING_VERSION;
  request: Request | null;
  dialogueMove: DialogueMove;
  entities: Readonly<Record<string, string | number | readonly string[] | null>>;
  signals: Readonly<Record<string, boolean | number | string | null>>;
  safety: Readonly<Record<string, boolean>>;
  confidence: number;
  ambiguity: null | { kind: string; candidates: readonly string[] };
};
