import { randomUUID } from "crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { drainMessageProcessQueue } from "@/application/jobs/drain-message-process-queue";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import { RegisterInboundHistory } from "@/application/conversation/register-inbound-history";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import { WhisperGateway } from "@/infrastructure/adapters/ai/whisper-gateway";
import { ZApiAudioTranscriber } from "@/infrastructure/adapters/channels/whatsapp/zapi-audio-transcriber";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleOutboundSafetyContextReader } from "@/infrastructure/repositories/drizzle-outbound-safety-context-reader";
import { DrizzleV2ConversationHandoffStore } from "@/infrastructure/repositories/drizzle-v2-conversation-handoff-store";
import { createLogger } from "@/infrastructure/logging/logger";
import { reconcileMessageJobOrphans } from "@/application/jobs/reconcile-message-job-orphans";
import { DrizzleMessageJobOrphanReader } from "@/infrastructure/repositories/drizzle-message-job-orphan-reader";
import { DrizzleWhatsAppStreamAuthority } from "@/infrastructure/repositories/drizzle-whatsapp-stream-authority";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import {
  DEFAULT_MESSAGE_PROCESS_BATCH_SIZE,
  MAX_MESSAGE_PROCESS_BATCH_SIZE,
  resolveWorkerBatchSize,
} from "@/application/jobs/worker-capacity";
import { createConversationV2Runtime } from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";
import { scheduleAcceptedWorkerRun } from "@/application/jobs/worker-wake";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Sequential by design: the V2 lifecycle owns per-conversation ordering and can
// call external providers. The next invocation claims more work.
const MAX_JOBS_PER_RUN = resolveWorkerBatchSize(
  process.env.MESSAGE_PROCESS_BATCH_SIZE,
  DEFAULT_MESSAGE_PROCESS_BATCH_SIZE,
  MAX_MESSAGE_PROCESS_BATCH_SIZE,
);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  if (request.nextUrl.searchParams.get("ack") === "1") {
    const notBeforeValue = request.nextUrl.searchParams.get("notBefore");
    const notBefore = notBeforeValue ? new Date(notBeforeValue) : undefined;
    if (notBefore && Number.isNaN(notBefore.getTime())) {
      return NextResponse.json({ error: "invalid_not_before" }, { status: 400 });
    }
    const accepted = scheduleAcceptedWorkerRun({
      schedule: after,
      notBefore,
      run: runMessageWorker,
    });
    return accepted
      ? NextResponse.json({ accepted: true }, { status: 202 })
      : NextResponse.json({ accepted: false, fallback: "cron" }, { status: 422 });
  }

  const outcome = await runMessageWorker();
  return NextResponse.json(outcome.body, { status: outcome.status });
}

type MessageWorkerRunOutcome = { body: Record<string, unknown>; status: number };

async function runMessageWorker(): Promise<MessageWorkerRunOutcome> {

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
  const outboundMessageStore = new DrizzleOutboundMessageStore();
  const terminalHandoffStore = new DrizzleV2ConversationHandoffStore();
  const audioTranscriber = new ZApiAudioTranscriber(new WhisperGateway());
  const conversationV2Runtime = createConversationV2Runtime({
    jobQueue,
    outboundMessageStore,
  });
  const historyConversationRepository = new DrizzleConversationRepository();
  const streamAuthority = new DrizzleWhatsAppStreamAuthority();
  const handler = new ProcessMessageJobHandler({
    inboundEventStore,
    automationPolicy: conversationV2Runtime.automationPolicy,
    conversationHandler: conversationV2Runtime.conversationHandler,
    inboundHistoryRegistrar: new RegisterInboundHistory({
      registerIncomingMessage: new RegisterIncomingMessage({
        leadRepository: new DrizzleLeadRepository(),
        conversationRepository: historyConversationRepository,
        usageCostTracker: new DefaultUsageCostTracker({
          usageCostRepository: new DrizzleUsageCostRepository(),
          idGenerator: randomUUID,
          now: () => new Date(),
        }),
        idGenerator: randomUUID,
        now: () => new Date(),
      }),
      streamAuthority,
      now: () => new Date(),
    }),
    transcribeAudio: audioTranscriber.transcribe.bind(audioTranscriber),
    decisionTraceSink: conversationV2Runtime.decisionTraceSink,
  });

  try {
    const orphanReconciliation = await reconcileMessageJobOrphans({
      reader: new DrizzleMessageJobOrphanReader(),
      jobQueue,
      streamAuthority,
      queues: ["message.process", "message.send"],
    });
    const result = await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      terminalHandoffStore,
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
        sendDrain = await drainMessageSendQueue({
          jobQueue,
          outboundMessageStore,
          terminalHandoffStore,
          handler: new SendMessageJobHandler({
            outboundMessageStore,
            safetyContextReader: new DrizzleOutboundSafetyContextReader(),
            decisionTraceSink: conversationV2Runtime.decisionTraceSink,
          }),
          workerId: `${workerId}:send`,
          maxJobs: MAX_JOBS_PER_RUN,
        });
      } catch (error) {
        log.error("inline_send.failed", error);
      }
    }

    log.info("worker.run.completed", {
      ...result,
      orphanReconciliation,
      sendDrain,
      durationMs: Date.now() - startedAt,
    });
    return {
      body: { ...result, orphanReconciliation, sendDrain },
      status: 200,
    };
  } catch (error) {
    log.error("worker.run.failed", error, { durationMs: Date.now() - startedAt });
    return { body: { error: "message_worker_failed" }, status: 500 };
  }
}
