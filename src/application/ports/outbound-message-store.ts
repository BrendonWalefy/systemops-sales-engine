import type { Channel } from "@/domain/value-objects/channel";
import type { LiveOutboundPreflightResult } from "@/application/ports/live-outbound-preflight";

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

export type NonLiveOutboundAuthorizationKind =
  | "follow_up"
  | "reminder"
  | "campaign"
  | "human_manual"
  | "operational"
  | "system"
  | "recovery"
  | "legacy";

export type OutboundAuthorizationKind =
  | "live_stream_reply"
  | NonLiveOutboundAuthorizationKind;

export type OutboundAuthorizationInput =
  | Readonly<{
      kind: "live_stream_reply";
      streamId: string;
      streamGeneration: number;
      sourceInboundEventId: string;
      claimJobId: string;
      claimToken: string;
    }>
  | Readonly<{ kind: NonLiveOutboundAuthorizationKind }>;

export type PersistedOutboundAuthorization = Readonly<{
  kind: OutboundAuthorizationKind | null;
  streamId: string | null;
  streamGeneration: number | null;
  sourceInboundEventId: string | null;
  claimJobId: string | null;
  claimTokenDigest: string | null;
  authorityVersion: number | null;
}>;

export type OutboundSendAuthorizationResult = LiveOutboundPreflightResult;

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
  authorization: PersistedOutboundAuthorization;
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
  authorization: OutboundAuthorizationInput;
};

export type CreateOutboundMessageResult = {
  message: OutboundMessage;
  isNew: boolean;
};

export type CreateOutboundMessageAndEnqueueResult = {
  outboundMessageId: string;
  messageWasNew: boolean;
  jobWasNew: boolean;
};

export type MarkOutboundDeliveredInput = {
  id: string;
  providerMessageId: string | null;
  sentAt?: Date;
};

export type OutboundMessageStore = {
  createOutboundMessage(input: CreateOutboundMessageInput): Promise<CreateOutboundMessageResult>;
  /** Atomic outbox + message.send job creation for durable implementations. */
  createOutboundMessageAndEnqueue?(
    input: CreateOutboundMessageInput,
    options?: { turnId?: string | null },
  ): Promise<CreateOutboundMessageAndEnqueueResult>;
  findOutboundMessage(id: string): Promise<OutboundMessage | null>;
  authorizeOutboundMessageForSend(id: string): Promise<OutboundSendAuthorizationResult>;
  findConversationReplyByTurnId(input: {
    clinicId: string;
    turnId: string;
  }): Promise<OutboundMessage | null>;
  hasEarlierActiveMessage(message: OutboundMessage): Promise<boolean>;
  markOutboundProcessing(id: string): Promise<boolean>;
  markOutboundPending(id: string, error: string): Promise<void>;
  markOutboundDelivered(input: MarkOutboundDeliveredInput): Promise<void>;
  markOutboundFailed(id: string, error: string): Promise<void>;
  markOutboundDead(id: string, error: string): Promise<void>;
  markOutboundCancelled(id: string, error: string): Promise<void>;
  countSentSince(input: { clinicId: string; since: Date }): Promise<number>;
};
