import type { Channel } from "@/domain/value-objects/channel";

export type MediaType = "image" | "video" | "audio" | "document";

export type IncomingChannelMessage = {
  channel: Channel;
  externalContactId: string;
  externalThreadId: string | null;
  externalMessageId: string;
  name: string | null;
  phone: string | null;
  whatsappLid: string | null;
  email: string | null;
  body: string;
  mediaUrl?: string | null;
  mediaType?: MediaType | null;
  receivedAt: Date;
  campaignId: string | null;
};

export type OutgoingChannelMessage = {
  channel: Channel;
  externalThreadId: string;
  body: string;
  mediaUrl?: string;
  mediaType?: MediaType;
  mediaCaption?: string;
};

export type ChannelAdapter = {
  receive(payload: unknown): Promise<IncomingChannelMessage>;
  send(message: OutgoingChannelMessage): Promise<void>;
};

