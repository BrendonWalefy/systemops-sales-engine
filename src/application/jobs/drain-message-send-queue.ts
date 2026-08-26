import type { JobQueue } from "@/application/ports/job-queue";
import type { OutboundMessageStore } from "@/application/ports/outbound-message-store";
import { getJobRetryAt } from "@/application/services/job-retry-policy";
import { createLogger } from "@/infrastructure/logging/logger";
import {
  getV2TerminalHandoffRequiredReason,
  resolveV2TerminalFailure,
  V2TerminalHandoffRequiredError,
  type V2TerminalHandoffStore,
} from "@/application/conversation-v2/v2-terminal-failure-policy";

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
  nextRunAt: Date | null;
};

export async function drainMessageSendQueue(params: {
  jobQueue: JobQueue;
  outboundMessageStore: OutboundMessageStore;
  terminalHandoffStore: Pick<V2TerminalHandoffStore, "markForOutboundMessage">;
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
    nextRunAt: null,
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
      if (getV2TerminalHandoffRequiredReason(job.lastError) === "delivery_outcome_indeterminate") {
        throw new V2TerminalHandoffRequiredError("delivery_outcome_indeterminate");
      }
      processingOutcome = await params.handler.processJob(job);
      if (isDeferredOutcome(processingOutcome)) {
        const releaseAt = processingOutcome === "deferred"
          ? new Date(now.getTime() + 1_000)
          : processingOutcome.runAt;
        await params.jobQueue.releaseJob(
          job.id,
          params.workerId,
          releaseAt,
        );
        if (!result.nextRunAt || releaseAt < result.nextRunAt) {
          result.nextRunAt = releaseAt;
        }
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
      const deliveryOutcomeIndeterminate =
        getV2TerminalHandoffRequiredReason(error) === "delivery_outcome_indeterminate";
      const retryAt = getJobRetryAt(job, now);
      const terminalResolution = deliveryOutcomeIndeterminate
        ? "handoff_required"
        : resolveV2TerminalFailure({
          attempt: job.attempts,
          maxAttempts: job.maxAttempts,
          effectState: "completed",
          safeReplyState: "unavailable",
        });
      if (terminalResolution === "handoff_required") {
        try {
          if (!outboundMessageId) throw new Error("terminal send job has no outbound message");
          const outbound = await params.outboundMessageStore.findOutboundMessage(outboundMessageId);
          if (!outbound) throw new Error("terminal send outbound message is missing");
          if (outbound.authorization.kind === "live_stream_reply") {
            const handedOff = await params.terminalHandoffStore.markForOutboundMessage({
              outboundMessageId,
              sendJobId: job.id,
              workerId: params.workerId,
              reason: "v2_terminal_delivery_failure",
              now: new Date(),
            });
            if (!handedOff) throw new Error("terminal send handoff binding mismatch");
          }
        } catch (handoffError) {
          if (deliveryOutcomeIndeterminate) {
            jobLog.error("job.terminal_resolution.failed", handoffError, {
              status: "force_dead",
              durationMs: Date.now() - startedAt,
            });
          } else {
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
            continue;
          }
        }
      }
      const status = await params.jobQueue.failJob({
        job,
        workerId: params.workerId,
        error: errorMessage,
        retryAt,
        forceDead: deliveryOutcomeIndeterminate,
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
