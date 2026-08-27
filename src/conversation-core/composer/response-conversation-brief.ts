import type { DialogueMove } from "@/conversation-core/understanding/schema";

export type ResponseConversationBrief = Readonly<{
  request: string | null;
  dialogueMove: DialogueMove;
  sentiment: "negative" | "neutral" | "positive" | null;
  purchaseIntent: "low" | "medium" | "high" | null;
  priceSensitivity: "low" | "medium" | "high" | null;
  hasObjection: boolean;
  ambiguityKind: string | null;
}>;

export const EMPTY_RESPONSE_CONVERSATION_BRIEF: ResponseConversationBrief = Object.freeze({
  request: null,
  dialogueMove: "new_topic",
  sentiment: null,
  purchaseIntent: null,
  priceSensitivity: null,
  hasObjection: false,
  ambiguityKind: null,
});
