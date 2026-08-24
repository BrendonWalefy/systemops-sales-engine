import type {
  InboundEventStore,
  RecordInboundEventInput,
} from "@/application/ports/inbound-event-store";
import type { JobQueue } from "@/application/ports/job-queue";
import { DEFAULT_MESSAGE_DEBOUNCE_MS } from "@/core/pipeline/message-debounce";

export type PersistInboundEventResult = {
  inboundEventId: string;
  eventWasNew: boolean;
  jobWasNew: boolean;
};

/**
 * Persists the provider payload before scheduling its processing. Re-enqueue on
 * a duplicate event repairs the narrow failure window between both operations.
 *
 * O run_at do job cai no fim da janela de agrupamento (recebimento + janela
 * padrão), para o sono da rajada dormir na fila em vez de dentro do worker.
 * O orquestrador ainda dorme o resíduo do que sobrar para clínicas configuradas
 * acima do default; ver computeResidualDebounceMs.
 */
export async function persistInboundEventAndEnqueue(
  input: RecordInboundEventInput,
  deps: { inboundEventStore: InboundEventStore; jobQueue: JobQueue },
): Promise<PersistInboundEventResult> {
  if (deps.inboundEventStore.recordInboundEventAndEnqueue) {
    return deps.inboundEventStore.recordInboundEventAndEnqueue(input);
  }

  const recorded = await deps.inboundEventStore.recordInboundEvent(input);
  const receivedAt = input.receivedAt ?? recorded.event.receivedAt;
  const enqueued = await deps.jobQueue.enqueueJob({
    queue: "message.process",
    payload: { inboundEventId: recorded.event.id },
    dedupeKey: `inbound-event:${recorded.event.id}`,
    runAt: new Date(receivedAt.getTime() + DEFAULT_MESSAGE_DEBOUNCE_MS),
  });

  return {
    inboundEventId: recorded.event.id,
    eventWasNew: recorded.isNew,
    jobWasNew: enqueued.isNew,
  };
}
