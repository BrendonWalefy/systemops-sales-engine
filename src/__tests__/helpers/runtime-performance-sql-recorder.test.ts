import { EventEmitter } from "node:events";
import type EmbeddedPostgres from "embedded-postgres";
import type { Pool } from "pg";
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
  it("waits for checked-in client sockets before stopping embedded PostgreSQL", async () => {
    const events: string[] = [];
    const poolEvents = new EventEmitter();
    const pool = Object.assign(poolEvents, {
      totalCount: 1,
      async end() {
        events.push("pool.end");
        setTimeout(() => {
          events.push("client.remove");
          poolEvents.emit("remove");
        }, 10);
      },
    }) as unknown as Pool;
    const embedded = {
      async stop() {
        events.push("embedded.stop");
      },
    } as unknown as EmbeddedPostgres;

    await cleanupEmbeddedAuthorityDatabase({ pool, embedded });

    expect(events).toEqual(["pool.end", "client.remove", "embedded.stop"]);
  });

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

  it("uses the observed authority-acquisition-completion to transaction-end interval", () => {
    const intervals: SqlInterval[] = [
      { startedAt: 10, endedAt: 12, lockBearing: true, transactionId: 1 },
      { startedAt: 13, endedAt: 14, lockBearing: false, transactionId: 1 },
    ];

    expect(summarizeSqlIntervals(intervals, [
      { transactionId: 1, firstAuthorityCompletedAt: 12, endedAt: 15 },
    ])).toEqual({ statements: 2, sequentialRoundTrips: 2, lockHoldMs: 3 });
  });

  it("uses the observed authority statement duration as the autocommit upper bound", () => {
    const intervals: SqlInterval[] = [
      { startedAt: 20, endedAt: 27, lockBearing: true, transactionId: null },
    ];

    expect(summarizeSqlIntervals(intervals, [])).toEqual({
      statements: 1,
      sequentialRoundTrips: 1,
      lockHoldMs: 7,
    });
  });
});

describe("runtime performance SQL dispatch recorder", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    await runtime.pool.query("create table whatsapp_streams (id integer primary key, value integer not null)");
    await runtime.pool.query("insert into whatsapp_streams (id, value) values (1, 1)");
    await runtime.pool.query("create table runtime_unrelated_rows (id integer primary key, value integer not null)");
    await runtime.pool.query("insert into runtime_unrelated_rows (id, value) values (1, 1)");
    await runtime.pool.query("create table runtime_jobs (id integer primary key, stream_id integer not null references whatsapp_streams(id))");
    await runtime.pool.query("insert into runtime_jobs (id, stream_id) values (1, 1)");
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

  it("excludes unrelated DML from stream-authority lock hold", async () => {
    const recorder = installRuntimePerformanceSqlRecorder(runtime!.pool);
    try {
      recorder.beginTurn();
      await runtime!.pool.query("update runtime_unrelated_rows set value = value + 1 where id = 1");

      expect(recorder.endTurn()).toMatchObject({ statements: 1, lockHoldMs: 0 });
    } finally {
      recorder.restore();
    }
  });

  it("measures an explicit stream-authority transaction after acquisition completes", async () => {
    const recorder = installRuntimePerformanceSqlRecorder(runtime!.pool);
    const client = await runtime!.pool.connect();
    try {
      recorder.beginTurn();
      await client.query("begin");
      await client.query("select id from whatsapp_streams where id = 1 for update");
      await client.query("select pg_sleep(0.01)");
      await client.query("commit");

      const metrics = recorder.endTurn();
      expect(metrics.statements).toBe(4);
      expect(metrics.lockHoldMs).toBeGreaterThan(0);
    } finally {
      client.release();
      recorder.restore();
    }
  });

  it.each([
    "select id from whatsapp_streams where id = 1 for update of whatsapp_streams",
    "select authority_stream.id from whatsapp_streams authority_stream where authority_stream.id = 1 for update of authority_stream",
  ])("measures an explicit stream relation target: %s", async (query) => {
    const recorder = installRuntimePerformanceSqlRecorder(runtime!.pool);
    try {
      recorder.beginTurn();
      await runtime!.pool.query(query);

      expect(recorder.endTurn().lockHoldMs).toBeGreaterThan(0);
    } finally {
      recorder.restore();
    }
  });

  it.each([
    "select job.id from runtime_jobs job join whatsapp_streams stream on stream.id = job.stream_id where job.id = 1 for update of job",
    "select unrelated.id from runtime_unrelated_rows unrelated cross join whatsapp_streams authority_stream where unrelated.id = 1 for update of unrelated",
  ])("excludes a non-stream FOR UPDATE target: %s", async (query) => {
    const recorder = installRuntimePerformanceSqlRecorder(runtime!.pool);
    try {
      recorder.beginTurn();
      await runtime!.pool.query(query);

      expect(recorder.endTurn()).toMatchObject({ statements: 1, lockHoldMs: 0 });
    } finally {
      recorder.restore();
    }
  });

  it("measures an autocommit stream-authority mutation as an observed upper bound", async () => {
    const recorder = installRuntimePerformanceSqlRecorder(runtime!.pool);
    try {
      recorder.beginTurn();
      await runtime!.pool.query("update whatsapp_streams set value = value + 1 where id = 1");
      const metrics = recorder.endTurn();

      expect(metrics.statements).toBe(1);
      expect(metrics.lockHoldMs).toBeGreaterThan(0);
    } finally {
      recorder.restore();
    }
  });
});
