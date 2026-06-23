import type { InboundEventStore } from "@/application/ports/inbound-event-store";
import type { JobQueue } from "@/application/ports/job-queue";
import { getJobRetryAt } from "@/application/services/job-retry-policy";
import {
  getInboundEventId,
  type JobResult,
} from "@/application/jobs/process-message-job";

export type MessageProcessJobHandler = {
  processJob(job: Parameters<typeof getInboundEventId>[0]): Promise<JobResult>;
};

export type DrainMessageProcessQueueResult = {
  claimed: number;
  processed: number;
  ignored: number;
  retried: number;
  dead: number;
  recovered: number;
};

export async function drainMessageProcessQueue(params: {
  jobQueue: JobQueue;
  inboundEventStore: InboundEventStore;
  handler: MessageProcessJobHandler;
  workerId: string;
  maxJobs: number;
  now?: Date;
  staleAfterMs?: number;
}): Promise<DrainMessageProcessQueueResult> {
  const now = params.now ?? new Date();
  const staleAfterMs = params.staleAfterMs ?? 5 * 60_000;
  const result: DrainMessageProcessQueueResult = {
    claimed: 0,
    processed: 0,
    ignored: 0,
    retried: 0,
    dead: 0,
    recovered: await params.jobQueue.recoverStaleJobs({
      olderThan: new Date(now.getTime() - staleAfterMs),
    }),
  };

  for (let index = 0; index < params.maxJobs; index++) {
    const job = await params.jobQueue.claimNextJob({
      queues: ["message.process"],
      workerId: params.workerId,
      now,
    });
    if (!job) break;

    result.claimed++;
    let processingResult: JobResult | null = null;
    try {
      processingResult = await params.handler.processJob(job);
      const completed = await params.jobQueue.completeJob(job.id, params.workerId, new Date());
      if (!completed) continue;

      if (processingResult.outcome === "processed") result.processed++;
      else result.ignored++;
    } catch (error) {
      // The domain journey may already have persisted its result. If only the
      // queue acknowledgement failed, keep the event terminal; stale recovery
      // will claim the job and complete it without replaying the conversation.
      if (processingResult?.outcome === "processed") {
        console.error("[MessageWorker] Job acknowledgement failed after processing:", error);
        continue;
      }

      const status = await params.jobQueue.failJob({
        job,
        workerId: params.workerId,
        error: error instanceof Error ? error.message : String(error),
        retryAt: getJobRetryAt(job, now),
        now: new Date(),
      });
      const inboundEventId = getInboundEventId(job);
      if (inboundEventId && status === "pending") {
        await params.inboundEventStore.markInboundEventPending(inboundEventId);
      }
      if (inboundEventId && status === "dead") {
        await params.inboundEventStore.markInboundEventFailed(inboundEventId);
      }

      if (status === "pending") result.retried++;
      else if (status === "dead") result.dead++;
    }
  }

  return result;
}
