import type {
  CreateOutboundMessageInput,
  OutboundMessageStore,
} from "@/application/ports/outbound-message-store";
import type { JobQueue } from "@/application/ports/job-queue";

export async function enqueueOutboundMessage(
  input: CreateOutboundMessageInput,
  deps: { outboundMessageStore: OutboundMessageStore; jobQueue: JobQueue },
): Promise<{ outboundMessageId: string; messageWasNew: boolean; jobWasNew: boolean }> {
  const turnId = getTurnId(input.payload);
  if (deps.outboundMessageStore.createOutboundMessageAndEnqueue) {
    return deps.outboundMessageStore.createOutboundMessageAndEnqueue(input, { turnId });
  }

  const created = await deps.outboundMessageStore.createOutboundMessage(input);
  const enqueued = await deps.jobQueue.enqueueJob({
    queue: "message.send",
    payload: {
      outboundMessageId: created.message.id,
      ...(turnId ? { turnId } : {}),
    },
    dedupeKey: `outbound-message:${created.message.id}`,
  });

  return {
    outboundMessageId: created.message.id,
    messageWasNew: created.isNew,
    jobWasNew: enqueued.isNew,
  };
}

function getTurnId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).turnId;
  return typeof value === "string" && value.trim() ? value : null;
}
