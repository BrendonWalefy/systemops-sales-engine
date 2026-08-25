import type {
  CreateOutboundMessageInput,
  OutboundMessageStore,
} from "@/application/ports/outbound-message-store";
import type { JobQueue } from "@/application/ports/job-queue";
import { after } from "next/server";
import {
  requestSenderWorkerRun,
  scheduleSenderWorkerWake,
} from "@/application/jobs/worker-wake";

type EnqueueOutboundMessageDependencies = {
  outboundMessageStore: OutboundMessageStore;
  jobQueue: JobQueue;
  requestSenderWake?: () => Promise<unknown>;
  scheduleSenderWake?: (task: () => Promise<void>) => void;
};

export async function enqueueOutboundMessage(
  input: CreateOutboundMessageInput,
  deps: EnqueueOutboundMessageDependencies,
): Promise<{ outboundMessageId: string; messageWasNew: boolean; jobWasNew: boolean }> {
  const turnId = getTurnId(input.payload);
  if (deps.outboundMessageStore.createOutboundMessageAndEnqueue) {
    const result = await deps.outboundMessageStore.createOutboundMessageAndEnqueue(input, { turnId });
    wakeSenderAfterCommit(result.jobWasNew, deps);
    return result;
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

  const result = {
    outboundMessageId: created.message.id,
    messageWasNew: created.isNew,
    jobWasNew: enqueued.isNew,
  };
  wakeSenderAfterCommit(result.jobWasNew, deps);
  return result;
}

function wakeSenderAfterCommit(
  jobWasNew: boolean,
  deps: Pick<EnqueueOutboundMessageDependencies, "requestSenderWake" | "scheduleSenderWake">,
): void {
  if (!jobWasNew) return;
  scheduleSenderWorkerWake(deps.scheduleSenderWake ?? after, {
    request: deps.requestSenderWake ?? (() => requestSenderWorkerRun()),
  });
}

function getTurnId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).turnId;
  return typeof value === "string" && value.trim() ? value : null;
}
