import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleOutboundSafetyContextReader } from "@/infrastructure/repositories/drizzle-outbound-safety-context-reader";
import { createLogger } from "@/infrastructure/logging/logger";
import { createRuntimeDecisionTraceSink } from "@/infrastructure/observability/runtime-decision-trace";
import { reconcileMessageJobOrphans } from "@/application/jobs/reconcile-message-job-orphans";
import { DrizzleMessageJobOrphanReader } from "@/infrastructure/repositories/drizzle-message-job-orphan-reader";
import {
  DEFAULT_MESSAGE_SEND_BATCH_SIZE,
  MAX_MESSAGE_SEND_BATCH_SIZE,
  resolveWorkerBatchSize,
} from "@/application/jobs/worker-capacity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_JOBS_PER_RUN = resolveWorkerBatchSize(
  process.env.MESSAGE_SEND_BATCH_SIZE,
  DEFAULT_MESSAGE_SEND_BATCH_SIZE,
  MAX_MESSAGE_SEND_BATCH_SIZE,
);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const workerId = `sender-worker:${randomUUID()}`;
  const log = createLogger({
    scope: "SenderWorkerRoute",
    route: "/api/cron/sender-worker",
    workerId,
    queue: "message.send",
  });
  const startedAt = Date.now();
  const outboundMessageStore = new DrizzleOutboundMessageStore();
  const safetyContextReader = new DrizzleOutboundSafetyContextReader();
  const decisionTraceSink = createRuntimeDecisionTraceSink();
  try {
    const jobQueue = new DrizzleJobQueue();
    const orphanReconciliation = await reconcileMessageJobOrphans({
      reader: new DrizzleMessageJobOrphanReader(),
      jobQueue,
      queues: ["message.send"],
    });
    const result = await drainMessageSendQueue({
      jobQueue,
      outboundMessageStore,
      handler: new SendMessageJobHandler({
        outboundMessageStore,
        safetyContextReader,
        decisionTraceSink,
      }),
      workerId,
      maxJobs: MAX_JOBS_PER_RUN,
    });
    log.info("worker.run.completed", {
      ...result,
      orphanReconciliation,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ...result, orphanReconciliation });
  } catch (error) {
    log.error("worker.run.failed", error, { durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "sender_worker_failed" }, { status: 500 });
  }
}
