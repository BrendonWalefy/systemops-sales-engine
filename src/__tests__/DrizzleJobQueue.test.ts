import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const dbMock = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  $with: vi.fn(),
  with: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";

const existingJob = {
  id: "job-1",
  queue: "message.process" as const,
  status: "pending" as const,
  payload: { inboundEventId: "event-1" },
  dedupeKey: "inbound:event-1",
  attempts: 0,
  maxAttempts: 10,
  runAt: new Date("2026-06-23T12:00:00.000Z"),
  lockedAt: null,
  lockedBy: null,
  lastError: null,
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  updatedAt: new Date("2026-06-23T12:00:00.000Z"),
};

function insertConflictChain() {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };
}

function selectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

function updateChain(rows: unknown[]) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
}

describe("DrizzleJobQueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the existing job when enqueue conflicts on its queue dedupe key", async () => {
    dbMock.insert.mockReturnValue(insertConflictChain());
    dbMock.select.mockReturnValue(selectChain([existingJob]));

    const result = await new DrizzleJobQueue().enqueueJob({
      queue: "message.process",
      payload: { inboundEventId: "event-1" },
      dedupeKey: "inbound:event-1",
    });

    expect(result).toMatchObject({ isNew: false, job: { id: "job-1" } });
    expect(dbMock.select).toHaveBeenCalledOnce();
  });

  it("claims through a locked CTE and increments attempts exactly once", async () => {
    const candidate = { id: {} };
    const candidateSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
    };
    const update = {
      set: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ ...existingJob, status: "processing", attempts: 1 }]),
    };
    dbMock.$with.mockReturnValue({ as: vi.fn().mockReturnValue(candidate) });
    dbMock.select.mockReturnValue(candidateSelect);
    dbMock.with.mockReturnValue({ update: vi.fn().mockReturnValue(update) });

    const claimed = await new DrizzleJobQueue().claimNextJob({
      queues: ["message.process"],
      workerId: "worker-1",
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(claimed).toMatchObject({ id: "job-1", status: "processing", attempts: 1 });
    expect(candidateSelect.for).toHaveBeenCalledWith("update", { skipLocked: true });
    expect(update.set).toHaveBeenCalledOnce();
  });

  it("claims only the requested dedupe key inside the same locked CTE", async () => {
    const candidate = { id: {} };
    const candidateSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
    };
    const update = {
      set: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{
        ...existingJob,
        dedupeKey: "inbound:event-wanted",
        status: "processing",
        attempts: 1,
      }]),
    };
    dbMock.$with.mockReturnValue({ as: vi.fn().mockReturnValue(candidate) });
    dbMock.select.mockReturnValue(candidateSelect);
    dbMock.with.mockReturnValue({ update: vi.fn().mockReturnValue(update) });
    const wanted = "inbound:event-wanted";

    const claimed = await new DrizzleJobQueue().claimNextJob({
      queues: ["message.process"],
      workerId: "lab-runner-1",
      dedupeKey: wanted,
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(claimed?.dedupeKey).toBe(wanted);
    const predicate = candidateSelect.where.mock.calls[0]?.[0];
    const query = new PgDialect().sqlToQuery(sql`select 1 where ${predicate}`);
    expect(query.sql).toContain("dedupe_key");
    expect(query.params).toContain(wanted);
    expect(candidateSelect.for).toHaveBeenCalledWith("update", { skipLocked: true });
    expect(update.set).toHaveBeenCalledOnce();
  });

  it("returns failed work to pending with the supplied retry time", async () => {
    const update = updateChain([{ status: "pending" }]);
    dbMock.update.mockReturnValue(update);
    const retryAt = new Date("2026-06-23T12:00:05.000Z");

    const status = await new DrizzleJobQueue().failJob({
      job: { ...existingJob, status: "processing", attempts: 1, lockedBy: "worker-1" },
      workerId: "worker-1",
      error: "provider timeout",
      retryAt,
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(status).toBe("pending");
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", runAt: retryAt, lastError: "provider timeout" }),
    );
  });

  it("marks work dead after its final permitted attempt", async () => {
    const update = updateChain([{ status: "dead" }]);
    dbMock.update.mockReturnValue(update);

    const status = await new DrizzleJobQueue().failJob({
      job: {
        ...existingJob,
        status: "processing",
        attempts: existingJob.maxAttempts,
        lockedBy: "worker-1",
      },
      workerId: "worker-1",
      error: "permanent failure",
      retryAt: new Date("2026-06-23T12:00:05.000Z"),
    });

    expect(status).toBe("dead");
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dead", runAt: existingJob.runAt }),
    );
  });
});
