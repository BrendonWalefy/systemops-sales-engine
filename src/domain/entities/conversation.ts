import type { Channel } from "../value-objects/channel";

export type MessageAuthor = "lead" | "clinic_user" | "agent" | "system";

export type Message = {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  body: string;
  sentAt: Date;
  externalId: string | null;
};

export type Conversation = {
  id: string;
  clinicId: string;
  leadId: string;
  channel: Channel;
  externalThreadId: string | null;
  summary: string | null;
  aiPaused: boolean;
  needsAttention: boolean;
  attentionReason: string | null;
  consecutiveUnclearCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

