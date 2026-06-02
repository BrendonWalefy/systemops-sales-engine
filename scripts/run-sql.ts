/**
 * Aplica um arquivo .sql diretamente no banco (idempotente).
 * Usado para as migrations escritas à mão (0024, 0025) sem depender do
 * journal do drizzle-kit.
 *
 * Run:
 *   npx dotenv -e .env.local -- npx tsx scripts/run-sql.ts drizzle/0024_editorial_single_source.sql
 *   npx dotenv -e .env.local -- npx tsx scripts/run-sql.ts drizzle/0025_multi_tenant_foundation.sql
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("Uso: tsx scripts/run-sql.ts <caminho-do-arquivo.sql>");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL não definido");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

async function main() {
  const content = readFileSync(file, "utf8");
  console.log(`Aplicando ${file}...`);
  await sql.unsafe(content);
  console.log("OK");
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error("Falha ao aplicar SQL:", err);
    await sql.end();
    process.exit(1);
  });
