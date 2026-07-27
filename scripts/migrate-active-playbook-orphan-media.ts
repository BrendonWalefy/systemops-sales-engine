/**
 * Clona o playbook ativo removendo somente IDs de mídia que não existem mais
 * na biblioteca do mesmo tenant. Dry-run por padrão; nunca restaura ou adivinha
 * arquivos. A versão anterior permanece histórica para rollback.
 *
 *   tsx scripts/migrate-active-playbook-orphan-media.ts --slug=<slug>
 *   tsx scripts/migrate-active-playbook-orphan-media.ts --slug=<slug> --apply
 *   tsx scripts/migrate-active-playbook-orphan-media.ts --slug=<slug> --rollback
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { db } from "../src/infrastructure/db/client";
import {
  mediaAssets,
  organizations,
  playbookVersions,
} from "../src/infrastructure/db/schema";

const apply = process.argv.includes("--apply");
const rollback = process.argv.includes("--rollback");
if (apply && rollback) throw new Error("Use apenas --apply ou --rollback.");
const slug = process.argv
  .find((argument) => argument.startsWith("--slug="))
  ?.slice("--slug=".length)
  .trim();
if (!slug) throw new Error("Use --slug=<slug>.");

const client = apply || rollback
  ? postgres(process.env.DATABASE_URL ?? "", { max: 1 })
  : null;
const maintenanceDb = client ? drizzlePostgres(client) : null;

async function main() {
  const [clinic] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, slug!))
    .limit(1);
  if (!clinic) throw new Error(`Tenant não encontrado: ${slug}`);

  const activeVersions = await db
    .select()
    .from(playbookVersions)
    .where(and(
      eq(playbookVersions.clinicId, clinic.id),
      eq(playbookVersions.status, "active"),
    ));
  if (activeVersions.length !== 1) {
    throw new Error(
      `Esperado exatamente um playbook ativo; encontrados ${activeVersions.length}.`,
    );
  }
  const active = activeVersions[0]!;
  if (rollback) {
    await rollbackVersion(clinic.id, active);
    return;
  }
  const existingAssets = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(eq(mediaAssets.clinicId, clinic.id));
  const existingIds = new Set(existingAssets.map((asset) => asset.id));
  const keptIds = active.mediaAssetIds.filter((id) => existingIds.has(id));
  const removedIds = active.mediaAssetIds.filter((id) => !existingIds.has(id));

  console.log(JSON.stringify({
    clinic: clinic.name,
    mode: apply ? "apply" : "dry-run",
    sourcePlaybookId: active.id,
    sourcePlaybookName: active.name,
    configuredMediaCount: active.mediaAssetIds.length,
    keptMediaCount: keptIds.length,
    orphanMediaCount: removedIds.length,
    removedIds,
  }, null, 2));

  if (!apply || removedIds.length === 0) return;
  if (!maintenanceDb) throw new Error("Conexão transacional indisponível.");

  const now = new Date();
  const newId = randomUUID();
  await maintenanceDb.transaction(async (tx) => {
    const archived = await tx
      .update(playbookVersions)
      .set({ status: "historical", updatedAt: now })
      .where(and(
        eq(playbookVersions.id, active.id),
        eq(playbookVersions.clinicId, clinic.id),
        eq(playbookVersions.status, "active"),
      ))
      .returning({ id: playbookVersions.id });
    if (archived.length !== 1) {
      throw new Error("Playbook ativo mudou durante a migração; abortando.");
    }

    await tx.insert(playbookVersions).values({
      id: newId,
      clinicId: active.clinicId,
      name: `${active.name} — Mídia válida`,
      status: "active",
      specialty: active.specialty,
      procedureDescription: active.procedureDescription,
      toneOfVoice: active.toneOfVoice,
      differentials: active.differentials,
      commercialPolicy: active.commercialPolicy,
      notes: active.notes,
      receptionistName: active.receptionistName,
      objections: active.objections,
      warrantyPolicy: active.warrantyPolicy,
      mediaLibrary: active.mediaLibrary,
      mediaAssetIds: keptIds,
      createdAt: now,
      updatedAt: now,
    });
  });
  console.log(JSON.stringify({ applied: true, activePlaybookId: newId }));
}

async function rollbackVersion(
  clinicId: string,
  active: typeof playbookVersions.$inferSelect,
) {
  const suffix = " — Mídia válida";
  if (!active.name.endsWith(suffix)) {
    console.log(JSON.stringify({
      mode: "rollback",
      changed: false,
      reason: "active playbook is not an orphan-media migration version",
    }));
    return;
  }
  const previousName = active.name.slice(0, -suffix.length);
  const [previous] = await db
    .select()
    .from(playbookVersions)
    .where(and(
      eq(playbookVersions.clinicId, clinicId),
      eq(playbookVersions.name, previousName),
      eq(playbookVersions.status, "historical"),
    ))
    .orderBy(desc(playbookVersions.updatedAt))
    .limit(1);
  if (!previous) throw new Error("Versão histórica anterior não encontrada.");
  if (!maintenanceDb) throw new Error("Conexão transacional indisponível.");

  const now = new Date();
  await maintenanceDb.transaction(async (tx) => {
    const archived = await tx
      .update(playbookVersions)
      .set({ status: "historical", updatedAt: now })
      .where(and(
        eq(playbookVersions.id, active.id),
        eq(playbookVersions.status, "active"),
      ))
      .returning({ id: playbookVersions.id });
    if (archived.length !== 1) throw new Error("Playbook ativo mudou; abortando.");
    const restored = await tx
      .update(playbookVersions)
      .set({ status: "active", updatedAt: now })
      .where(and(
        eq(playbookVersions.id, previous.id),
        eq(playbookVersions.status, "historical"),
      ))
      .returning({ id: playbookVersions.id });
    if (restored.length !== 1) throw new Error("Rollback não restaurou a versão anterior.");
  });
  console.log(JSON.stringify({ rolledBack: true, activePlaybookId: previous.id }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client?.end().catch(() => undefined);
  });
