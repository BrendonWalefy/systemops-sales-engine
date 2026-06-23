import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_JOBS_PER_RUN = 5;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const outboundMessageStore = new DrizzleOutboundMessageStore();
  try {
    const result = await drainMessageSendQueue({
      jobQueue: new DrizzleJobQueue(),
      outboundMessageStore,
      handler: new SendMessageJobHandler({ outboundMessageStore }),
      workerId: `sender-worker:${randomUUID()}`,
      maxJobs: MAX_JOBS_PER_RUN,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[SenderWorker] Falha ao drenar jobs:", error);
    return NextResponse.json({ error: "sender_worker_failed" }, { status: 500 });
  }
}
