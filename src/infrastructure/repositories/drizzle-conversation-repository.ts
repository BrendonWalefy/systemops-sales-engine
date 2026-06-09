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
        target: conversations.leadId,
        set: {
          externalThreadId: conversation.externalThreadId,
          summary: conversation.summary,
          lastMessageAt: conversation.lastMessageAt,
          updatedAt: conversation.updatedAt,
        },
      });
  }

  async setAiPaused(conversationId: string, paused: boolean): Promise<void> {
    await db
      .update(conversations)
      .set({ aiPaused: paused, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  async setTakeover(conversationId: string, expiresAt: Date | null): Promise<void> {
    await db
      .update(conversations)
      .set({ aiPaused: expiresAt !== null, takeoverExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  async appendMessage(message: Message): Promise<void> {
    try {
      await db
        .insert(messages)
        .values({
          id: message.id,
          conversationId: message.conversationId,
          author: message.author,
          body: message.body,
          mediaUrl: message.mediaUrl ?? null,
          mediaType: message.mediaType ?? null,
          sentAt: message.sentAt,
          externalId: message.externalId,
          intent: message.intent ?? null,
          deliveryFormat: message.deliveryFormat ?? null,
        })
        .onConflictDoNothing();
    } catch (err) {
      // Código 23503 = foreign_key_violation no PostgreSQL.
      // Ocorre quando a conversa foi deletada concorrentemente (ex: reset E2E)
      // enquanto o Orchestrator ainda estava processando. Ignorar é seguro aqui.
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23503") {
        console.warn("[appendMessage] FK violation — conversa deletada concorrentemente:", message.conversationId);
        return;
      }
      throw err;
    }
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
    aiPaused: row.aiPaused,
    takeoverExpiresAt: row.takeoverExpiresAt,
    needsAttention: row.needsAttention,
    attentionReason: row.attentionReason,
    consecutiveUnclearCount: row.consecutiveUnclearCount,
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
    mediaUrl: row.mediaUrl ?? null,
    mediaType: (row.mediaType as Message["mediaType"]) ?? null,
    sentAt: row.sentAt,
    externalId: row.externalId,
    intent: row.intent ?? null,
    deliveryFormat: (row.deliveryFormat as Message["deliveryFormat"]) ?? null,
  };
}
