import { eq, asc } from "drizzle-orm";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import { db } from "@/infrastructure/db/client";
import { conversations, messages } from "@/infrastructure/db/schema";

export class DrizzleConversationRepository implements ConversationRepository {
  async findByLeadId(leadId: string): Promise<Conversation | null> {
    const row = await db.query.conversations.findFirst({
      where: eq(conversations.leadId, leadId),
    });
    return row ? mapConversationRow(row) : null;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await db
      .insert(conversations)
      .values({
        id: conversation.id,
        clinicId: conversation.clinicId,
        leadId: conversation.leadId,
        channel: conversation.channel,
        externalThreadId: conversation.externalThreadId,
        summary: conversation.summary,
        lastMessageAt: conversation.lastMessageAt,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      })
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          externalThreadId: conversation.externalThreadId,
          summary: conversation.summary,
          lastMessageAt: conversation.lastMessageAt,
          updatedAt: conversation.updatedAt,
        },
      });
  }

  async appendMessage(message: Message): Promise<void> {
    await db
      .insert(messages)
      .values({
        id: message.id,
        conversationId: message.conversationId,
        author: message.author,
        body: message.body,
        sentAt: message.sentAt,
        externalId: message.externalId,
      })
      .onConflictDoNothing();
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.sentAt));
    return rows.map(mapMessageRow);
  }
}

function mapConversationRow(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    clinicId: row.clinicId,
    leadId: row.leadId,
    channel: row.channel,
    externalThreadId: row.externalThreadId,
    summary: row.summary,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMessageRow(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    author: row.author,
    body: row.body,
    sentAt: row.sentAt,
    externalId: row.externalId,
  };
}
