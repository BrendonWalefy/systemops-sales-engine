import type {
  ChannelAdapter,
  IncomingChannelMessage,
  OutgoingChannelMessage,
} from "@/application/ports/channel-adapter";

export class WhatsAppChannelAdapter implements ChannelAdapter {
  async receive(payload: unknown): Promise<IncomingChannelMessage> {
    const data = payload as Record<string, unknown>;

    return {
      channel: "whatsapp",
      externalContactId: String(data.from ?? ""),
      externalThreadId: data.threadId ? String(data.threadId) : null,
      externalMessageId: String(data.messageId ?? ""),
      name: data.name ? String(data.name) : null,
      phone: data.phone ? String(data.phone) : String(data.from ?? ""),
      email: null,
      body: String(data.body ?? ""),
      receivedAt: data.receivedAt ? new Date(String(data.receivedAt)) : new Date(),
      campaignId: data.campaignId ? String(data.campaignId) : null,
    };
  }

  async send(message: OutgoingChannelMessage): Promise<void> {
    await sendWhatsAppTextMessage(message.externalThreadId, message.body);
  }
}

export async function sendWhatsAppTextMessage(
  to: string,
  text: string,
  creds?: { phoneNumberId: string; accessToken: string },
): Promise<string | null> {
  const accessToken = creds?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = creds?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set");
  }

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${error}`);
  }

  return null; // Meta Cloud API messageId not needed for fromMe deduplication
}
