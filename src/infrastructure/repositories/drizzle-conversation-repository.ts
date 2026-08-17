import { and, asc, desc, eq, gte, or } from "drizzle-orm";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import { db } from "@/infrastructure/db/client";
import { isPostgresErrorCode } from "@/infrastructure/db/is-postgres-error-code";
import { conversations, leads, messages } from "@/infrastructure/db/schema";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";

export class DrizzleConversationRepository implements ConversationRepository {
  async findByLeadId(leadId: string): Promise<Conversation | null> {
    const row = await db.query.conversations.findFirst({
      where: eq(conversations.leadId, leadId),
    });
    return row ? mapConversationRow(row) : null;
  }

  async findMessageById(id: string): Promise<Message | null> {
    const [row] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .limit(1);
    return row ? mapMessageRow(row) : null;
  }

  async findMessageByExternalId(externalId: string): Promise<Message | null> {
    const [row] = await db
      .select()
      .from(messages)
      .where(eq(messages.externalId, externalId))
      .limit(1);
    return row ? mapMessageRow(row) : null;
  }

  async findRecentLeadMessageByIdentityAndContent(input: {
    clinicId: string;
    phone: string | null;
    whatsappLid: string | null;
    fallbackPhone: string;
    body: string;
    sentAtOrAfter: Date;
  }): Promise<Message | null> {
    const identityMatch = input.phone
      ? input.whatsappLid
        ? or(
            eq(leads.phone, input.phone),
            eq(leads.whatsappLid, input.whatsappLid),
            eq(leads.phone, input.whatsappLid),
          )
        : eq(leads.phone, input.phone)
      : input.whatsappLid
        ? or(
            eq(leads.whatsappLid, input.whatsappLid),
            eq(leads.phone, input.whatsappLid),
          )
        : eq(leads.phone, input.fallbackPhone);
    const [row] = await db
      .select({ message: messages })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(
        and(
          eq(leads.clinicId, input.clinicId),
          identityMatch,
          eq(messages.author, "lead"),
          eq(messages.body, input.body),
          gte(messages.sentAt, input.sentAtOrAfter),
        ),
      )
      .limit(1);
    return row ? mapMessageRow(row.message) : null;
  }

  async ensureConversation(conversation: Conversation): Promise<Conversation> {
    const existing = await this.findByLeadId(conversation.leadId);
    if (existing) return existing;

    const [inserted] = await db
      .insert(conversations)
      .values({
        id: conversation.id,
        clinicId: conversation.clinicId,
        leadId: conversation.leadId,
        channel: conversation.channel,
        category: conversation.category,
        externalThreadId: conversation.externalThreadId,
        summary: conversation.summary,
        lastMessageAt: conversation.lastMessageAt,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      bumpInboxVersion(conversation.clinicId);
      return mapConversationRow(inserted);
    }

    const raced = await this.findByLeadId(conversation.leadId);
    if (!raced) {
      throw new Error("ensureConversation: insert conflicted without a persisted conversation");
    }
    return raced;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await db
      .insert(conversations)
      .values({
        id: conversation.id,
        clinicId: conversation.clinicId,
        leadId: conversation.leadId,
        channel: conversation.channel,
        category: conversation.category,
        externalThreadId: conversation.externalThreadId,
        summary: conversation.summary,
        lastMessageAt: conversation.lastMessageAt,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      })
      .onConflictDoUpdate({
        target: conversations.leadId,
        set: {
          category: conversation.category,
          externalThreadId: conversation.externalThreadId,
          summary: conversation.summary,
          lastMessageAt: conversation.lastMessageAt,
          updatedAt: conversation.updatedAt,
        },
      });
    bumpInboxVersion(conversation.clinicId);
  }

  async setAiPaused(conversationId: string, paused: boolean): Promise<void> {
    const [updated] = await db
      .update(conversations)
      .set({ aiPaused: paused, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning({ clinicId: conversations.clinicId });
    if (updated) bumpInboxVersion(updated.clinicId);
  }

  async setTakeover(conversationId: string, expiresAt: Date | null): Promise<void> {
    const [updated] = await db
      .update(conversations)
      .set({ aiPaused: expiresAt !== null, takeoverExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning({ clinicId: conversations.clinicId });
    if (updated) bumpInboxVersion(updated.clinicId);
  }

  async appendMessage(message: Message): Promise<boolean> {
    try {
      const [inserted] = await db
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
          simulated: message.simulated ?? false,
        })
        .onConflictDoNothing()
        .returning({ id: messages.id });
      if (!inserted) return false;

      const [updated] = await db
        .update(conversations)
        .set(
          message.author === "lead"
            ? { lastMessageAt: message.sentAt, updatedAt: new Date() }
            : { updatedAt: new Date() },
        )
        .where(eq(conversations.id, message.conversationId))
        .returning({ clinicId: conversations.clinicId });
      if (updated) bumpInboxVersion(updated.clinicId);
      return true;
    } catch (err) {
      // Código 23503 = foreign_key_violation no PostgreSQL.
      // Ocorre quando a conversa foi deletada concorrentemente (ex: reset E2E)
      // enquanto o Orchestrator ainda estava processando. Ignorar é seguro aqui.
      if (isPostgresErrorCode(err, "23503")) {
        console.warn("[appendMessage] FK violation — conversa deletada concorrentemente:", message.conversationId);
        return false;
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

  async findLatestLeadMessage(conversationId: string): Promise<Message | null> {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.sentAt))
      .limit(10);
    const row = rows.find((r) => r.author === "lead");
    return row ? mapMessageRow(row) : null;
  }
}

function mapConversationRow(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    clinicId: row.clinicId,
    leadId: row.leadId,
    channel: row.channel,
    category: row.category,
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
