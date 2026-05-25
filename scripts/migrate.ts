/**
 * Script de migration para produção.
 * Usa drizzle-orm/neon-http (mesmo driver do app) em vez do drizzle-kit,
 * que trava ao usar TCP no ambiente serverless do Vercel.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = drizzle(neon(connectionString));

console.log("Aplicando migrations...");
await migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });
console.log("Migrations aplicadas ✓");
