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
  | {
      action: "advance";
      nextStepIndex: number;
      expectedTreatmentId?: string;
      expectedStepIndex?: number;
    }
  | {
      action: "exit";
      expectedTreatmentId?: string;
      expectedStepIndex?: number;
    };

type ConversationOutboundPayloadBase = {
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
  postDeliveryControl?: {
    kind: "attention" | "handoff";
    reason:
      | "v2_deposit_proof_review_required"
      | "v2_journey_photo_review_required";
  } | null;
};

export type ConversationOutboundPayload = ConversationOutboundPayloadBase & Readonly<{
  /** V2 live delegates the idempotent Inbox placeholder to the existing sender. */
  agentMessagePersistence?: "sender";
}>;

const conversationPayloadKeys = new Set([
  "version", "kind", "turnId", "to", "agentMessageId",
  "agentMessagePersistence", "replyText", "intent",
  "useVoice", "ttsConfig", "interleavedParts", "mediaParts", "leadId",
  "pipelineAdvance",
  "postDeliveryControl",
]);
const postDeliveryControlKeys = new Set(["kind", "reason"]);

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

export type ProactiveOutboundAuthorizationKind =
  | "follow_up"
  | "reminder"
  | "campaign"
  | "recovery"
  | "operational";

export type AutomationOutboundPayload = {
  version: 1;
  kind: "automation";
  /** Present on every V2-produced automation; absent only on legacy queued payloads. */
  authorizationKind?: ProactiveOutboundAuthorizationKind;
  /** Correlates producer, outbox, preflight and delivery without carrying message content. */
  turnId?: string;
  /** V2 producers delegate canonical history persistence to the authorized sender. */
  agentMessagePersistence?: "sender";
  to: string;
  text: string;
  leadId: string;
  conversationId: string;
  agentMessageId: string;
  intent?: string | null;
  useVoice?: boolean;
  ttsConfig?: TtsConfig;
  // Anexos pré-resolvidos (url/tipo já materializados no enqueue). Enviados
  // após o texto, em ordem. Ausente/vazio = só texto (comportamento atual).
  // Usado pela régua de pós-atendimento (cuidados = texto + imagens + vídeo).
  mediaParts?: OutboundDeliveryPart[];
};

export type V2ProactiveAutomationOutboundPayload = AutomationOutboundPayload & Readonly<{
  authorizationKind: ProactiveOutboundAuthorizationKind;
  turnId: string;
  agentMessagePersistence: "sender";
}>;

export type OperatorOutboundPayload = {
  version: 1;
  kind: "operator_message";
  to: string;
  operatorMessageId: string;
  text: string;
  attachment?: {
    url: string;
    mediaType: "image" | "video" | "audio" | "document";
    fileName: string;
  };
};

export type OutboundPayload =
  | ConversationOutboundPayload
  | AutomationOutboundPayload
  | OperatorOutboundPayload;

export function isConversationOutboundPayload(
  payload: unknown,
): payload is ConversationOutboundPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return (
    hasOnlyKeys(value, conversationPayloadKeys) &&
    value.version === 1 &&
    value.kind === "conversation_reply" &&
    (value.turnId === undefined || typeof value.turnId === "string") &&
    typeof value.to === "string" &&
    typeof value.agentMessageId === "string" &&
    (value.agentMessagePersistence === undefined || value.agentMessagePersistence === "sender") &&
    typeof value.replyText === "string" &&
    typeof value.useVoice === "boolean" &&
    Array.isArray(value.interleavedParts) &&
    Array.isArray(value.mediaParts) &&
    typeof value.leadId === "string" &&
    (
      value.postDeliveryControl === undefined ||
      value.postDeliveryControl === null ||
      (
        typeof value.postDeliveryControl === "object" &&
        hasOnlyKeys(
          value.postDeliveryControl as Record<string, unknown>,
          postDeliveryControlKeys,
        ) &&
        ["attention", "handoff"].includes(String(
          (value.postDeliveryControl as Record<string, unknown>).kind,
        )) &&
        [
          "v2_deposit_proof_review_required",
          "v2_journey_photo_review_required",
        ].includes(String(
          (value.postDeliveryControl as Record<string, unknown>).reason,
        ))
      )
    )
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

export function isV2ProactiveAutomationOutboundPayload(
  payload: unknown,
): payload is V2ProactiveAutomationOutboundPayload {
  if (!isAutomationOutboundPayload(payload)) return false;
  return (
    typeof payload.turnId === "string" &&
    payload.turnId.length > 0 &&
    payload.agentMessagePersistence === "sender" &&
    ["follow_up", "reminder", "campaign", "recovery", "operational"].includes(
      String(payload.authorizationKind),
    )
  );
}

export function isOperatorOutboundPayload(
  payload: unknown,
): payload is OperatorOutboundPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  if (
    value.version !== 1 ||
    value.kind !== "operator_message" ||
    typeof value.to !== "string" ||
    typeof value.operatorMessageId !== "string" ||
    typeof value.text !== "string"
  ) {
    return false;
  }
  if (value.attachment === undefined) return true;
  if (!value.attachment || typeof value.attachment !== "object") return false;
  const attachment = value.attachment as Record<string, unknown>;
  return (
    typeof attachment.url === "string" &&
    typeof attachment.fileName === "string" &&
    ["image", "video", "audio", "document"].includes(String(attachment.mediaType))
  );
}

export function isOutboundPayload(payload: unknown): payload is OutboundPayload {
  return isConversationOutboundPayload(payload)
    || isAutomationOutboundPayload(payload)
    || isOperatorOutboundPayload(payload);
}
