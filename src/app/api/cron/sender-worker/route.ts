import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleOutboundSafetyContextReader } from "@/infrastructure/repositories/drizzle-outbound-safety-context-reader";
import { createLogger } from "@/infrastructure/logging/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_JOBS_PER_RUN = 5;

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
  try {
    const result = await drainMessageSendQueue({
      jobQueue: new DrizzleJobQueue(),
      outboundMessageStore,
      handler: new SendMessageJobHandler({ outboundMessageStore, safetyContextReader }),
      workerId,
      maxJobs: MAX_JOBS_PER_RUN,
    });
    log.info("worker.run.completed", { ...result, durationMs: Date.now() - startedAt });
    return NextResponse.json(result);
  } catch (error) {
    log.error("worker.run.failed", error, { durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "sender_worker_failed" }, { status: 500 });
  }
}
