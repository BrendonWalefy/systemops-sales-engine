import type { Channel } from "@/domain/value-objects/channel";

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
  receivedAt: Date;
  campaignId: string | null;
};

export type OutgoingChannelMessage = {
  channel: Channel;
  externalThreadId: string;
  body: string;
};

export type ChannelAdapter = {
  receive(payload: unknown): Promise<IncomingChannelMessage>;
  send(message: OutgoingChannelMessage): Promise<void>;
};

