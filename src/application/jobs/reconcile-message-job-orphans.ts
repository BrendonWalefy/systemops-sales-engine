import type { JobQueue } from "@/application/ports/job-queue";
import type { MessageJobOrphanReader } from "@/application/ports/message-job-orphan-reader";

export type MessageJobOrphanReconciliationResult = {
  inboundFound: number;
  inboundRepaired: number;
  outboundFound: number;
  outboundRepaired: number;
};

/**
 * Repara a janela entre persistir o evento/outbox e criar seu job. O atraso
 * mínimo evita disputar com a requisição que acabou de persistir; o dedupe da
 * fila torna qualquer corrida restante idempotente.
 */
export async function reconcileMessageJobOrphans(input: {
  reader: MessageJobOrphanReader;
  jobQueue: JobQueue;
  now?: Date;
  minimumAgeMs?: number;
  limitPerQueue?: number;
  queues?: Array<"message.process" | "message.send">;
}): Promise<MessageJobOrphanReconciliationResult> {
  const now = input.now ?? new Date();
  const minimumAgeMs = input.minimumAgeMs ?? 60_000;
  const limit = input.limitPerQueue ?? 25;
  const queues = new Set(input.queues ?? ["message.process", "message.send"]);
  const olderThan = new Date(now.getTime() - minimumAgeMs);
  const inbound = queues.has("message.process")
    ? await input.reader.listInboundWithoutJob({ olderThan, limit })
    : [];
  const outbound = queues.has("message.send")
    ? await input.reader.listOutboundWithoutJob({ olderThan, limit })
    : [];

  const inboundResults = await Promise.all(inbound.map((event) =>
    input.jobQueue.enqueueJob({
      queue: "message.process",
      payload: { inboundEventId: event.id },
      dedupeKey: `inbound-event:${event.id}`,
    })
  ));
  const inboundRepaired = inboundResults.filter((result) => result.isNew).length;

  const outboundResults = await Promise.all(outbound.map((message) => {
    const turnId = getTurnId(message.payload);
    return input.jobQueue.enqueueJob({
      queue: "message.send",
      payload: {
        outboundMessageId: message.id,
        ...(turnId ? { turnId } : {}),
      },
      dedupeKey: `outbound-message:${message.id}`,
    });
  }));
  const outboundRepaired = outboundResults.filter((result) => result.isNew).length;

  return {
    inboundFound: inbound.length,
    inboundRepaired,
    outboundFound: outbound.length,
    outboundRepaired,
  };
}

function getTurnId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const turnId = (payload as Record<string, unknown>).turnId;
  return typeof turnId === "string" && turnId.trim() ? turnId : null;
}
