import type {
  CreateOutboundMessageInput,
  OutboundMessageStore,
} from "@/application/ports/outbound-message-store";
import type { JobQueue } from "@/application/ports/job-queue";

export async function enqueueOutboundMessage(
  input: CreateOutboundMessageInput,
  deps: { outboundMessageStore: OutboundMessageStore; jobQueue: JobQueue },
): Promise<{ outboundMessageId: string; messageWasNew: boolean; jobWasNew: boolean }> {
  const created = await deps.outboundMessageStore.createOutboundMessage(input);
  const enqueued = await deps.jobQueue.enqueueJob({
    queue: "message.send",
    payload: { outboundMessageId: created.message.id },
    dedupeKey: `outbound-message:${created.message.id}`,
  });

  return {
    outboundMessageId: created.message.id,
    messageWasNew: created.isNew,
    jobWasNew: enqueued.isNew,
  };
}
