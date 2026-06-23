import type { RecordInboundEventInput } from "@/application/ports/inbound-event-store";
import type { ZApiInboundPayload } from "./zapi-channel-adapter";

export function buildZApiInboundEvent(params: {
  clinicId: string;
  payload: ZApiInboundPayload;
  now?: Date;
}): RecordInboundEventInput {
  const { clinicId, payload } = params;
  return {
    clinicId,
    provider: "z_api",
    providerMessageId: payload.messageId,
    conversationKey: payload.chatLid?.trim() || payload.phone,
    payload,
    normalizedText: resolveNormalizedText(payload),
    mediaType: resolveMediaType(payload),
    dedupeKey: `z-api:${payload.instanceId}:${payload.messageId}`,
    receivedAt: payload.momment ? new Date(payload.momment) : (params.now ?? new Date()),
  };
}

function resolveNormalizedText(payload: ZApiInboundPayload): string | null {
  const text = payload.text?.message ?? payload.image?.caption ?? payload.video?.caption;
  const normalized = text?.trim();
  return normalized || null;
}

function resolveMediaType(payload: ZApiInboundPayload): string | null {
  if (payload.audio?.audioUrl) return "audio";
  if (payload.image?.imageUrl) return "image";
  if (payload.video?.videoUrl) return "video";
  if (payload.document?.documentUrl) return "document";
  if (payload.sticker?.stickerUrl) return "sticker";
  if (payload.reaction || payload.reactionText || payload.emoji) return "reaction";
  return null;
}
