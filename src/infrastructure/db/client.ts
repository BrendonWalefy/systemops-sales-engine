import {
  neon,
  type NeonQueryFunction,
} from "@neondatabase/serverless";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { resolveTestDatabaseAccess } from "./test-database-policy";

// HTTP driver — sem TCP handshake, sem cold start de conexão no Neon serverless.
// Cada query é uma requisição HTTP independente, ideal para Vercel Functions.
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _neonClient: NeonQueryFunction<false, false> | null = null;

function isRunningUnderTest(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

function getNeonClient(): NeonQueryFunction<false, false> {
  if (_neonClient) return _neonClient;
  // Único ponto por onde todo acesso a banco real passa — por isso é aqui que a
  // política de teste é aplicada, e não dentro de cada teste. Um teste novo que
  // importe `db` sem mock cai no guardrail sem precisar saber que ele existe.
  // Ver `test-database-policy.ts` para o incidente que motivou a checagem.
  if (isRunningUnderTest()) {
    const access = resolveTestDatabaseAccess(process.env);
    if (access.mode !== "authorized") throw new Error(access.reason);
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  _neonClient = neon(connectionString);
  return _neonClient;
}

function getDb() {
  if (_db) return _db;
  _db = drizzle(getNeonClient(), { schema });
  return _db;
}

export async function executeAbortableDatabaseStatement(
  statement: SQL,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw signal.reason;
  const query = new PgDialect().sqlToQuery(statement);
  return getNeonClient().query(query.sql, query.params, {
    arrayMode: false,
    fullResults: true,
    fetchOptions: { signal },
  });
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getDb() as any)[prop];
  },
});
