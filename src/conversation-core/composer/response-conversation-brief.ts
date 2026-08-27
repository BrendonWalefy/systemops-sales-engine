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
