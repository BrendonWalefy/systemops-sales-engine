import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanupEmbeddedAuthorityDatabase,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "@/__tests__/helpers/embedded-authority-database";

const databaseMock = vi.hoisted(() => {
  let activeDb: unknown;
  const proxy = new Proxy({}, {
    get(_target, property) {
      if (!activeDb) throw new Error("database test client is not initialized");
      const value = (activeDb as Record<PropertyKey, unknown>)[property];
      return typeof value === "function" ? value.bind(activeDb) : value;
    },
  });
  return {
    proxy,
    set(value: unknown) {
      activeDb = value;
    },
  };
});

vi.mock("@/infrastructure/db/client", () => ({ db: databaseMock.proxy }));

type RuntimeControl = Readonly<{
  liveOutboundEnabled: boolean;
  version: number;
}>;

type RuntimeControlStore = Readonly<{
  getGlobal(): Promise<RuntimeControl>;
  compareAndSetGlobal(input: Readonly<{
    expectedVersion: number;
    liveOutboundEnabled: boolean;
    actor: string;
    now: Date;
  }>): Promise<boolean>;
}>;

type RuntimeControlStoreModule = Readonly<{
  DrizzleConversationRuntimeControlStore: new () => RuntimeControlStore;
}>;

type TestDatabase = ReturnType<typeof drizzleNodePostgres>;

async function loadRuntimeControlStore(): Promise<RuntimeControlStore> {
  const modulePath = "@/infrastructure/repositories/drizzle-conversation-runtime-control-store";
  const importedStore = await vi.importActual<RuntimeControlStoreModule>(modulePath);
  return new importedStore.DrizzleConversationRuntimeControlStore();
}

function databaseError(error: unknown): Readonly<{
  code?: string;
  constraint?: string;
}> {
  const direct = error as { code?: string; constraint?: string; cause?: unknown };
  const cause = direct.cause as { code?: string; constraint?: string } | undefined;
  return {
    code: cause?.code ?? direct.code,
    constraint: cause?.constraint ?? direct.constraint,
  };
}

async function captureDatabaseError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    return databaseError(error);
  }
  throw new Error("expected PostgreSQL to reject the invalid runtime control row");
}

