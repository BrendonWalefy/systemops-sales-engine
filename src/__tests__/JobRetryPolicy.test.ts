import { describe, expect, it } from "vitest";
import type { JobRecord } from "@/application/ports/job-queue";
import { getJobRetryAt, getJobRetryDelayMs } from "@/application/services/job-retry-policy";

const job: JobRecord = {
  id: "job-1",
  queue: "message.process",
  status: "processing",
  payload: {},
  dedupeKey: null,
  attempts: 1,
  maxAttempts: 10,
  runAt: new Date("2026-06-23T12:00:00.000Z"),
  lockedAt: new Date("2026-06-23T12:00:00.000Z"),
  lockedBy: "worker-1",
  lastError: null,
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  updatedAt: new Date("2026-06-23T12:00:00.000Z"),
};

describe("job retry policy", () => {
  it("uses exponential delays from the attempt that just failed", () => {
    expect(getJobRetryDelayMs(1)).toBe(5_000);
    expect(getJobRetryDelayMs(2)).toBe(10_000);
    expect(getJobRetryDelayMs(3)).toBe(20_000);
  });

  it("caps retries to prevent an unbounded wait", () => {
    expect(getJobRetryDelayMs(20)).toBe(15 * 60_000);
  });

  it("schedules retry relative to the worker clock, not the original run time", () => {
    const now = new Date("2026-06-23T12:30:00.000Z");
    expect(getJobRetryAt(job, now)).toEqual(new Date("2026-06-23T12:30:05.000Z"));
  });
});
