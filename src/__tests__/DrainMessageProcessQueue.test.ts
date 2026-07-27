import { describe, expect, it, vi } from "vitest";
import { drainMessageProcessQueue } from "@/application/jobs/drain-message-process-queue";
import type { JobRecord } from "@/application/ports/job-queue";

const job: JobRecord = {
  id: "job-1",
  queue: "message.process",
  status: "processing",
  payload: { inboundEventId: "event-1" },
  dedupeKey: "inbound-event:event-1",
  attempts: 1,
  maxAttempts: 3,
  runAt: new Date("2026-06-23T12:00:00.000Z"),
  lockedAt: new Date("2026-06-23T12:00:00.000Z"),
  lockedBy: "worker-1",
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
      failJob: vi.fn(),
    },
    inboundEventStore: {
      markInboundEventPending: vi.fn().mockResolvedValue(undefined),
      markInboundEventFailed: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("drainMessageProcessQueue", () => {
  it("processa dez tenants no mesmo lote sem cruzar seus eventos", async () => {
    const tenantJobs = Array.from({ length: 10 }, (_, index): JobRecord => ({
      ...job,
      id: `job-${index + 1}`,
      payload: {
        inboundEventId: `event-${index + 1}`,
        clinicId: `clinic-${index + 1}`,
      },
      dedupeKey: `inbound-event:event-${index + 1}`,
    }));
    const claimed = [...tenantJobs];
    const processed: Array<{ eventId: string; clinicId: string }> = [];
    const jobQueue = {
      recoverStaleJobs: vi.fn().mockResolvedValue(0),
      claimNextJob: vi.fn(async () => claimed.shift() ?? null),
      completeJob: vi.fn().mockResolvedValue(true),
      failJob: vi.fn(),
    };

    const result = await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore: {
        markInboundEventPending: vi.fn(),
        markInboundEventFailed: vi.fn(),
      },
      handler: {
        processJob: vi.fn(async (claimedJob: JobRecord) => {
          const payload = claimedJob.payload as {
            inboundEventId: string;
            clinicId: string;
          };
          processed.push({
            eventId: payload.inboundEventId,
            clinicId: payload.clinicId,
          });
          return {
            outcome: "processed" as const,
            inboundEventId: payload.inboundEventId,
          };
        }),
      },
      workerId: "worker-ten-tenants",
      maxJobs: 10,
      now: new Date("2026-07-27T12:00:00.000Z"),
    } as never);

    expect(result).toMatchObject({ claimed: 10, processed: 10, dead: 0 });
    expect(new Set(processed.map((item) => item.eventId)).size).toBe(10);
    expect(new Set(processed.map((item) => item.clinicId)).size).toBe(10);
    expect(jobQueue.completeJob).toHaveBeenCalledTimes(10);
  });

  it("conclui o job após o handler processar o evento", async () => {
    const deps = makeDeps();

    const result = await drainMessageProcessQueue({
      ...deps,
      handler: { processJob: vi.fn().mockResolvedValue({ outcome: "processed", inboundEventId: "event-1" }) },
      workerId: "worker-1",
      maxJobs: 3,
      now: new Date("2026-06-23T12:00:00.000Z"),
    } as never);

    expect(result).toMatchObject({ claimed: 1, processed: 1, retried: 0, dead: 0 });
    expect(deps.jobQueue.completeJob).toHaveBeenCalledWith("job-1", "worker-1", expect.any(Date));
  });

  it("agenda retry e devolve o inbound para pending quando o handler falha", async () => {
    const deps = makeDeps();
    deps.jobQueue.failJob.mockResolvedValue("pending");

    const result = await drainMessageProcessQueue({
      ...deps,
      handler: { processJob: vi.fn().mockRejectedValue(new Error("OpenAI timeout")) },
      workerId: "worker-1",
      maxJobs: 1,
      now: new Date("2026-06-23T12:00:00.000Z"),
    } as never);

    expect(result).toMatchObject({ retried: 1, dead: 0 });
    expect(deps.jobQueue.failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        job,
        workerId: "worker-1",
        error: "OpenAI timeout",
        retryAt: new Date("2026-06-23T12:00:05.000Z"),
      }),
    );
    expect(deps.inboundEventStore.markInboundEventPending).toHaveBeenCalledWith("event-1");
  });

  it("marca o inbound como failed quando a última tentativa morre", async () => {
    const deps = makeDeps();
    deps.jobQueue.failJob.mockResolvedValue("dead");

    const result = await drainMessageProcessQueue({
      ...deps,
      handler: { processJob: vi.fn().mockRejectedValue(new Error("permanent failure")) },
      workerId: "worker-1",
      maxJobs: 1,
      now: new Date("2026-06-23T12:00:00.000Z"),
    } as never);

    expect(result).toMatchObject({ retried: 0, dead: 1 });
    expect(deps.inboundEventStore.markInboundEventFailed).toHaveBeenCalledWith("event-1");
  });

  it("não reabre o job quando só a confirmação após processamento falha", async () => {
    const deps = makeDeps();
    deps.jobQueue.completeJob.mockRejectedValue(new Error("database response lost"));

    const result = await drainMessageProcessQueue({
      ...deps,
      handler: { processJob: vi.fn().mockResolvedValue({ outcome: "processed", inboundEventId: "event-1" }) },
      workerId: "worker-1",
      maxJobs: 1,
    } as never);

    expect(result).toMatchObject({ claimed: 1, processed: 0, retried: 0, dead: 0 });
    expect(deps.jobQueue.failJob).not.toHaveBeenCalled();
    expect(deps.inboundEventStore.markInboundEventPending).not.toHaveBeenCalled();
  });
});
