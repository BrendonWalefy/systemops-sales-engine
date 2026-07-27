import type {
  InboundEventStore,
  RecordInboundEventInput,
} from "@/application/ports/inbound-event-store";
import type { JobQueue } from "@/application/ports/job-queue";

export type PersistInboundEventResult = {
  inboundEventId: string;
  eventWasNew: boolean;
  jobWasNew: boolean;
};

/**
 * Persists the provider payload before scheduling its processing. Re-enqueue on
 * a duplicate event repairs the narrow failure window between both operations.
 */
export async function persistInboundEventAndEnqueue(
  input: RecordInboundEventInput,
  deps: { inboundEventStore: InboundEventStore; jobQueue: JobQueue },
): Promise<PersistInboundEventResult> {
  if (deps.inboundEventStore.recordInboundEventAndEnqueue) {
    return deps.inboundEventStore.recordInboundEventAndEnqueue(input);
  }

  const recorded = await deps.inboundEventStore.recordInboundEvent(input);
  const enqueued = await deps.jobQueue.enqueueJob({
    queue: "message.process",
    payload: { inboundEventId: recorded.event.id },
    dedupeKey: `inbound-event:${recorded.event.id}`,
  });

  return {
    inboundEventId: recorded.event.id,
    eventWasNew: recorded.isNew,
    jobWasNew: enqueued.isNew,
  };
}
