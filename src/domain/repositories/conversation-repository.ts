import type { Conversation, Message } from "../entities/conversation";

export type ConversationRepository = {
  findByLeadId(leadId: string): Promise<Conversation | null>;
  findMessageByExternalId(externalId: string): Promise<Message | null>;
  findRecentLeadMessageByIdentityAndContent(input: {
    clinicId: string;
    phone: string | null;
    whatsappLid: string | null;
    fallbackPhone: string;
    body: string;
    sentAtOrAfter: Date;
  }): Promise<Message | null>;
  /** Inserts the identity row if absent; never updates an existing conversation. */
  ensureConversation(conversation: Conversation): Promise<Conversation>;
  saveConversation(conversation: Conversation): Promise<void>;
  setAiPaused(conversationId: string, paused: boolean): Promise<void>;
  setTakeover(conversationId: string, expiresAt: Date | null): Promise<void>;
  /** Returns true only for the row that won the durable insert. */
  appendMessage(message: Message): Promise<boolean>;
  listMessages(conversationId: string): Promise<Message[]>;
};
