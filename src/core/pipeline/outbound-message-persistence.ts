import type { Message } from "@/domain/entities/conversation";
import type { IntentType } from "@/core/intelligence/IntentClassifier";
import type { OutboundPart } from "@/infrastructure/adapters/channels/whatsapp/outbound-delivery-service";

export function buildAgentMessageFromOutboundPart(params: {
  id: string;
  conversationId: string;
  part: OutboundPart;
  sentAt: Date;
  intent: IntentType | null;
  externalId?: string | null;
  deliveryFormat?: "text" | "audio" | null;
}): Message {
  const baseMessage = {
    id: params.id,
    conversationId: params.conversationId,
    author: "agent" as const,
    sentAt: params.sentAt,
    externalId: params.externalId ?? null,
    intent: params.intent,
    deliveryFormat: params.deliveryFormat ?? null,
  };

  if (params.part.type === "text") {
    return {
      ...baseMessage,
      body: params.part.content,
      mediaUrl: null,
      mediaType: null,
    };
  }

  return {
    ...baseMessage,
    body: params.part.title,
    mediaUrl: params.part.url,
    mediaType: params.part.mediaType,
    deliveryFormat: params.deliveryFormat ?? "text",
  };
}

export function buildInitialAgentMessage(params: {
  id: string;
  conversationId: string;
  replyText: string;
  sentAt: Date;
  intent: IntentType | null;
  hasInterleavedMedia: boolean;
  outboundParts: OutboundPart[];
}): Message {
  if (params.hasInterleavedMedia && params.outboundParts.length > 0) {
    return buildAgentMessageFromOutboundPart({
      id: params.id,
      conversationId: params.conversationId,
      part: params.outboundParts[0],
      sentAt: params.sentAt,
      intent: params.intent,
    });
  }

  return {
    id: params.id,
    conversationId: params.conversationId,
    author: "agent",
    body: params.replyText,
    mediaUrl: null,
    mediaType: null,
    sentAt: params.sentAt,
    externalId: null,
    intent: params.intent,
    deliveryFormat: null,
  };
}
