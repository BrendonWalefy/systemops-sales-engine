import type {
  InboundRegistrationResult,
  InboundEventStore,
  RecordInboundEventInput,
} from "@/application/ports/inbound-event-store";

export type PersistInboundEventResult = InboundRegistrationResult;

/**
 * Persists provider ingress, stream authority, generation, and its processing
 * job through the store's one atomic database boundary.
 */
export async function persistInboundEventAndEnqueue(
  input: RecordInboundEventInput,
  deps: { inboundEventStore: InboundEventStore },
): Promise<PersistInboundEventResult> {
  return deps.inboundEventStore.recordInboundEventAndEnqueue(input);
}
