import type { Channel } from "@/domain/value-objects/channel";

export type OutboundMessageDeliveryKind = "text" | "audio" | "image" | "video" | "document";
export type OutboundMessageCategory =
  | "reply"
  | "follow_up"
  | "reminder"
  | "recovery"
  | "campaign"
  | "operational";

export type OutboundMessageStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "dead"
  | "cancelled";

export type OutboundMessage = {
  id: string;
  clinicId: string;
  conversationId: string;
  channel: Channel;
  payload: unknown;
  deliveryKind: OutboundMessageDeliveryKind;
  category: OutboundMessageCategory;
  sequence: number;
  status: OutboundMessageStatus;
  providerMessageId: string | null;
  dedupeKey: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

export type CreateOutboundMessageInput = {
  clinicId: string;
  conversationId: string;
  channel: Channel;
  payload: unknown;
  deliveryKind: OutboundMessageDeliveryKind;
  category?: OutboundMessageCategory;
  dedupeKey?: string | null;
};

export type CreateOutboundMessageResult = {
  message: OutboundMessage;
  isNew: boolean;
};

export type MarkOutboundDeliveredInput = {
  id: string;
  providerMessageId: string | null;
  sentAt?: Date;
};

export type OutboundMessageStore = {
  createOutboundMessage(input: CreateOutboundMessageInput): Promise<CreateOutboundMessageResult>;
  findOutboundMessage(id: string): Promise<OutboundMessage | null>;
  hasEarlierActiveMessage(message: OutboundMessage): Promise<boolean>;
  markOutboundProcessing(id: string): Promise<boolean>;
  markOutboundPending(id: string, error: string): Promise<void>;
  markOutboundDelivered(input: MarkOutboundDeliveredInput): Promise<void>;
  markOutboundFailed(id: string, error: string): Promise<void>;
  markOutboundDead(id: string, error: string): Promise<void>;
  markOutboundCancelled(id: string, error: string): Promise<void>;
  countSentSince(input: { clinicId: string; since: Date }): Promise<number>;
};
