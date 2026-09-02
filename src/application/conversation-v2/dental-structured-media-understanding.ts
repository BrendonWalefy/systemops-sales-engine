import {
  UNDERSTANDING_VERSION,
  type Understanding,
} from "@/conversation-core/understanding/schema";
import type { ConversationStateRow } from "@/core/conversation/ConversationStateMachine";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const entities = Object.freeze({
  service: null,
  businessInformationTopic: null,
  date: null,
  period: null,
  time: null,
  professional: null,
  serviceCandidates: null,
  faqQuestion: null,
  quantity: null,
  quantityScope: null,
  objectionQuestion: null,
  ordinal: null,
});
const signals = Object.freeze({
  purchaseIntent: null,
  priceSensitivity: null,
  sentiment: null,
  objection: null,
});
const safety = Object.freeze({
  optOut: false,
  requestsHuman: false,
  emergency: false,
});

function structured(request: DentalRequest): Understanding<DentalRequest> {
  return Object.freeze({
    version: UNDERSTANDING_VERSION,
    request,
    dialogueMove: "answers_pending" as const,
    entities,
    signals,
    safety,
    confidence: 1,
    ambiguity: null,
  });
}

export function resolveDentalStructuredMediaUnderstanding(input: Readonly<{
  mediaType: string | null | undefined;
  state: Readonly<ConversationStateRow> | null;
}>): Understanding<DentalRequest> | null {
  if (
    input.state?.state === "awaiting_deposit_proof"
    && (input.mediaType === "image" || input.mediaType === "document")
  ) {
    return structured("submit-deposit-proof");
  }
  if (
    input.state?.state === "treatment_pipeline_active"
    && (input.mediaType === "image" || input.mediaType === "video")
  ) {
    return structured("submit-journey-media");
  }
  return null;
}
