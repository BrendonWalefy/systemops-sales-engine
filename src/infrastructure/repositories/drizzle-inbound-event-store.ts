import { and, eq } from "drizzle-orm";
import type {
  InboundEvent,
  InboundEventStore,
  RecordInboundEventInput,
  RecordInboundEventResult,
} from "@/application/ports/inbound-event-store";
import { db } from "@/infrastructure/db/client";
import { inboundEvents } from "@/infrastructure/db/schema";

export class DrizzleInboundEventStore implements InboundEventStore {
  async recordInboundEvent(input: RecordInboundEventInput): Promise<RecordInboundEventResult> {
    const [created] = await db
      .insert(inboundEvents)
      .values({
        clinicId: input.clinicId,
        provider: input.provider,
        providerMessageId: input.providerMessageId,
        conversationKey: input.conversationKey,
        payload: input.payload,
        normalizedText: input.normalizedText,
        mediaType: input.mediaType,
        dedupeKey: input.dedupeKey,
        receivedAt: input.receivedAt,
      })
      .onConflictDoNothing({
        target: [inboundEvents.provider, inboundEvents.providerMessageId],
      })
      .returning();

    if (created) return { event: mapInboundEvent(created), isNew: true };

    const [existing] = await db
      .select()
      .from(inboundEvents)
      .where(
        and(
          eq(inboundEvents.provider, input.provider),
          eq(inboundEvents.providerMessageId, input.providerMessageId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Inbound event insert conflicted without an existing event");
    }

    return { event: mapInboundEvent(existing), isNew: false };
  }

  async findInboundEvent(id: string): Promise<InboundEvent | null> {
    const [event] = await db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.id, id))
      .limit(1);
    return event ? mapInboundEvent(event) : null;
  }

  async markInboundEventProcessing(id: string): Promise<void> {
    await db
      .update(inboundEvents)
      .set({ processingStatus: "processing" })
      .where(eq(inboundEvents.id, id));
  }

  async markInboundEventPending(id: string): Promise<void> {
    await db
      .update(inboundEvents)
      .set({ processingStatus: "pending" })
      .where(eq(inboundEvents.id, id));
  }

  async markInboundEventProcessed(id: string, processedAt = new Date()): Promise<void> {
    await db
      .update(inboundEvents)
      .set({ processingStatus: "processed", processedAt })
      .where(eq(inboundEvents.id, id));
  }

  async markInboundEventFailed(id: string): Promise<void> {
    await db
      .update(inboundEvents)
      .set({ processingStatus: "failed" })
      .where(eq(inboundEvents.id, id));
  }

  async markInboundEventIgnored(id: string, processedAt = new Date()): Promise<void> {
    await db
      .update(inboundEvents)
      .set({ processingStatus: "ignored", processedAt })
      .where(eq(inboundEvents.id, id));
  }
}

function mapInboundEvent(row: typeof inboundEvents.$inferSelect): InboundEvent {
  return {
    id: row.id,
    clinicId: row.clinicId,
    provider: row.provider,
    providerMessageId: row.providerMessageId,
    conversationKey: row.conversationKey,
    payload: row.payload,
    normalizedText: row.normalizedText,
    mediaType: row.mediaType,
    dedupeKey: row.dedupeKey,
    processingStatus: row.processingStatus,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
  };
}
