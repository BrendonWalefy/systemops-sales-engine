/**
 * Repara drift de migrations em produção quando o schema já contém mudanças
 * antigas, mas o ledger drizzle.__drizzle_migrations não foi atualizado.
 *
 * Objetivo desta rotina:
 * - garantir de forma idempotente os objetos esperados entre 0028..0035
 * - registrar as migrations antigas faltantes no ledger do Drizzle
 * - permitir que futuras execuções de scripts/migrate.ts voltem a funcionar
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { assertDrizzleMetaIsSane } from "./check-drizzle-meta";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

assertDrizzleMetaIsSane();

const db = drizzle(neon(connectionString));

const journal = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../drizzle/meta/_journal.json"), "utf8"),
) as {
  entries: { idx: number; when: number; tag: string }[];
};

const TARGET_TAGS = new Set([
  "0028_playbook_receptionist_name",
  "0029_module_system",
  "0030_drop_voice_experience_columns",
  "0031_revenue_pipeline",
  "0032_prod_schema_restore",
  "0035_married_carlie_cooper",
]);

const targetEntries = journal.entries.filter((entry) => TARGET_TAGS.has(entry.tag));

function migrationHash(tag: string): string {
  const file = fs.readFileSync(path.join(__dirname, `../drizzle/${tag}.sql`), "utf8");
  return crypto.createHash("sha256").update(file).digest("hex");
}

async function ensureSchema(): Promise<void> {
  await db.execute(sql.raw(`
    ALTER TABLE "playbook_versions"
      ADD COLUMN IF NOT EXISTS "receptionist_name" TEXT NOT NULL DEFAULT 'Marina';
  `));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "clinic_modules" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "clinic_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "module_key" TEXT NOT NULL,
      "is_active" BOOLEAN NOT NULL DEFAULT true,
      "config" JSONB,
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_by" TEXT
    );
  `));

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS "clinic_modules_clinic_module_key_idx"
      ON "clinic_modules" ("clinic_id", "module_key");
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS "idx_clinic_modules_clinic"
      ON "clinic_modules" ("clinic_id");
  `));

  await db.execute(sql.raw(`
    INSERT INTO "clinic_modules" ("clinic_id", "module_key", "is_active", "updated_by")
    SELECT c."id", m."module_key", true, 'repair_prod_migration_history'
    FROM "organizations" c
    CROSS JOIN (VALUES
      ('video_library'),
      ('ai_co_writer'),
      ('revenue_pipeline'),
      ('team_roles')
    ) AS m("module_key")
    WHERE c."plan" IN ('clinica', 'rede')
    ON CONFLICT DO NOTHING;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE "organizations" DROP COLUMN IF EXISTS "voice_response_enabled";
  `));
  await db.execute(sql.raw(`
    ALTER TABLE "organizations" DROP COLUMN IF EXISTS "tts_voice";
  `));
  await db.execute(sql.raw(`
    ALTER TABLE "organizations" DROP COLUMN IF EXISTS "tts_config";
  `));
  await db.execute(sql.raw(`
    ALTER TABLE "organizations" DROP COLUMN IF EXISTS "conversation_experience";
  `));

  await db.execute(sql.raw(`
    ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'receptionist';
  `));
  await db.execute(sql.raw(`
    ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'professional';
  `));

  await db.execute(sql.raw(`
    ALTER TABLE "clinic_members"
      ADD COLUMN IF NOT EXISTS "professional_id" UUID REFERENCES "professionals"("id");
  `));

  await db.execute(sql.raw(`
    ALTER TABLE "treatments"
      ADD COLUMN IF NOT EXISTS "price_cents" INTEGER,
      ADD COLUMN IF NOT EXISTS "min_price_cents" INTEGER,
      ADD COLUMN IF NOT EXISTS "max_price_cents" INTEGER;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE "appointments"
      ADD COLUMN IF NOT EXISTS "treatment_id" UUID REFERENCES "treatments"("id"),
      ADD COLUMN IF NOT EXISTS "value_cents" INTEGER;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "service_noun" TEXT NOT NULL DEFAULT 'tratamento',
      ADD COLUMN IF NOT EXISTS "segment" TEXT NOT NULL DEFAULT 'dental';
  `));

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'conversation_category'
          AND n.nspname = 'public'
      ) THEN
        CREATE TYPE "public"."conversation_category" AS ENUM(
          'sales',
          'operational',
          'vendor',
          'spam',
          'archived'
        );
      END IF;
    END $$;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE "conversations"
      ADD COLUMN IF NOT EXISTS "category" "conversation_category" DEFAULT 'sales';
  `));

  await db.execute(sql.raw(`
    UPDATE "conversations"
    SET "category" = 'sales'
    WHERE "category" IS NULL;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE "conversations"
      ALTER COLUMN "category" SET DEFAULT 'sales',
      ALTER COLUMN "category" SET NOT NULL;
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS "conversations_clinic_category_idx"
      ON "conversations" USING btree ("clinic_id", "category");
  `));
}

async function ensureLedger(): Promise<void> {
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "drizzle";`));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      "id" SERIAL PRIMARY KEY,
      "hash" text NOT NULL,
      "created_at" bigint
    );
  `));

  const existing = await db.execute(sql.raw(`
    SELECT "created_at"
    FROM "drizzle"."__drizzle_migrations";
  `));

  const existingWhen = new Set(
    existing.rows
      .map((row) => row.created_at)
      .filter((value): value is number => typeof value === "number"),
  );

  for (const entry of targetEntries) {
    if (existingWhen.has(entry.when)) continue;
    const hash = migrationHash(entry.tag);
    await db.execute(sql.raw(`
      INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
      VALUES ('${hash}', ${entry.when});
    `));
  }
}

console.log("Reparando schema idempotente 0028..0035...");
await ensureSchema();
console.log("Reparando ledger drizzle.__drizzle_migrations...");
await ensureLedger();
console.log("Repair concluído ✓");
