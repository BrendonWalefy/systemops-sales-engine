import type { JobQueue } from "@/application/ports/job-queue";
import type { OutboundMessageStore } from "@/application/ports/outbound-message-store";
import { getJobRetryAt } from "@/application/services/job-retry-policy";
import { createLogger } from "@/infrastructure/logging/logger";

export type MessageSendJobProcessResult =
  | "sent"
  | "ignored"
  | "deferred"
  | { status: "deferred"; runAt: Date; reason: string };

export type MessageSendJobHandler = {
  processJob(job: {
    id: string;
    payload: unknown;
  }): Promise<MessageSendJobProcessResult>;
};

export type DrainMessageSendQueueResult = {
  claimed: number;
  sent: number;
  ignored: number;
  deferred: number;
  retried: number;
  dead: number;
  recovered: number;
};

export async function drainMessageSendQueue(params: {
  jobQueue: JobQueue;
  outboundMessageStore: OutboundMessageStore;
  handler: MessageSendJobHandler;
  workerId: string;
  maxJobs: number;
  now?: Date;
}): Promise<DrainMessageSendQueueResult> {
  const now = params.now ?? new Date();
  const result: DrainMessageSendQueueResult = {
    claimed: 0,
    sent: 0,
    ignored: 0,
    deferred: 0,
    retried: 0,
    dead: 0,
    recovered: await params.jobQueue.recoverStaleJobs({
      olderThan: new Date(now.getTime() - 5 * 60_000),
    }),
  };
  const log = createLogger({
    scope: "MessageSendDrain",
    workerId: params.workerId,
    queue: "message.send",
  });

  for (let index = 0; index < params.maxJobs; index++) {
    const job = await params.jobQueue.claimNextJob({
      queues: ["message.send"],
      workerId: params.workerId,
      now,
    });
    if (!job) break;
    result.claimed++;
    const jobLog = log.child({
      jobId: job.id,
      traceId: getTurnId(job.payload) ?? getOutboundMessageId(job.payload) ?? undefined,
    });
    const startedAt = Date.now();
    jobLog.info("job.claimed", { attempt: job.attempts });

    let processingOutcome: MessageSendJobProcessResult | null = null;
    try {
      processingOutcome = await params.handler.processJob(job);
      if (isDeferredOutcome(processingOutcome)) {
        await params.jobQueue.releaseJob(
          job.id,
          params.workerId,
          processingOutcome === "deferred"
            ? new Date(Date.now() + 1_000)
            : processingOutcome.runAt,
        );
        result.deferred++;
        jobLog.info("job.deferred", {
          reason: processingOutcome === "deferred" ? "handler_deferred" : processingOutcome.reason,
          runAt: processingOutcome === "deferred" ? undefined : processingOutcome.runAt.toISOString(),
          durationMs: Date.now() - startedAt,
        });
        continue;
      }

      const completed = await params.jobQueue.completeJob(job.id, params.workerId, new Date());
      if (!completed) continue;
      if (processingOutcome === "sent") result.sent++;
      else result.ignored++;
      jobLog.info("job.completed", {
        outcome: processingOutcome,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      // The outbox is already terminal after a successful provider send. A
      // missing queue acknowledgement must not schedule a duplicate delivery.
      if (processingOutcome === "sent") {
        jobLog.error("job.acknowledgement.failed", error, { durationMs: Date.now() - startedAt });
        continue;
      }

      const outboundMessageId = getOutboundMessageId(job.payload);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const status = await params.jobQueue.failJob({
        job,
        workerId: params.workerId,
        error: errorMessage,
        retryAt: getJobRetryAt(job, now),
        now: new Date(),
      });
      if (outboundMessageId && status === "pending") {
        await params.outboundMessageStore.markOutboundPending(outboundMessageId, errorMessage);
      }
      if (outboundMessageId && status === "dead") {
        await params.outboundMessageStore.markOutboundDead(outboundMessageId, errorMessage);
      }
      if (status === "pending") result.retried++;
      else if (status === "dead") result.dead++;
      jobLog.error("job.failed", error, {
        status,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  return result;
}

function isDeferredOutcome(
  outcome: MessageSendJobProcessResult,
): outcome is "deferred" | { status: "deferred"; runAt: Date; reason: string } {
  return outcome === "deferred" || (typeof outcome === "object" && outcome.status === "deferred");
}

export function getOutboundMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).outboundMessageId;
  return typeof value === "string" && value ? value : null;
}

export function getTurnId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).turnId;
  return typeof value === "string" && value ? value : null;
}
