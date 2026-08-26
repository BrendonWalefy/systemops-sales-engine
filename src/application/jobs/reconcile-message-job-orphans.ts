import type { JobQueue } from "@/application/ports/job-queue";
import type { MessageJobOrphanReader } from "@/application/ports/message-job-orphan-reader";
import type { WhatsAppStreamAuthority } from "@/application/ports/whatsapp-stream-authority";

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
  streamAuthority?: WhatsAppStreamAuthority;
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
    ? await input.reader.listInboundAuthorityCandidates({ olderThan, limit })
    : [];
  const outbound = queues.has("message.send")
    ? await input.reader.listOutboundWithoutJob({ olderThan, limit })
    : [];

  if (inbound.length > 0 && !input.streamAuthority) {
    throw new Error("inbound orphan reconciliation requires durable stream authority");
  }
  let inboundRepaired = 0;
  for (const event of inbound) {
    const repaired = await input.streamAuthority!.repairInboundAuthorityJob({
      inboundEventId: event.id,
      now,
      olderThan,
    });
    if (repaired.outcome === "created" || repaired.outcome === "rebound") {
      inboundRepaired++;
    }
  }

  const outboundResults = await Promise.all(outbound.map((message) => {
    const turnId = getTurnId(message.payload);
    return input.jobQueue.enqueueJob({
      queue: "message.send",
      payload: {
        outboundMessageId: message.id,
        ...(turnId ? { turnId } : {}),
      },
      dedupeKey: `outbound-message:${message.id}`,
      maxAttempts: 10,
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
