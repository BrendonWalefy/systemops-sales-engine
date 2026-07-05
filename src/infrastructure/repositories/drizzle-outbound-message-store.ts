import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type {
  CreateOutboundMessageInput,
  CreateOutboundMessageResult,
  MarkOutboundDeliveredInput,
  OutboundMessage,
  OutboundMessageStore,
} from "@/application/ports/outbound-message-store";
import { db } from "@/infrastructure/db/client";
import { conversations, outboundMessages } from "@/infrastructure/db/schema";

export class DrizzleOutboundMessageStore implements OutboundMessageStore {
  async createOutboundMessage(
    input: CreateOutboundMessageInput,
  ): Promise<CreateOutboundMessageResult> {
    if (input.dedupeKey) {
      const [existing] = await db
        .select()
        .from(outboundMessages)
        .where(
          and(
            eq(outboundMessages.conversationId, input.conversationId),
            eq(outboundMessages.dedupeKey, input.dedupeKey),
          ),
        )
        .limit(1);
      if (existing) return { message: mapOutboundMessage(existing), isNew: false };
    }

    // A single-row UPDATE reserves an order even with concurrent workers. A
    // gap after a failed insert is harmless; reordering is not.
    const [conversation] = await db
      .update(conversations)
      .set({ nextOutboundSequence: sql`${conversations.nextOutboundSequence} + 1` })
      .where(eq(conversations.id, input.conversationId))
      .returning({ nextOutboundSequence: conversations.nextOutboundSequence });
    if (!conversation) {
      throw new Error(`Conversation not found for outbound message: ${input.conversationId}`);
    }

    const [created] = await db
      .insert(outboundMessages)
      .values({
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        channel: input.channel,
        payload: input.payload,
        deliveryKind: input.deliveryKind,
        category: input.category ?? "reply",
        sequence: conversation.nextOutboundSequence,
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing({
        target: [outboundMessages.conversationId, outboundMessages.dedupeKey],
      })
      .returning();

    if (created) return { message: mapOutboundMessage(created), isNew: true };

    if (!input.dedupeKey) {
      throw new Error("Outbound insert did not return a row without a dedupe key");
    }

    const [existing] = await db
      .select()
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.conversationId, input.conversationId),
          eq(outboundMessages.dedupeKey, input.dedupeKey),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Outbound insert conflicted without an existing message");
    }

    return { message: mapOutboundMessage(existing), isNew: false };
  }

  async findOutboundMessage(id: string): Promise<OutboundMessage | null> {
    const [message] = await db
      .select()
      .from(outboundMessages)
      .where(eq(outboundMessages.id, id))
      .limit(1);
    return message ? mapOutboundMessage(message) : null;
  }

  async hasEarlierActiveMessage(message: OutboundMessage): Promise<boolean> {
    const [earlier] = await db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.conversationId, message.conversationId),
          lt(outboundMessages.sequence, message.sequence),
          inArray(outboundMessages.status, ["pending", "processing"]),
        ),
      )
      .limit(1);
    return Boolean(earlier);
  }

  async markOutboundProcessing(id: string): Promise<boolean> {
    const rows = await db
      .update(outboundMessages)
      .set({
        status: "processing",
        attempts: sql`${outboundMessages.attempts} + 1`,
      })
      .where(and(eq(outboundMessages.id, id), eq(outboundMessages.status, "pending")))
      .returning({ id: outboundMessages.id });
    return rows.length > 0;
  }

  async markOutboundPending(id: string, error: string): Promise<void> {
    await db
      .update(outboundMessages)
      .set({ status: "pending", lastError: error })
      .where(and(eq(outboundMessages.id, id), eq(outboundMessages.status, "processing")));
  }

  async markOutboundDelivered(input: MarkOutboundDeliveredInput): Promise<void> {
    await db
      .update(outboundMessages)
      .set({
        status: "sent",
        providerMessageId: input.providerMessageId,
        sentAt: input.sentAt ?? new Date(),
        lastError: null,
      })
      .where(eq(outboundMessages.id, input.id));
  }

  async markOutboundFailed(id: string, error: string): Promise<void> {
    await db
      .update(outboundMessages)
      .set({ status: "failed", lastError: error })
      .where(eq(outboundMessages.id, id));
  }

  async markOutboundDead(id: string, error: string): Promise<void> {
    await db
      .update(outboundMessages)
      .set({ status: "dead", lastError: error })
      .where(eq(outboundMessages.id, id));
  }

  async markOutboundCancelled(id: string, error: string): Promise<void> {
    await db
      .update(outboundMessages)
      .set({ status: "cancelled", lastError: error })
      .where(eq(outboundMessages.id, id));
  }

  async countSentSince(input: { clinicId: string; since: Date }): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.clinicId, input.clinicId),
          eq(outboundMessages.status, "sent"),
          gte(outboundMessages.sentAt, input.since),
        ),
      );
    return row?.value ?? 0;
  }
}

function mapOutboundMessage(row: typeof outboundMessages.$inferSelect): OutboundMessage {
  return {
    id: row.id,
    clinicId: row.clinicId,
    conversationId: row.conversationId,
    channel: row.channel,
    payload: row.payload,
    deliveryKind: row.deliveryKind,
    category: row.category,
    sequence: row.sequence,
    status: row.status,
    providerMessageId: row.providerMessageId,
    dedupeKey: row.dedupeKey,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}
