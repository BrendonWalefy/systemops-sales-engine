import type { Conversation, Message } from "../entities/conversation";

export type ConversationRepository = {
  findByLeadId(leadId: string): Promise<Conversation | null>;
  saveConversation(conversation: Conversation): Promise<void>;
  setAiPaused(conversationId: string, paused: boolean): Promise<void>;
  setTakeover(conversationId: string, expiresAt: Date | null): Promise<void>;
  appendMessage(message: Message): Promise<void>;
  listMessages(conversationId: string): Promise<Message[]>;
};

