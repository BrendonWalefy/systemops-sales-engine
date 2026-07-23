import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { drainMessageProcessQueue } from "@/application/jobs/drain-message-process-queue";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { WhisperGateway } from "@/infrastructure/adapters/ai/whisper-gateway";
import { ZApiAudioTranscriber } from "@/infrastructure/adapters/channels/whatsapp/zapi-audio-transcriber";
import { DrizzleClinicAutomationPolicyReader } from "@/infrastructure/repositories/drizzle-clinic-automation-policy-reader";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleOutboundSafetyContextReader } from "@/infrastructure/repositories/drizzle-outbound-safety-context-reader";
import { createLogger } from "@/infrastructure/logging/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sequential by design: ConversationOrchestrator still owns per-conversation
// ordering and can call external providers. The next invocation claims more work.
const MAX_JOBS_PER_RUN = 3;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const workerId = `message-worker:${randomUUID()}`;
  const log = createLogger({
    scope: "MessageWorkerRoute",
    route: "/api/cron/message-worker",
    workerId,
    queue: "message.process",
  });
  const startedAt = Date.now();

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
      workerId,
      maxJobs: MAX_JOBS_PER_RUN,
    });

    // Latência: processar e enviar eram dois saltos de cron (até ~60s cada). O
    // envio é o salto seguro de colapsar — o job de send é uma função curta (só
    // chama a Z-API), sem o sleep de debounce que vive no lado de processar. Ao
    // compor uma resposta acabamos de enfileirar um message.send; drenamos aqui
    // mesmo, na mesma invocação, para a resposta sair em segundos em vez de esperar
    // o próximo tick do sender-worker. O cron do sender segue como rede de
    // segurança, e o SKIP LOCKED garante que os dois nunca enviam a mesma mensagem.
    //
    // NÃO toca no lado de processar (que tem o debounce bloqueante) — logo, sem
    // risco de rajada nem de pilha de funções longas. Falha aqui não derruba o
    // worker: as mensagens já foram processadas, e o cron do sender reprocessa.
    let sendDrain: Awaited<ReturnType<typeof drainMessageSendQueue>> | null = null;
    if (result.processed > 0) {
      try {
        const outboundMessageStore = new DrizzleOutboundMessageStore();
        sendDrain = await drainMessageSendQueue({
          jobQueue,
          outboundMessageStore,
          handler: new SendMessageJobHandler({
            outboundMessageStore,
            safetyContextReader: new DrizzleOutboundSafetyContextReader(),
          }),
          workerId: `${workerId}:send`,
          maxJobs: MAX_JOBS_PER_RUN,
        });
      } catch (error) {
        log.error("inline_send.failed", error);
      }
    }

    log.info("worker.run.completed", { ...result, sendDrain, durationMs: Date.now() - startedAt });
    return NextResponse.json({ ...result, sendDrain });
  } catch (error) {
    log.error("worker.run.failed", error, { durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "message_worker_failed" }, { status: 500 });
  }
}
