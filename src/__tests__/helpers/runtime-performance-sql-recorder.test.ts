import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupEmbeddedAuthorityDatabase,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "./embedded-authority-database";
import {
  installRuntimePerformanceSqlRecorder,
  summarizeSqlIntervals,
  type SqlInterval,
} from "./runtime-performance-sql-recorder";

describe("runtime performance SQL interval summary", () => {
  it("counts overlapping statements as one sequential round trip", () => {
    const intervals: SqlInterval[] = [
      { startedAt: 0, endedAt: 4, lockBearing: false, transactionId: null },
      { startedAt: 1, endedAt: 3, lockBearing: false, transactionId: null },
      { startedAt: 5, endedAt: 7, lockBearing: false, transactionId: null },
    ];

    expect(summarizeSqlIntervals(intervals, [])).toEqual({
      statements: 3,
      sequentialRoundTrips: 2,
      lockHoldMs: 0,
    });
  });

  it("uses the observed lock-to-transaction-end interval", () => {
    const intervals: SqlInterval[] = [
      { startedAt: 10, endedAt: 12, lockBearing: true, transactionId: 1 },
      { startedAt: 13, endedAt: 14, lockBearing: false, transactionId: 1 },
    ];

    expect(summarizeSqlIntervals(intervals, [
      { transactionId: 1, firstLockAt: 10, endedAt: 15 },
    ])).toEqual({ statements: 2, sequentialRoundTrips: 2, lockHoldMs: 5 });
  });
});

describe("runtime performance SQL dispatch recorder", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
  }, 30_000);

  afterAll(async () => {
    await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
  });

  it("records Pool.query and checked-out PoolClient.query once each", async () => {
    const recorder = installRuntimePerformanceSqlRecorder(runtime!.pool);
    try {
      recorder.beginTurn();
      await runtime!.pool.query("select 1");
      const client = await runtime!.pool.connect();
      try {
        await client.query("select 2");
      } finally {
        client.release();
      }

      expect(recorder.endTurn()).toMatchObject({
        statements: 2,
        sequentialRoundTrips: 2,
        lockHoldMs: 0,
      });
    } finally {
      recorder.restore();
    }
  });
});
