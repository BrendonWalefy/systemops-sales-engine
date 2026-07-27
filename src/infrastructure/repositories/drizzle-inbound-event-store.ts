import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type {
  InboundEvent,
  InboundEventStore,
  RecordInboundEventAndEnqueueResult,
  RecordInboundEventInput,
  RecordInboundEventResult,
} from "@/application/ports/inbound-event-store";
import { db } from "@/infrastructure/db/client";
import { inboundEvents } from "@/infrastructure/db/schema";

export class DrizzleInboundEventStore implements InboundEventStore {
  async recordInboundEventAndEnqueue(
    input: RecordInboundEventInput,
  ): Promise<RecordInboundEventAndEnqueueResult> {
    const inboundEventId = randomUUID();
    const jobId = randomUUID();
    const receivedAt = input.receivedAt ?? new Date();
    const result = await db.execute<{
      inbound_event_id: string;
      event_was_new: boolean;
      job_was_new: boolean;
    }>(sql`
      with persisted_event as (
        insert into inbound_events (
          id,
          organization_id,
          provider,
          provider_message_id,
          conversation_key,
          payload,
          normalized_text,
          media_type,
          dedupe_key,
          received_at
        ) values (
          ${inboundEventId}::uuid,
          ${input.clinicId}::uuid,
          ${input.provider},
          ${input.providerMessageId},
          ${input.conversationKey},
          ${JSON.stringify(input.payload)}::jsonb,
          ${input.normalizedText ?? null},
          ${input.mediaType ?? null},
          ${input.dedupeKey},
          ${receivedAt}
        )
        on conflict (provider, provider_message_id) do update
          set provider_message_id = excluded.provider_message_id
        returning id
      ), persisted_job as (
        insert into jobs (id, queue, payload, dedupe_key)
        select
          ${jobId}::uuid,
          'message.process',
          jsonb_build_object('inboundEventId', persisted_event.id::text),
          'inbound-event:' || persisted_event.id::text
        from persisted_event
        on conflict (queue, dedupe_key) do update
          set dedupe_key = excluded.dedupe_key
        returning id
      )
      select
        persisted_event.id::text as inbound_event_id,
        persisted_event.id = ${inboundEventId}::uuid as event_was_new,
        persisted_job.id = ${jobId}::uuid as job_was_new
      from persisted_event
      cross join persisted_job
    `);
    const row = result.rows[0];
    if (!row) throw new Error("Atomic inbound event persistence returned no row");

    return {
      inboundEventId: row.inbound_event_id,
      eventWasNew: row.event_was_new,
      jobWasNew: row.job_was_new,
    };
  }

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
