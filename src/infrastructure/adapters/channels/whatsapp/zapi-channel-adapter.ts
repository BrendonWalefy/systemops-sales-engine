import type {
  ChannelAdapter,
  IncomingChannelMessage,
  MediaType,
  OutgoingChannelMessage,
} from "@/application/ports/channel-adapter";

/**
 * Z-API webhook payload
 * Docs: https://developer.z-api.io/webhooks/on-message-received
 */
export type ZApiInboundPayload = {
  phone: string;
  chatLid?: string | null;
  instanceId: string;
  messageId: string;
  momment: number; // Z-API typo — kept as-is
  status: string;
  chatName: string;
  senderName: string;
  senderPhoto?: string;
  text?: { message: string };
  audio?: { audioUrl: string; mimeType: string; seconds?: number };
  image?: { imageUrl: string; caption?: string; mimeType: string };
  video?: { videoUrl: string; caption?: string; mimeType: string };
  document?: { documentUrl: string; fileName: string; mimeType: string };
  isGroupMsg: boolean;
  isStatusReply: boolean;
  isEdit: boolean;
  fromMe: boolean;
};

export class ZApiChannelAdapter implements ChannelAdapter {
  constructor(
    private readonly creds: { instanceId: string; token: string; clientToken?: string },
  ) {}

  async receive(payload: unknown): Promise<IncomingChannelMessage> {
    const data = payload as ZApiInboundPayload;
    const { mediaUrl, mediaType } = resolveZApiMedia(data);

    return {
      channel: "whatsapp",
      externalContactId: data.phone,
      externalThreadId: data.phone,
      externalMessageId: data.messageId,
      name: data.senderName || null,
      phone: data.phone,
      whatsappLid: data.chatLid ?? null,
      email: null,
      body: data.text?.message ?? data.image?.caption ?? data.video?.caption ?? "",
      mediaUrl,
      mediaType,
      receivedAt: data.momment ? new Date(data.momment) : new Date(),
      campaignId: null,
    };
  }

  async send(message: OutgoingChannelMessage): Promise<void> {
    if (message.mediaUrl && message.mediaType) {
      await sendZApiMediaMessage(message.externalThreadId, message.mediaUrl, message.mediaType, this.creds, message.mediaCaption);
    } else {
      await sendZApiTextMessage(message.externalThreadId, message.body, this.creds);
    }
  }
}

export async function sendZApiTextMessage(
  phone: string,
  text: string,
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<string | null> {
  const instanceId = creds.instanceId;
  const token = creds.token;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http")
    ? rawClientToken
    : undefined;

  if (!instanceId || !token) {
    throw new Error("Z-API instance ID and token must be configured for this clinic");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (clientToken) headers["Client-Token"] = clientToken;

  const response = await fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, message: text }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Z-API send failed (${response.status}): ${error}`);
  }

  // Z-API returns { zaapId, messageId } — messageId matches the webhook fromMe payload
  try {
    const data = await response.json() as { messageId?: string; zaapId?: string };
    return data.messageId ?? data.zaapId ?? null;
  } catch {
    return null;
  }
}

const ZAPI_MEDIA_ENDPOINT: Record<string, string> = {
  audio: "send-audio",
  image: "send-image",
  video: "send-video",
  document: "send-document",
};

const ZAPI_MEDIA_BODY_KEY: Record<string, string> = {
  audio: "audio",
  image: "image",
  video: "video",
  document: "document",
};

export async function sendZApiMediaMessage(
  phone: string,
  mediaUrl: string,
  mediaType: MediaType,
  creds: { instanceId: string; token: string; clientToken?: string },
  caption?: string,
): Promise<string | null> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;

  if (!instanceId || !token) {
    throw new Error("Z-API instance ID and token must be configured for this clinic");
  }

  const endpoint = ZAPI_MEDIA_ENDPOINT[mediaType];
  const bodyKey = ZAPI_MEDIA_BODY_KEY[mediaType];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientToken) headers["Client-Token"] = clientToken;

  const payload: Record<string, unknown> = { phone, [bodyKey]: mediaUrl };
  if (caption) payload.caption = caption;
  if (mediaType === "document" && caption) payload.fileName = caption;

  const response = await fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/${endpoint}`,
    { method: "POST", headers, body: JSON.stringify(payload) },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Z-API send-${mediaType} failed (${response.status}): ${error}`);
  }

  try {
    const data = await response.json() as { messageId?: string; zaapId?: string };
    return data.messageId ?? data.zaapId ?? null;
  } catch {
    return null;
  }
}

function resolveZApiMedia(data: ZApiInboundPayload): { mediaUrl: string | null; mediaType: MediaType | null } {
  if (data.audio) return { mediaUrl: data.audio.audioUrl, mediaType: "audio" };
  if (data.image) return { mediaUrl: data.image.imageUrl, mediaType: "image" };
  if (data.video) return { mediaUrl: data.video.videoUrl, mediaType: "video" };
  if (data.document) return { mediaUrl: data.document.documentUrl, mediaType: "document" };
  return { mediaUrl: null, mediaType: null };
}
