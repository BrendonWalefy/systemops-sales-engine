import type { IntentType } from "@/core/intelligence/IntentClassifier";
import type { TtsConfig } from "@/domain/entities/tts-config";

export type OutboundDeliveryPart =
  | { type: "text"; content: string }
  | {
      type: "media";
      mediaId: string;
      url: string;
      mediaType: "video" | "image";
      title: string;
      caption?: string;
    };

export type PipelineAdvance =
  | { action: "advance"; nextStepIndex: number }
  | { action: "exit" };

export type ConversationOutboundPayload = {
  version: 1;
  kind: "conversation_reply";
  to: string;
  agentMessageId: string;
  replyText: string;
  intent: IntentType | null;
  useVoice: boolean;
  ttsConfig: TtsConfig;
  interleavedParts: OutboundDeliveryPart[];
  mediaParts: OutboundDeliveryPart[];
  leadId: string;
  pipelineAdvance: PipelineAdvance | null;
};

export function isConversationOutboundPayload(
  payload: unknown,
): payload is ConversationOutboundPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return (
    value.version === 1 &&
    value.kind === "conversation_reply" &&
    typeof value.to === "string" &&
    typeof value.agentMessageId === "string" &&
    typeof value.replyText === "string" &&
    typeof value.useVoice === "boolean" &&
    Array.isArray(value.interleavedParts) &&
    Array.isArray(value.mediaParts) &&
    typeof value.leadId === "string"
  );
}
