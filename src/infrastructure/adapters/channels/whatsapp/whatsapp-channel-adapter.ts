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
    void message;
    throw new Error("WhatsApp send adapter not implemented yet");
  }
}
