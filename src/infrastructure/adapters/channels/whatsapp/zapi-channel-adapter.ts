import type {
  ChannelAdapter,
  IncomingChannelMessage,
  OutgoingChannelMessage,
} from "@/application/ports/channel-adapter";

/**
 * Z-API webhook payload (text message)
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
  audio?: {
    audioUrl: string;
    mimeType: string;
    seconds?: number;
  };
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

    return {
      channel: "whatsapp",
      externalContactId: data.phone,
      externalThreadId: data.phone,
      externalMessageId: data.messageId,
      name: data.senderName || null,
      phone: data.phone,
      whatsappLid: data.chatLid ?? null,
      email: null,
      body: data.text?.message ?? "",
      receivedAt: data.momment ? new Date(data.momment) : new Date(),
      campaignId: null,
    };
  }

  async send(message: OutgoingChannelMessage): Promise<void> {
    await sendZApiTextMessage(message.externalThreadId, message.body, this.creds);
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
