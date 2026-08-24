import type { SQL } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";

export type AtomicDatabaseBatchStep = Readonly<{
  name: string;
  statement: SQL;
}>;

export type AtomicDatabaseBatchResult = Readonly<{
  rows: readonly Record<string, unknown>[];
}>;

export interface AtomicDatabaseBatch {
  execute(
    steps: readonly AtomicDatabaseBatchStep[],
  ): Promise<readonly AtomicDatabaseBatchResult[]>;
}

/** Executes a fixed query list as Neon's non-interactive HTTP transaction. */
export const neonHttpAtomicDatabaseBatch: AtomicDatabaseBatch = {
  async execute(steps) {
    if (steps.length === 0) {
      throw new Error("atomic database batch requires at least one statement");
    }

    const queries = steps.map(({ statement }) =>
      db.execute<Record<string, unknown>>(statement));
    const results = await db.batch(
      queries as [typeof queries[number], ...typeof queries[number][]],
    );
    return results.map((result) => ({ rows: result.rows }));
  },
};
