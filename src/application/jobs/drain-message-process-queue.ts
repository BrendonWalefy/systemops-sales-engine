import type { InboundEventStore } from "@/application/ports/inbound-event-store";
import type {
  ClaimInboundWorkResult,
  JobQueue,
} from "@/application/ports/job-queue";
import { getJobRetryAt } from "@/application/services/job-retry-policy";
import {
  getInboundEventId,
  type JobResult,
} from "@/application/jobs/process-message-job";
import { createLogger } from "@/infrastructure/logging/logger";
import {
  isV2TerminalHandoffRequiredError,
  resolveV2TerminalFailure,
  V2TerminalHandoffRequiredError,
  type V2TerminalHandoffStore,
} from "@/application/conversation-v2/v2-terminal-failure-policy";

export type MessageProcessJobHandler = {
  processClaimedJob(work: ClaimInboundWorkResult): Promise<JobResult>;
  processHistoryOnlyJob(work: ClaimInboundWorkResult): Promise<JobResult>;
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
  terminalHandoffStore: Pick<V2TerminalHandoffStore, "markForInboundEvent">;
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
  const log = createLogger({
    scope: "MessageProcessDrain",
    workerId: params.workerId,
    queue: "message.process",
  });

  const workItems: ClaimInboundWorkResult[] = [];
  for (let index = 0; index < params.maxJobs; index++) {
    const work = await params.jobQueue.claimNextInboundWork({
      workerId: params.workerId,
      now,
    });
    if (!work) break;
    workItems.push(work);
  }

  result.claimed = workItems.length;

  await Promise.all(
    workItems.map(async (work) => {
      const job = work.job;
      const jobLog = log.child({ jobId: job.id, traceId: getInboundEventId(job) ?? undefined });
      const startedAt = Date.now();
      jobLog.info("job.claimed", { attempt: job.attempts });
      let processingResult: JobResult | null = null;
      try {
        if (work.outcome === "claimed" && isV2TerminalHandoffRequiredError(job.lastError)) {
          throw new V2TerminalHandoffRequiredError("effect_outbox_failed");
        }
        processingResult = work.outcome === "history_only"
          ? await params.handler.processHistoryOnlyJob(work)
          : await params.handler.processClaimedJob(work);
        const completed = await params.jobQueue.completeJob(job.id, params.workerId, new Date());
        if (!completed) return;

        if (processingResult.outcome === "processed") result.processed++;
        else result.ignored++;
        jobLog.info("job.completed", {
          outcome: processingResult.outcome,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (processingResult?.outcome === "processed") {
          jobLog.error("job.acknowledgement.failed", error, { durationMs: Date.now() - startedAt });
          return;
        }

        const retryAt = getJobRetryAt(job, now);
        const terminalResolution = resolveV2TerminalFailure({
          attempt: job.attempts,
          maxAttempts: job.maxAttempts,
          effectState: "attempted",
          safeReplyState: "unavailable",
        });
        const inboundEventId = getInboundEventId(job);
        if (terminalResolution === "handoff_required") {
          try {
            if (!inboundEventId) throw new Error("terminal process job has no inbound event");
            const event = await params.inboundEventStore.findInboundEvent(inboundEventId);
            if (!event) throw new Error("terminal process inbound event is missing");
            const handedOff = await params.terminalHandoffStore.markForInboundEvent({
              clinicId: event.clinicId,
              inboundEventId,
              claimJobId: job.id,
              reason: "v2_terminal_processing_failure",
              now: new Date(),
            });
            if (!handedOff) throw new Error("terminal process handoff binding mismatch");
          } catch (handoffError) {
            const released = await params.jobQueue.releaseJob(
              job.id,
              params.workerId,
              retryAt,
              new Date(),
            );
            if (released) result.retried++;
            jobLog.error("job.terminal_resolution.failed", handoffError, {
              status: released ? "pending" : "processing",
              durationMs: Date.now() - startedAt,
            });
            return;
          }
        }

        const status = await params.jobQueue.failJob({
          job,
          workerId: params.workerId,
          error: error instanceof Error ? error.message : String(error),
          retryAt,
          now: new Date(),
        });
        if (inboundEventId && status === "pending" && work.outcome === "claimed") {
          await params.inboundEventStore.markInboundEventPending(inboundEventId);
        }
        if (inboundEventId && status === "dead") {
          await params.inboundEventStore.markInboundEventFailed(inboundEventId);
        }

        if (status === "pending") result.retried++;
        else if (status === "dead") result.dead++;
        jobLog.error("job.failed", error, {
          status,
          durationMs: Date.now() - startedAt,
        });
      }
    })
  );

  return result;
}
