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
  /** Correlaciona ingress → decisão → outbox → entrega. Opcional para payloads legados. */
  turnId?: string;
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

export type AutomationOutboundPayload = {
  version: 1;
  kind: "automation";
  to: string;
  text: string;
  leadId: string;
  conversationId: string;
  agentMessageId: string;
  useVoice?: boolean;
  ttsConfig?: TtsConfig;
  // Anexos pré-resolvidos (url/tipo já materializados no enqueue). Enviados
  // após o texto, em ordem. Ausente/vazio = só texto (comportamento atual).
  // Usado pela régua de pós-atendimento (cuidados = texto + imagens + vídeo).
  mediaParts?: OutboundDeliveryPart[];
};

export type OutboundPayload = ConversationOutboundPayload | AutomationOutboundPayload;

export function isConversationOutboundPayload(
  payload: unknown,
): payload is ConversationOutboundPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return (
    value.version === 1 &&
    value.kind === "conversation_reply" &&
    (value.turnId === undefined || typeof value.turnId === "string") &&
    typeof value.to === "string" &&
    typeof value.agentMessageId === "string" &&
    typeof value.replyText === "string" &&
    typeof value.useVoice === "boolean" &&
    Array.isArray(value.interleavedParts) &&
    Array.isArray(value.mediaParts) &&
    typeof value.leadId === "string"
  );
}

export function isAutomationOutboundPayload(
  payload: unknown,
): payload is AutomationOutboundPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return (
    value.version === 1 &&
    value.kind === "automation" &&
    typeof value.to === "string" &&
    typeof value.text === "string" &&
    typeof value.leadId === "string" &&
    typeof value.conversationId === "string" &&
    typeof value.agentMessageId === "string"
  );
}

export function isOutboundPayload(payload: unknown): payload is OutboundPayload {
  return isConversationOutboundPayload(payload) || isAutomationOutboundPayload(payload);
}
