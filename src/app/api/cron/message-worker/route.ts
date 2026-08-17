import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { drainMessageProcessQueue } from "@/application/jobs/drain-message-process-queue";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import { WhisperGateway } from "@/infrastructure/adapters/ai/whisper-gateway";
import { ZApiAudioTranscriber } from "@/infrastructure/adapters/channels/whatsapp/zapi-audio-transcriber";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleOutboundSafetyContextReader } from "@/infrastructure/repositories/drizzle-outbound-safety-context-reader";
import { createLogger } from "@/infrastructure/logging/logger";
import { reconcileMessageJobOrphans } from "@/application/jobs/reconcile-message-job-orphans";
import { DrizzleMessageJobOrphanReader } from "@/infrastructure/repositories/drizzle-message-job-orphan-reader";
import {
  DEFAULT_MESSAGE_PROCESS_BATCH_SIZE,
  MAX_MESSAGE_PROCESS_BATCH_SIZE,
  resolveWorkerBatchSize,
} from "@/application/jobs/worker-capacity";
import {
  runAfterSenderDrainAttempt,
  type ShadowBatchSummary,
} from "@/application/conversation-v2/run-shadow-batch";
import { createConversationV2Runtime } from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Sequential by design: ConversationOrchestrator still owns per-conversation
// ordering and can call external providers. The next invocation claims more work.
const MAX_JOBS_PER_RUN = resolveWorkerBatchSize(
  process.env.MESSAGE_PROCESS_BATCH_SIZE,
  DEFAULT_MESSAGE_PROCESS_BATCH_SIZE,
  MAX_MESSAGE_PROCESS_BATCH_SIZE,
);

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
  const outboundMessageStore = new DrizzleOutboundMessageStore();
  const audioTranscriber = new ZApiAudioTranscriber(new WhisperGateway());
  const conversationV2Runtime = createConversationV2Runtime({
    jobQueue,
    outboundMessageStore,
  });
  const handler = new ProcessMessageJobHandler({
    inboundEventStore,
    automationPolicy: conversationV2Runtime.automationPolicy,
    conversationHandler: conversationV2Runtime.conversationHandler,
    transcribeAudio: audioTranscriber.transcribe.bind(audioTranscriber),
    decisionTraceSink: conversationV2Runtime.decisionTraceSink,
    createTurnObservationSink: conversationV2Runtime.createTurnObservationSink,
  });

  try {
    const orphanReconciliation = await reconcileMessageJobOrphans({
      reader: new DrizzleMessageJobOrphanReader(),
      jobQueue,
      queues: ["message.process", "message.send"],
    });
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
    let conversationV2Shadow: ShadowBatchSummary | null = null;
    const capturedV2Turns = conversationV2Runtime.drainCapturedTurns();
    if (result.processed > 0) {
      const postSender = await runAfterSenderDrainAttempt({
        turns: capturedV2Turns,
        drainSender: async () => {
          return drainMessageSendQueue({
            jobQueue,
            outboundMessageStore,
            handler: new SendMessageJobHandler({
              outboundMessageStore,
              safetyContextReader: new DrizzleOutboundSafetyContextReader(),
              decisionTraceSink: conversationV2Runtime.decisionTraceSink,
            }),
            workerId: `${workerId}:send`,
            maxJobs: MAX_JOBS_PER_RUN,
          });
        },
        onSenderFailure: (error) => { log.error("inline_send.failed", error); },
        occurredAt: () => new Date().toISOString(),
        afterAttempt: async (senderBarrier, turns) => {
          try {
            const summary = await conversationV2Runtime.runSelectedShadowTurns({
              senderBarrier,
              turns,
            });
            for (const selection of summary.selections) {
              log.info("conversation_v2.engine_selected", selection);
            }
            return summary;
          } catch (error) {
            log.error("conversation_v2.shadow.failed", error);
            return null;
          }
        },
      });
      sendDrain = postSender.senderResult;
      conversationV2Shadow = postSender.shadowResult;
    }

    log.info("worker.run.completed", {
      ...result,
      orphanReconciliation,
      sendDrain,
      conversationV2Shadow,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ...result, orphanReconciliation, sendDrain, conversationV2Shadow });
  } catch (error) {
    log.error("worker.run.failed", error, { durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "message_worker_failed" }, { status: 500 });
  }
}