describe("V2-only global runtime control — PostgreSQL adapter", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let database: TestDatabase;

  async function resetControl(): Promise<void> {
    await database.execute(sql`delete from conversation_runtime_control`);
  }

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    database = drizzleNodePostgres(runtime.pool);
    databaseMock.set(database);
    await migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
  });

  afterAll(async () => {
    try {
      await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
    } finally {
      databaseMock.set(undefined);
    }
  });

  it("fails closed with version zero when the singleton row is absent", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();

    await expect(store.getGlobal()).resolves.toEqual({
      liveOutboundEnabled: false,
      version: 0,
    });
  });

  it("defaults the only valid singleton row to closed at version one", async () => {
    await resetControl();
    await database.execute(sql`
      insert into conversation_runtime_control (key, updated_by)
      values ('global', 'schema-default-test')
    `);

    const result = await database.execute<{
      key: string;
      live_outbound_enabled: boolean;
      version: string;
    }>(sql`
      select key, live_outbound_enabled, version
      from conversation_runtime_control
    `);
    expect(result.rows).toEqual([{
      key: "global",
      live_outbound_enabled: false,
      version: "1",
    }]);
  });

  it("enforces the global singleton key and positive durable version", async () => {
    await resetControl();
    await database.execute(sql`
      insert into conversation_runtime_control (key, updated_by)
      values ('global', 'singleton-test')
    `);

    expect(await captureDatabaseError(async () => {
      await database.execute(sql`
        insert into conversation_runtime_control (key, updated_by)
        values ('global', 'duplicate-test')
      `);
    })).toEqual({
      code: "23505",
      constraint: "conversation_runtime_control_pkey",
    });
    expect(await captureDatabaseError(async () => {
      await database.execute(sql`
        insert into conversation_runtime_control (key, updated_by)
        values ('tenant-scoped', 'invalid-key-test')
      `);
    })).toEqual({
      code: "23514",
      constraint: "conversation_runtime_control_global_key_check",
    });
    expect(await captureDatabaseError(async () => {
      await database.execute(sql`
        update conversation_runtime_control
        set version = 0
        where key = 'global'
      `);
    })).toEqual({
      code: "23514",
      constraint: "conversation_runtime_control_version_check",
    });
  });

  it("inserts only from expected version zero and records the caller metadata", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    const now = new Date("2026-08-25T18:00:00.000Z");

    await expect(store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: true,
      actor: "runtime-control-test",
      now,
    })).resolves.toBe(true);
    await expect(store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: false,
      actor: "stale-insert-test",
      now: new Date("2026-08-25T18:01:00.000Z"),
    })).resolves.toBe(false);

    const result = await database.execute<{
      live_outbound_enabled: boolean;
      version: string;
      updated_at_matches: boolean;
      updated_by: string;
    }>(sql`
      select
        live_outbound_enabled,
        version,
        updated_at = ${now.toISOString()}::timestamptz as updated_at_matches,
        updated_by
      from conversation_runtime_control
      where key = 'global'
    `);
    expect(result.rows).toEqual([{
      live_outbound_enabled: true,
      version: "1",
      updated_at_matches: true,
      updated_by: "runtime-control-test",
    }]);
  });

  it("advances exactly one version and rejects a stale compare-and-set", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    await store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: false,
      actor: "version-one",
      now: new Date("2026-08-25T18:00:00.000Z"),
    });

    await expect(store.compareAndSetGlobal({
      expectedVersion: 1,
      liveOutboundEnabled: true,
      actor: "version-two",
      now: new Date("2026-08-25T18:01:00.000Z"),
    })).resolves.toBe(true);
    await expect(store.compareAndSetGlobal({
      expectedVersion: 1,
      liveOutboundEnabled: false,
      actor: "stale-version-one",
      now: new Date("2026-08-25T18:02:00.000Z"),
    })).resolves.toBe(false);
    await expect(store.compareAndSetGlobal({
      expectedVersion: 2,
      liveOutboundEnabled: false,
      actor: "version-three",
      now: new Date("2026-08-25T18:03:00.000Z"),
    })).resolves.toBe(true);
    await expect(store.getGlobal()).resolves.toEqual({
      liveOutboundEnabled: false,
      version: 3,
    });
  });

  it("allows only one concurrent writer for the same expected version", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    await store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: false,
      actor: "concurrency-base",
      now: new Date("2026-08-25T18:00:00.000Z"),
    });
    const attempts = [
      { liveOutboundEnabled: true, actor: "concurrent-open" },
      { liveOutboundEnabled: false, actor: "concurrent-close" },
    ] as const;

    const outcomes = await Promise.all(attempts.map(async (attempt) => ({
      ...attempt,
      updated: await store.compareAndSetGlobal({
        expectedVersion: 1,
        ...attempt,
        now: new Date("2026-08-25T18:01:00.000Z"),
      }),
    })));

    expect(outcomes.map((outcome) => outcome.updated).sort()).toEqual([false, true]);
    const winner = outcomes.find((outcome) => outcome.updated)!;
    await expect(store.getGlobal()).resolves.toEqual({
      liveOutboundEnabled: winner.liveOutboundEnabled,
      version: 2,
    });
  });

  it("propagates an unreadable singleton instead of converting it to an open state", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    await database.execute(sql`
      alter table conversation_runtime_control
      rename to conversation_runtime_control_unreadable_test
    `);
    try {
      await expect(store.getGlobal()).rejects.toBeDefined();
    } finally {
      await database.execute(sql`
        alter table conversation_runtime_control_unreadable_test
        rename to conversation_runtime_control
      `);
    }
  });

  it("never mutates tenant rows while changing the global control", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    const tenantIds = [randomUUID(), randomUUID()];
    await database.execute(sql`
      insert into organizations (
        id, name, slug, specialty, auto_reply_enabled, operational_status, is_test
      ) values
        (${tenantIds[0]}::uuid, 'Runtime tenant A', ${`runtime-tenant-a-${tenantIds[0]}`} , 'dental', false, 'paused', false),
        (${tenantIds[1]}::uuid, 'Runtime tenant B', ${`runtime-tenant-b-${tenantIds[1]}`} , 'dental', true, 'test', true)
    `);
    const before = await database.execute<Record<string, unknown>>(sql`
      select * from organizations
      where id in (${tenantIds[0]}::uuid, ${tenantIds[1]}::uuid)
      order by id
    `);

    await store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: true,
      actor: "global-only-test",
      now: new Date("2026-08-25T18:00:00.000Z"),
    });
    await store.compareAndSetGlobal({
      expectedVersion: 1,
      liveOutboundEnabled: false,
      actor: "global-only-test",
      now: new Date("2026-08-25T18:01:00.000Z"),
    });

    const after = await database.execute<Record<string, unknown>>(sql`
      select * from organizations
      where id in (${tenantIds[0]}::uuid, ${tenantIds[1]}::uuid)
      order by id
    `);
    expect(after.rows).toEqual(before.rows);
  });
});
