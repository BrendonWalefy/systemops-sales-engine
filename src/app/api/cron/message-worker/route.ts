import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { drainMessageProcessQueue } from "@/application/jobs/drain-message-process-queue";
import { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { WhisperGateway } from "@/infrastructure/adapters/ai/whisper-gateway";
import { ZApiAudioTranscriber } from "@/infrastructure/adapters/channels/whatsapp/zapi-audio-transcriber";
import { DrizzleClinicAutomationPolicyReader } from "@/infrastructure/repositories/drizzle-clinic-automation-policy-reader";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sequential by design: ConversationOrchestrator still owns per-conversation
// ordering and can call external providers. The next invocation claims more work.
const MAX_JOBS_PER_RUN = 3;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const inboundEventStore = new DrizzleInboundEventStore();
  const jobQueue = new DrizzleJobQueue();
  const audioTranscriber = new ZApiAudioTranscriber(new WhisperGateway());
  const handler = new ProcessMessageJobHandler({
    inboundEventStore,
    automationPolicy: new DrizzleClinicAutomationPolicyReader(),
    conversationHandler: new ConversationOrchestrator(),
    transcribeAudio: audioTranscriber.transcribe.bind(audioTranscriber),
  });

  try {
    const result = await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      handler,
      workerId: `message-worker:${randomUUID()}`,
      maxJobs: MAX_JOBS_PER_RUN,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[MessageWorker] Falha ao drenar jobs:", error);
    return NextResponse.json({ error: "message_worker_failed" }, { status: 500 });
  }
}
