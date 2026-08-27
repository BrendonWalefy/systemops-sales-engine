import type { ResponseConversationBrief } from "@/conversation-core/composer/response-conversation-brief";
import type { DialogueMove, Understanding } from "@/conversation-core/understanding/schema";
import { DENTAL_REQUESTS, type DentalRequest } from "@/domain-packs/dental/vocabulary";

const DIALOGUE_MOVES = new Set<DialogueMove>([
  "new_topic",
  "answers_pending",
  "acknowledges",
  "repeats",
  "closes",
]);
const DENTAL_REQUEST_SET = new Set<string>(DENTAL_REQUESTS);
const INTENT_LEVELS = new Set(["low", "medium", "high"]);
const SENTIMENTS = new Set(["negative", "neutral", "positive"]);
const AMBIGUITY_KINDS = new Set(["service"]);
type IntentLevel = NonNullable<ResponseConversationBrief["purchaseIntent"]>;
type Sentiment = NonNullable<ResponseConversationBrief["sentiment"]>;

function closedValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
): T | null {
  return typeof value === "string" && allowed.has(value) ? value as T : null;
}

export function buildDentalResponseConversationBrief(
  understanding: Understanding<DentalRequest>,
): ResponseConversationBrief {
  return Object.freeze({
    request: closedValue<DentalRequest>(understanding.request, DENTAL_REQUEST_SET),
    dialogueMove: closedValue<DialogueMove>(understanding.dialogueMove, DIALOGUE_MOVES)
      ?? "new_topic",
    sentiment: closedValue<Sentiment>(
      understanding.signals.sentiment,
      SENTIMENTS,
    ),
    purchaseIntent: closedValue<IntentLevel>(
      understanding.signals.purchaseIntent,
      INTENT_LEVELS,
    ),
    priceSensitivity: closedValue<IntentLevel>(
      understanding.signals.priceSensitivity,
      INTENT_LEVELS,
    ),
    hasObjection: typeof understanding.signals.objection === "string"
      && understanding.signals.objection.trim().length > 0,
    ambiguityKind: closedValue<string>(
      understanding.ambiguity?.kind,
      AMBIGUITY_KINDS,
    ),
  });
}
