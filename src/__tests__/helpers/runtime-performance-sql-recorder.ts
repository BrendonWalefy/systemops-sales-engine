import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { Pool, PoolClient, QueryResult } from "pg";

export type SqlInterval = Readonly<{
  startedAt: number;
  endedAt: number;
  lockBearing: boolean;
  transactionId: number | null;
}>;

type TransactionInterval = Readonly<{
  transactionId: number;
  firstLockAt: number | null;
  endedAt: number;
}>;

export type SqlTurnMetrics = Readonly<{
  statements: number;
  sequentialRoundTrips: number;
  lockHoldMs: number;
}>;

function sqlText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "text" in input) {
    const text = (input as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function normalizedSql(input: unknown): string {
  return sqlText(input).trim().replace(/\s+/g, " ").toLowerCase();
}

function isLockBearing(input: unknown): boolean {
  const sql = normalizedSql(input);
  return /\bfor (?:no key )?(?:update|share)\b/.test(sql)
    || /\bskip locked\b/.test(sql)
    || /^(?:with\b[\s\S]*\b)?(?:insert|update|delete)\b/.test(sql)
    || /\b(?:insert into|update|delete from)\b/.test(sql);
}

export function summarizeSqlIntervals(
  intervals: readonly SqlInterval[],
  transactions: readonly TransactionInterval[],
): SqlTurnMetrics {
  const ordered = [...intervals].sort((left, right) => left.startedAt - right.startedAt);
  let sequentialRoundTrips = 0;
  let waveEnd = -Infinity;
  for (const interval of ordered) {
    if (interval.startedAt >= waveEnd) sequentialRoundTrips += 1;
    waveEnd = Math.max(waveEnd, interval.endedAt);
  }
  const transactionLocks = transactions
    .filter((transaction) => transaction.firstLockAt !== null)
    .map((transaction) => Math.max(0, transaction.endedAt - transaction.firstLockAt!));
  const standaloneLocks = ordered
    .filter((interval) => interval.lockBearing && interval.transactionId === null)
    .map((interval) => Math.max(0, interval.endedAt - interval.startedAt));
  return {
    statements: ordered.length,
    sequentialRoundTrips,
    lockHoldMs: Math.max(0, ...transactionLocks, ...standaloneLocks),
  };
}

export function installRuntimePerformanceSqlRecorder(pool: Pool): Readonly<{
  beginTurn(): void;
  endTurn(): SqlTurnMetrics;
  restore(): void;
}> {
  const originalPoolQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  const poolQueryContext = new AsyncLocalStorage<boolean>();
  const wrappedClients = new WeakSet<PoolClient>();
  const intervals: SqlInterval[] = [];
  const transactions: TransactionInterval[] = [];
  const activeTransactions = new WeakMap<PoolClient, { id: number; firstLockAt: number | null }>();
  let recording = false;
  let transactionSequence = 0;

  async function record<T>(input: unknown, transactionId: number | null, query: () => Promise<T>): Promise<T> {
    if (!recording) return query();
    const startedAt = performance.now();
    try {
      return await query();
    } finally {
      intervals.push({
        startedAt,
        endedAt: performance.now(),
        lockBearing: isLockBearing(input),
        transactionId,
      });
    }
  }

  function wrapClient(client: PoolClient): PoolClient {
    if (wrappedClients.has(client)) return client;
    wrappedClients.add(client);
    const originalClientQuery = client.query.bind(client);
    client.query = ((...args: unknown[]) => {
      const command = normalizedSql(args[0]);
      if (command === "begin" || command.startsWith("begin ")) {
        activeTransactions.set(client, { id: ++transactionSequence, firstLockAt: null });
      }
      const active = activeTransactions.get(client) ?? null;
      if (poolQueryContext.getStore()) {
        return originalClientQuery(...args as Parameters<PoolClient["query"]>);
      }
      const startedAt = performance.now();
      if (recording && active && isLockBearing(args[0]) && active.firstLockAt === null) {
        active.firstLockAt = startedAt;
      }
      const result = record(
        args[0],
        active?.id ?? null,
        () => originalClientQuery(
          ...args as Parameters<PoolClient["query"]>,
        ) as unknown as Promise<QueryResult>,
      );
      return result.finally(() => {
        if ((command === "commit" || command === "rollback") && active) {
          if (recording) {
            transactions.push({
              transactionId: active.id,
              firstLockAt: active.firstLockAt,
              endedAt: performance.now(),
            });
          }
          activeTransactions.delete(client);
        }
      });
    }) as PoolClient["query"];
    return client;
  }

  pool.query = ((...args: unknown[]) => record(
    args[0],
    null,
    () => poolQueryContext.run(
      true,
      () => originalPoolQuery(
        ...args as Parameters<Pool["query"]>,
      ) as unknown as Promise<QueryResult>,
    ),
  )) as Pool["query"];

  pool.connect = ((callback?: unknown) => {
    if (typeof callback === "function") {
      const invoke = callback as (...args: unknown[]) => unknown;
      return (originalConnect as unknown as (
        done: (...args: unknown[]) => void,
      ) => void)((...args: unknown[]) => {
        const client = args[1];
        if (client && typeof client === "object") wrapClient(client as PoolClient);
        invoke(...args);
      });
    }
    return originalConnect().then(wrapClient);
  }) as Pool["connect"];

  return Object.freeze({
    beginTurn() {
      if (recording) throw new Error("SQL turn recorder is already active");
      intervals.length = 0;
      transactions.length = 0;
      recording = true;
    },
    endTurn() {
      if (!recording) throw new Error("SQL turn recorder is not active");
      recording = false;
      return summarizeSqlIntervals(intervals, transactions);
    },
    restore() {
      recording = false;
      pool.query = originalPoolQuery as Pool["query"];
      pool.connect = originalConnect as Pool["connect"];
    },
  });
}
