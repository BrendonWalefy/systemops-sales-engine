import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import type { AtomicDatabaseBatch } from "@/infrastructure/db/atomic-database-batch";
import { resolveTestDatabaseAccess } from "@/infrastructure/db/test-database-policy";

const EMBEDDED_HOST = "127.0.0.1";
const EMBEDDED_USER = "postgres";
const EMBEDDED_PASSWORD = "pr306-test-password";
const EMBEDDED_DATABASE = "systemops_test";
const DEFAULT_DATABASE_URL = `postgresql://${EMBEDDED_USER}:${EMBEDDED_PASSWORD}@${EMBEDDED_HOST}:1/${EMBEDDED_DATABASE}`;

export type EmbeddedAuthorityDatabase = {
  dataDir: string;
  embedded: EmbeddedPostgres;
  pool: Pool;
};

export function createEmbeddedAtomicDatabaseBatch(
  pool: Pool,
  options: Readonly<{ failAfterStep?: string }> = {},
): AtomicDatabaseBatch {
  const dialect = new PgDialect();
  return {
    async execute(steps) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const results = [];
        for (const step of steps) {
          const query = dialect.sqlToQuery(step.statement);
          const result = await client.query(query.sql, query.params);
          results.push({ rows: result.rows as Record<string, unknown>[] });
          if (step.name === options.failAfterStep) {
            throw new Error(`forced embedded batch failure after ${step.name}`);
          }
        }
        await client.query("commit");
        return results;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export async function reserveAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, EMBEDDED_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to reserve an embedded PostgreSQL port")));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export async function cleanupEmbeddedAuthorityDatabase(
  runtime: Partial<EmbeddedAuthorityDatabase>,
): Promise<void> {
  try {
    if (runtime.pool) {
      const expectedRemovals = runtime.pool.totalCount;
      if (expectedRemovals === 0) {
        await runtime.pool.end();
      } else {
        let observedRemovals = 0;
        let resolveRemoved!: () => void;
        let rejectRemoved!: (error: Error) => void;
        const clientsRemoved = new Promise<void>((resolve, reject) => {
          resolveRemoved = resolve;
          rejectRemoved = reject;
        });
        const onRemove = () => {
          observedRemovals += 1;
          if (observedRemovals >= expectedRemovals) resolveRemoved();
        };
        runtime.pool.on("remove", onRemove);
        const timeout = setTimeout(() => {
          rejectRemoved(new Error(
            `embedded PostgreSQL pool removal timed out (${observedRemovals}/${expectedRemovals})`,
          ));
        }, 5_000);
        try {
          // pg-pool resolves end() after removing clients from its internal
          // list, just before each underlying socket emits its remove event.
          // Await the events so the server is never stopped in that gap.
          await runtime.pool.end();
          await clientsRemoved;
        } finally {
          clearTimeout(timeout);
          runtime.pool.off("remove", onRemove);
        }
      }
    }
  } finally {
    try {
      await runtime.embedded?.stop();
    } finally {
      if (runtime.dataDir) {
        await rm(runtime.dataDir, { recursive: true, force: true });
      }
    }
  }
}

export async function startEmbeddedAuthorityDatabase(): Promise<EmbeddedAuthorityDatabase> {
  const partial: Partial<EmbeddedAuthorityDatabase> = {};
  try {
    partial.dataDir = await mkdtemp(join(tmpdir(), "systemops-pr306-"));
    const configuredUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
    const testHost = process.env.TEST_DATABASE_HOST ?? EMBEDDED_HOST;
    const productionHost = process.env.PRODUCTION_DATABASE_HOST ?? "production.invalid";
    if (configuredUrl.hostname !== EMBEDDED_HOST || testHost !== EMBEDDED_HOST) {
      throw new Error("embedded authority tests require a loopback-only database host");
    }

    const port = await reserveAvailablePort();
    configuredUrl.port = String(port);
    const access = resolveTestDatabaseAccess({
      DATABASE_URL: configuredUrl.toString(),
      TEST_DATABASE_HOST: testHost,
      PRODUCTION_DATABASE_HOST: productionHost,
    });
    if (access.mode !== "authorized") {
      throw new Error(`embedded PostgreSQL rejected by test database policy: ${access.reason}`);
    }

    const databaseName = decodeURIComponent(configuredUrl.pathname.slice(1));
    const databaseUser = decodeURIComponent(configuredUrl.username);
    const databasePassword = decodeURIComponent(configuredUrl.password);
    partial.embedded = new EmbeddedPostgres({
      databaseDir: partial.dataDir,
      user: databaseUser,
      password: databasePassword,
      port,
      persistent: false,
      onLog: () => undefined,
      onError: () => undefined,
    });
    await partial.embedded.initialise();
    await partial.embedded.start();
    await partial.embedded.createDatabase(databaseName);

    partial.pool = new Pool({
      host: EMBEDDED_HOST,
      port,
      user: databaseUser,
      password: databasePassword,
      database: databaseName,
    });
    return partial as EmbeddedAuthorityDatabase;
  } catch (error) {
    await cleanupEmbeddedAuthorityDatabase(partial);
    throw error;
  }
}
