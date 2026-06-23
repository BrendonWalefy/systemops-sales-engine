import { and, eq, sql } from "drizzle-orm";
import type {
  CreateOutboundMessageInput,
  CreateOutboundMessageResult,
  MarkOutboundDeliveredInput,
  OutboundMessage,
  OutboundMessageStore,
} from "@/application/ports/outbound-message-store";
import { db } from "@/infrastructure/db/client";
import { outboundMessages } from "@/infrastructure/db/schema";

export class DrizzleOutboundMessageStore implements OutboundMessageStore {
  async createOutboundMessage(
    input: CreateOutboundMessageInput,
  ): Promise<CreateOutboundMessageResult> {
    const [created] = await db
      .insert(outboundMessages)
      .values({
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        channel: input.channel,
        payload: input.payload,
        deliveryKind: input.deliveryKind,
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
}

function mapOutboundMessage(row: typeof outboundMessages.$inferSelect): OutboundMessage {
  return {
    id: row.id,
    clinicId: row.clinicId,
    conversationId: row.conversationId,
    channel: row.channel,
    payload: row.payload,
    deliveryKind: row.deliveryKind,
    status: row.status,
    providerMessageId: row.providerMessageId,
    dedupeKey: row.dedupeKey,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}
