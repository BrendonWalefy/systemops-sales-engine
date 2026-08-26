import { describe, expect, it, vi } from "vitest";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import type { JobRecord } from "@/application/ports/job-queue";
import { V2TerminalHandoffRequiredError } from "@/application/conversation-v2/v2-terminal-failure-policy";

const job: JobRecord = {
  id: "send-job-1",
  queue: "message.send",
  status: "processing",
  payload: { outboundMessageId: "outbound-1" },
  dedupeKey: "outbound-message:outbound-1",
  attempts: 1,
  maxAttempts: 10,
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
      findOutboundMessage: vi.fn().mockResolvedValue({
        authorization: { kind: "live_stream_reply" },
      }),
      markOutboundPending: vi.fn().mockResolvedValue(undefined),
      markOutboundDead: vi.fn().mockResolvedValue(undefined),
    },
    terminalHandoffStore: {
      markForOutboundMessage: vi.fn().mockResolvedValue(true),
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

    expect(result).toMatchObject({
      deferred: 1,
      sent: 0,
      nextRunAt: new Date("2026-06-23T12:00:01.000Z"),
    });
    expect(deps.jobQueue.releaseJob).toHaveBeenCalledWith(
      "send-job-1",
      "sender-1",
      expect.any(Date),
    );
    expect(deps.jobQueue.completeJob).not.toHaveBeenCalled();
  });

  it("retains the earliest explicit run_at when several ordered jobs defer", async () => {
    const deps = makeDeps();
    deps.jobQueue.claimNextJob = vi.fn()
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({ ...job, id: "send-job-2" })
      .mockResolvedValue(null);

    const result = await drainMessageSendQueue({
      ...deps,
      handler: {
        processJob: vi.fn()
          .mockResolvedValueOnce({
            status: "deferred",
            runAt: new Date("2026-06-23T12:00:05.000Z"),
            reason: "quiet_hours",
          })
          .mockResolvedValueOnce({
            status: "deferred",
            runAt: new Date("2026-06-23T12:00:03.000Z"),
            reason: "earlier_message_active",
          }),
      },
      workerId: "sender-1",
      maxJobs: 2,
      now: new Date("2026-06-23T12:00:00.000Z"),
    } as never);

    expect(result.nextRunAt).toEqual(new Date("2026-06-23T12:00:03.000Z"));
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
    deps.jobQueue.claimNextJob.mockReset().mockResolvedValueOnce({
      ...job,
      attempts: 10,
    }).mockResolvedValue(null);
    deps.jobQueue.failJob.mockResolvedValue("dead");
    const result = await drainMessageSendQueue({
      ...deps,
      handler: { processJob: vi.fn().mockRejectedValue(new Error("credentials revoked")) },
      workerId: "sender-1",
      maxJobs: 1,
    } as never);

    expect(result).toMatchObject({ dead: 1, retried: 0 });
    expect(deps.terminalHandoffStore.markForOutboundMessage).toHaveBeenCalledWith({
      outboundMessageId: "outbound-1",
      sendJobId: "send-job-1",
      workerId: "sender-1",
      reason: "v2_terminal_delivery_failure",
      now: expect.any(Date),
    });
    expect(deps.outboundMessageStore.markOutboundDead).toHaveBeenCalledWith("outbound-1", "credentials revoked");
  });

  it("mantém a décima tentativa retryable quando o handoff terminal falha", async () => {
    const deps = makeDeps();
    deps.jobQueue.claimNextJob.mockReset().mockResolvedValueOnce({
      ...job,
      attempts: 10,
    }).mockResolvedValue(null);
    deps.terminalHandoffStore.markForOutboundMessage.mockRejectedValue(new Error("handoff unavailable"));

    const result = await drainMessageSendQueue({
      ...deps,
      handler: { processJob: vi.fn().mockRejectedValue(new Error("provider unavailable")) },
      workerId: "sender-1",
      maxJobs: 1,
      now: new Date("2026-06-23T12:00:00.000Z"),
    } as never);

    expect(result).toMatchObject({ retried: 1, dead: 0 });
    expect(deps.jobQueue.failJob).not.toHaveBeenCalled();
    expect(deps.jobQueue.releaseJob).toHaveBeenCalledWith(
      "send-job-1",
      "sender-1",
      new Date("2026-06-23T12:15:00.000Z"),
      expect.any(Date),
    );
    expect(deps.outboundMessageStore.markOutboundDead).not.toHaveBeenCalled();
  });

  it("não pausa a conversa por falha terminal de outbound que não pertence ao runtime live", async () => {
    const deps = makeDeps();
    deps.jobQueue.claimNextJob.mockReset().mockResolvedValueOnce({
      ...job,
      attempts: 10,
    }).mockResolvedValue(null);
    deps.jobQueue.failJob.mockResolvedValue("dead");
    deps.outboundMessageStore.findOutboundMessage.mockResolvedValue({
      authorization: { kind: "reminder" },
    });

    const result = await drainMessageSendQueue({
      ...deps,
      handler: { processJob: vi.fn().mockRejectedValue(new Error("provider unavailable")) },
      workerId: "sender-1",
      maxJobs: 1,
    } as never);

    expect(result).toMatchObject({ dead: 1, retried: 0 });
    expect(deps.terminalHandoffStore.markForOutboundMessage).not.toHaveBeenCalled();
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

  it("terminaliza sem novo envio quando a entrega ao provider fica indeterminada", async () => {
    const deps = makeDeps();
    deps.jobQueue.failJob.mockResolvedValue("dead");
    const processJob = vi.fn().mockRejectedValue(
      new V2TerminalHandoffRequiredError("delivery_outcome_indeterminate"),
    );

    const result = await drainMessageSendQueue({
      ...deps,
      handler: { processJob },
      workerId: "sender-1",
      maxJobs: 1,
    } as never);

    expect(result).toMatchObject({ dead: 1, retried: 0 });
    expect(processJob).toHaveBeenCalledOnce();
    expect(deps.terminalHandoffStore.markForOutboundMessage).toHaveBeenCalledWith({
      outboundMessageId: "outbound-1",
      sendJobId: "send-job-1",
      workerId: "sender-1",
      reason: "v2_terminal_delivery_failure",
      now: expect.any(Date),
    });
    expect(deps.outboundMessageStore.markOutboundDead).toHaveBeenCalledWith(
      "outbound-1",
      "v2_terminal_handoff_required:delivery_outcome_indeterminate",
    );
    expect(deps.jobQueue.failJob).toHaveBeenCalledWith(expect.objectContaining({
      forceDead: true,
      error: "v2_terminal_handoff_required:delivery_outcome_indeterminate",
    }));
  });
});
