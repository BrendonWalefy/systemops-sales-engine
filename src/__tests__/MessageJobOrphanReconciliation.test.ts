import { describe, expect, it, vi } from "vitest";
import { reconcileMessageJobOrphans } from "@/application/jobs/reconcile-message-job-orphans";

function enqueued(queue: "message.process" | "message.send", dedupeKey: string) {
  return {
    job: {
      id: `job:${dedupeKey}`,
      queue,
      status: "pending" as const,
      payload: {},
      dedupeKey,
      attempts: 0,
      maxAttempts: 5,
      runAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    isNew: true,
  };
}

describe("reconcileMessageJobOrphans", () => {
  it("recria jobs idempotentes para inbound e outbox preservando turnId", async () => {
    // O caminho normal enfileira o inbound com run_at = recebimento + janela de
    // rajada. Se o job nunca chegou a ser criado, o reconciler tem que agendar
    // com a mesma aritmética — caso contrário órfãos "furam a fila" e respondem
    // sem a espera de agrupamento.
    const reader = {
      listInboundAuthorityCandidates: vi.fn().mockResolvedValue([{ id: "event-1" }]),
      listOutboundWithoutJob: vi.fn().mockResolvedValue([{
        id: "outbound-1",
        payload: { turnId: "turn-1" },
      }]),
    };
    const enqueueJob = vi.fn()
      .mockImplementationOnce(() => enqueued("message.send", "outbound-message:outbound-1"));
    const repairInboundAuthorityJob = vi.fn().mockResolvedValue({
      outcome: "created",
      jobId: "job:inbound-event:event-1",
    });

    const result = await reconcileMessageJobOrphans({
      reader,
      jobQueue: { enqueueJob } as never,
      streamAuthority: { repairInboundAuthorityJob } as never,
      now: new Date("2026-07-26T12:00:00.000Z"),
      minimumAgeMs: 60_000,
    });

    expect(reader.listInboundAuthorityCandidates).toHaveBeenCalledWith({
      olderThan: new Date("2026-07-26T11:59:00.000Z"),
      limit: 25,
    });
    expect(repairInboundAuthorityJob).toHaveBeenCalledWith({
      inboundEventId: "event-1",
      now: new Date("2026-07-26T12:00:00.000Z"),
      olderThan: new Date("2026-07-26T11:59:00.000Z"),
    });
    expect(enqueueJob).toHaveBeenNthCalledWith(1, {
      queue: "message.send",
      payload: { outboundMessageId: "outbound-1", turnId: "turn-1" },
      dedupeKey: "outbound-message:outbound-1",
      maxAttempts: 10,
    });
    expect(result).toEqual({
      inboundFound: 1,
      inboundRepaired: 1,
      outboundFound: 1,
      outboundRepaired: 1,
    });
  });

  it("permite ao sender reconciliar somente a outbox", async () => {
    const reader = {
      listInboundAuthorityCandidates: vi.fn(),
      listOutboundWithoutJob: vi.fn().mockResolvedValue([]),
    };

    await reconcileMessageJobOrphans({
      reader,
      jobQueue: { enqueueJob: vi.fn() } as never,
      queues: ["message.send"],
    });

    expect(reader.listInboundAuthorityCandidates).not.toHaveBeenCalled();
    expect(reader.listOutboundWithoutJob).toHaveBeenCalledOnce();
  });
});
