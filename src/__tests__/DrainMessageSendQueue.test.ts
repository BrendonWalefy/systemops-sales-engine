import { describe, expect, it, vi } from "vitest";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import type { JobRecord } from "@/application/ports/job-queue";

const job: JobRecord = {
  id: "send-job-1",
  queue: "message.send",
  status: "processing",
  payload: { outboundMessageId: "outbound-1" },
  dedupeKey: "outbound-message:outbound-1",
  attempts: 1,
  maxAttempts: 3,
  runAt: new Date("2026-06-23T12:00:00.000Z"),
  lockedAt: new Date("2026-06-23T12:00:00.000Z"),
  lockedBy: "sender-1",
  lastError: null,
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  updatedAt: new Date("2026-06-23T12:00:00.000Z"),
};

function makeDeps() {
  return {
    jobQueue: {
      recoverStaleJobs: vi.fn().mockResolvedValue(0),
      claimNextJob: vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null),
      completeJob: vi.fn().mockResolvedValue(true),
      releaseJob: vi.fn().mockResolvedValue(true),
      failJob: vi.fn(),
    },
    outboundMessageStore: {
      markOutboundPending: vi.fn().mockResolvedValue(undefined),
      markOutboundDead: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("drainMessageSendQueue", () => {
  it("libera o job sem consumir tentativa quando a ordem da conversa ainda não permite envio", async () => {
    const deps = makeDeps();
    const result = await drainMessageSendQueue({
      ...deps,
      handler: { processJob: vi.fn().mockResolvedValue("deferred") },
      workerId: "sender-1",
      maxJobs: 1,
      now: new Date("2026-06-23T12:00:00.000Z"),
    } as never);

    expect(result).toMatchObject({ deferred: 1, sent: 0 });
    expect(deps.jobQueue.releaseJob).toHaveBeenCalledWith(
      "send-job-1",
      "sender-1",
      expect.any(Date),
    );
    expect(deps.jobQueue.completeJob).not.toHaveBeenCalled();
  });

  it("retenta falha técnica e devolve a outbox para pending", async () => {
    const deps = makeDeps();
    deps.jobQueue.failJob.mockResolvedValue("pending");
    const result = await drainMessageSendQueue({
      ...deps,
      handler: { processJob: vi.fn().mockRejectedValue(new Error("Z-API timeout")) },
      workerId: "sender-1",
      maxJobs: 1,
      now: new Date("2026-06-23T12:00:00.000Z"),
    } as never);

    expect(result).toMatchObject({ retried: 1, dead: 0 });
    expect(deps.outboundMessageStore.markOutboundPending).toHaveBeenCalledWith("outbound-1", "Z-API timeout");
  });

  it("marca a outbox como dead depois da última tentativa", async () => {
    const deps = makeDeps();
    deps.jobQueue.failJob.mockResolvedValue("dead");
    const result = await drainMessageSendQueue({
      ...deps,
      handler: { processJob: vi.fn().mockRejectedValue(new Error("credentials revoked")) },
      workerId: "sender-1",
      maxJobs: 1,
    } as never);

    expect(result).toMatchObject({ dead: 1, retried: 0 });
    expect(deps.outboundMessageStore.markOutboundDead).toHaveBeenCalledWith("outbound-1", "credentials revoked");
  });

  it("não reabre a outbox quando só o acknowledge falha depois de enviar", async () => {
    const deps = makeDeps();
    deps.jobQueue.completeJob.mockRejectedValue(new Error("response lost"));
    const result = await drainMessageSendQueue({
      ...deps,
      handler: { processJob: vi.fn().mockResolvedValue("sent") },
      workerId: "sender-1",
      maxJobs: 1,
    } as never);

    expect(result).toMatchObject({ sent: 0, retried: 0, dead: 0 });
    expect(deps.jobQueue.failJob).not.toHaveBeenCalled();
    expect(deps.outboundMessageStore.markOutboundPending).not.toHaveBeenCalled();
  });
});
