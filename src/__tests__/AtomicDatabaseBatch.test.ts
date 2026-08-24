import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const databaseMock = vi.hoisted(() => {
  const execute = vi.fn((statement: unknown) => ({ statement }));
  const batch = vi.fn(async (queries: readonly unknown[]) =>
    queries.map((_query, index) => ({ rows: [{ sequence: index + 1 }] })));
  return { execute, batch };
});

vi.mock("@/infrastructure/db/client", () => ({ db: databaseMock }));

import { neonHttpAtomicDatabaseBatch } from "@/infrastructure/db/atomic-database-batch";

describe("Neon HTTP atomic database batch", () => {
  it("constructs every statement first and submits the fixed list through one db.batch call", async () => {
    const results = await neonHttpAtomicDatabaseBatch.execute([
      { name: "first", statement: sql`select 1 as sequence` },
      { name: "second", statement: sql`select 2 as sequence` },
      { name: "third", statement: sql`select 3 as sequence` },
    ]);

    expect(databaseMock.execute).toHaveBeenCalledTimes(3);
    expect(databaseMock.batch).toHaveBeenCalledOnce();
    expect(databaseMock.batch.mock.calls[0]?.[0]).toEqual([
      databaseMock.execute.mock.results[0]?.value,
      databaseMock.execute.mock.results[1]?.value,
      databaseMock.execute.mock.results[2]?.value,
    ]);
    expect(results).toEqual([
      { rows: [{ sequence: 1 }] },
      { rows: [{ sequence: 2 }] },
      { rows: [{ sequence: 3 }] },
    ]);
  });
});
