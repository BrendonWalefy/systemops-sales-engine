import type { Channel } from "../value-objects/channel";
import type { ConversationCategory } from "../value-objects/conversation-category";

export type MessageAuthor = "lead" | "clinic_user" | "agent" | "system";

export type MediaType = "image" | "video" | "audio" | "document";

export type Message = {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  body: string;
  mediaUrl?: string | null;
  mediaType?: MediaType | null;
  sentAt: Date;
  externalId: string | null;
  intent?: string | null;
  deliveryFormat?: "text" | "audio" | null;
  /** true quando composta em shadow mode: nunca foi enviada de verdade ao lead. */
  simulated?: boolean;
};

export type Conversation = {
  id: string;
  clinicId: string;
  leadId: string;
  channel: Channel;
  category: ConversationCategory;
  externalThreadId: string | null;
  summary: string | null;
  aiPaused: boolean;
  takeoverExpiresAt: Date | null;
  needsAttention: boolean;
  attentionReason: string | null;
  consecutiveUnclearCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
