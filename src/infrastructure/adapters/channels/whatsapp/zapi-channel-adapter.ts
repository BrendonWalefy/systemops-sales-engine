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
  sticker?: { stickerUrl: string; mimeType: string };
  reaction?: { emoji?: string; reaction?: string; text?: string; message?: string };
  reactionText?: string;
  emoji?: string;
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
      senderPhoto: data.senderPhoto ?? null,
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

// Erros 5xx ou de rede são transientes — vale 1 retry com backoff curto.
// Erros 4xx (payload inválido, credenciais, URL inacessível) são permanentes — não retentar.
function isTransientZApiError(status: number): boolean {
  return status >= 500 || status === 429;
}

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

  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/${endpoint}`;
  const requestBody = JSON.stringify(payload);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1_500));

    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers, body: requestBody });
    } catch (networkErr) {
      lastError = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      console.warn(`[ZApi] send-${mediaType} erro de rede (tentativa ${attempt + 1}/2):`, lastError.message);
      continue;
    }

    if (!response.ok) {
      const error = await response.text();
      if (!isTransientZApiError(response.status)) {
        throw new Error(`Z-API send-${mediaType} failed (${response.status}): ${error}`);
      }
      lastError = new Error(`Z-API send-${mediaType} failed (${response.status}): ${error}`);
      console.warn(`[ZApi] send-${mediaType} erro transiente ${response.status} (tentativa ${attempt + 1}/2) — retentando`);
      continue;
    }

    try {
      const data = await response.json() as { messageId?: string; zaapId?: string };
      return data.messageId ?? data.zaapId ?? null;
    } catch {
      return null;
    }
  }

  throw lastError ?? new Error(`Z-API send-${mediaType} falhou após 2 tentativas`);
}

// Status de entrega de uma mensagem já aceita pela Z-API.
// O ACK do POST de envio significa "na fila" — mídia enviada por URL ainda será
// baixada pela Z-API antes de chegar ao WhatsApp. Este endpoint permite saber
// quando a mensagem realmente saiu, viabilizando entrega ordenada.
//
// "delivered"   → SENT/RECEIVED/READ/PLAYED — já saiu da fila, próxima parte pode ir
// "pending"     → ainda na fila da Z-API — aguardar
// "unsupported" → endpoint indisponível ou resposta irreconhecível — não insistir
export type ZApiDeliveryStatus = "delivered" | "pending" | "unsupported";
export type ZApiInstanceStatus = {
  connected?: boolean;
  smartphoneConnected?: boolean;
  error?: string;
};

const ZAPI_DELIVERED_STATUSES = new Set(["SENT", "RECEIVED", "READ", "PLAYED", "DELIVERED", "VIEWED"]);
const ZAPI_PENDING_STATUSES = new Set(["PENDING", "QUEUED", "WAITING", "PROCESSING"]);

export async function getZApiMessageDeliveryStatus(
  messageId: string,
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<ZApiDeliveryStatus> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;
  if (!instanceId || !token) return "unsupported";

  const headers: Record<string, string> = {};
  if (clientToken) headers["Client-Token"] = clientToken;

  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/message-status/${encodeURIComponent(messageId)}`,
      { method: "GET", headers, signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) return "unsupported";

    const data = (await response.json()) as { status?: unknown } | { status?: unknown }[] | null;
    const rawStatus = Array.isArray(data) ? data.at(-1)?.status : data?.status;
    if (typeof rawStatus !== "string") return "unsupported";

    const status = rawStatus.toUpperCase();
    if (ZAPI_DELIVERED_STATUSES.has(status)) return "delivered";
    if (ZAPI_PENDING_STATUSES.has(status)) return "pending";
    return "unsupported";
  } catch {
    return "unsupported";
  }
}

export async function getZApiInstanceStatus(
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<ZApiInstanceStatus> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;
  if (!instanceId || !token) {
    return { connected: false, smartphoneConnected: false, error: "Missing instanceId or token" };
  }

  const headers: Record<string, string> = {};
  if (clientToken) headers["Client-Token"] = clientToken;

  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/status`,
      { method: "GET", headers, signal: AbortSignal.timeout(5_000) },
    );

    const text = await response.text();
    if (!response.ok) {
      return {
        connected: false,
        smartphoneConnected: false,
        error: text || `HTTP ${response.status}`,
      };
    }

    try {
      const data = JSON.parse(text) as ZApiInstanceStatus;
      return data;
    } catch {
      return { connected: false, smartphoneConnected: false, error: "Invalid Z-API status response" };
    }
  } catch (error) {
    return {
      connected: false,
      smartphoneConnected: false,
      error: error instanceof Error ? error.message : "Unknown Z-API status error",
    };
  }
}

function resolveZApiMedia(data: ZApiInboundPayload): { mediaUrl: string | null; mediaType: MediaType | null } {
  if (data.audio) return { mediaUrl: data.audio.audioUrl, mediaType: "audio" };
  if (data.image) return { mediaUrl: data.image.imageUrl, mediaType: "image" };
  if (data.video) return { mediaUrl: data.video.videoUrl, mediaType: "video" };
  if (data.document) return { mediaUrl: data.document.documentUrl, mediaType: "document" };
  return { mediaUrl: null, mediaType: null };
}
