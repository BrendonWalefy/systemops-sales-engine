import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { COOKIE_NAME, verifyToken } from "@/lib/session";

const REPAIR_STATEMENTS = [
  `ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'receptionist'`,
  `ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'professional'`,
  `ALTER TABLE "clinic_members"
    ADD COLUMN IF NOT EXISTS "professional_id" UUID REFERENCES "professionals"("id")`,
  `ALTER TABLE "treatments"
    ADD COLUMN IF NOT EXISTS "price_cents" INTEGER,
    ADD COLUMN IF NOT EXISTS "min_price_cents" INTEGER,
    ADD COLUMN IF NOT EXISTS "max_price_cents" INTEGER`,
  `ALTER TABLE "appointments"
    ADD COLUMN IF NOT EXISTS "treatment_id" UUID REFERENCES "treatments"("id"),
    ADD COLUMN IF NOT EXISTS "value_cents" INTEGER`,
  `ALTER TABLE "clinics"
    ADD COLUMN IF NOT EXISTS "service_noun" TEXT NOT NULL DEFAULT 'tratamento',
    ADD COLUMN IF NOT EXISTS "segment" TEXT NOT NULL DEFAULT 'dental'`,
  `CREATE TABLE IF NOT EXISTS "clinic_modules" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
    "module_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updated_by" TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "clinic_modules_clinic_module_key_idx"
    ON "clinic_modules" ("clinic_id", "module_key")`,
  `CREATE INDEX IF NOT EXISTS "idx_clinic_modules_clinic"
    ON "clinic_modules" ("clinic_id")`,
  `INSERT INTO "clinic_modules" ("clinic_id", "module_key", "is_active", "updated_by")
    SELECT c."id", m."module_key", true, 'owner_restore_schema'
    FROM "clinics" c
    CROSS JOIN (VALUES
      ('video_library'),
      ('ai_co_writer'),
      ('revenue_pipeline'),
      ('team_roles')
    ) AS m("module_key")
    WHERE c."plan" IN ('clinica', 'rede')
    ON CONFLICT DO NOTHING`,
];

async function requireOwnerSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner" ? session : null;
}

export async function POST() {
  const session = await requireOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  for (const statement of REPAIR_STATEMENTS) {
    await db.execute(sql.raw(statement));
  }

  return NextResponse.json({
    ok: true,
    executed: REPAIR_STATEMENTS.length,
    actor: session.email,
  });
}
