/**
 * Remove do playbook ativo da Ximendes o fluxo de lentes que passou a ser
 * propriedade de treatments.pipelineSteps.
 *
 * A aplicação cria uma nova versão ativa e mantém a anterior como histórica,
 * tornando o rollback uma simples reativação transacional da versão anterior.
 *
 * Dry-run:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-ximendes-playbook-pipeline-ownership.ts
 *
 * Aplicar:
 *   ... --apply
 *
 * Rollback:
 *   ... --rollback
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  removeLegacyXimendesCommercialPriceFacts,
  removeLegacyXimendesPipelineInstructions,
} from "../src/application/config/pipeline-family-migration";
import { db } from "../src/infrastructure/db/client";
import {
  organizations,
  playbookVersions,
} from "../src/infrastructure/db/schema";

const apply = process.argv.includes("--apply");
const rollback = process.argv.includes("--rollback");
if (apply && rollback) throw new Error("Use apenas --apply ou --rollback.");

const VERSION_SUFFIX = " — Pipeline canônico";
const CLINIC_NAME = "Ximendes Odontologia";
const maintenanceClient = apply || rollback
  ? postgres(process.env.DATABASE_URL ?? "", { max: 1 })
  : null;
const maintenanceDb = maintenanceClient
  ? drizzlePostgres(maintenanceClient)
  : null;

async function main() {
  const [clinic] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.name, CLINIC_NAME))
    .limit(1);
  if (!clinic) throw new Error("Clínica Ximendes não encontrada.");

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

  const targetNotes = removeLegacyXimendesPipelineInstructions(active.notes);
  const targetCommercialPolicy = removeLegacyXimendesCommercialPriceFacts(
    active.commercialPolicy,
  );
  const notesWillChange = targetNotes !== active.notes;
  const commercialPolicyWillChange =
    targetCommercialPolicy !== active.commercialPolicy;
  console.log(JSON.stringify({
    clinic: clinic.name,
    mode: apply ? "apply" : "dry-run",
    sourcePlaybookId: active.id,
    sourcePlaybookName: active.name,
    targetPlaybookName: active.name.endsWith(VERSION_SUFFIX)
      ? active.name
      : `${active.name}${VERSION_SUFFIX}`,
    notesWillChange,
    commercialPolicyWillChange,
    legacyPipelineInstructionsPresent:
      active.notes?.includes("TRIGGER DE LENTES") ?? false,
  }, null, 2));

  if (!apply || (!notesWillChange && !commercialPolicyWillChange)) return;
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
      name: active.name.endsWith(VERSION_SUFFIX)
        ? active.name
        : `${active.name}${VERSION_SUFFIX}`,
      status: "active",
      specialty: active.specialty,
      procedureDescription: active.procedureDescription,
      toneOfVoice: active.toneOfVoice,
      differentials: active.differentials,
      commercialPolicy: targetCommercialPolicy,
      notes: targetNotes,
      receptionistName: active.receptionistName,
      objections: active.objections,
      warrantyPolicy: active.warrantyPolicy,
      mediaLibrary: active.mediaLibrary,
      mediaAssetIds: active.mediaAssetIds,
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
  if (!active.name.endsWith(VERSION_SUFFIX)) {
    console.log(JSON.stringify({
      mode: "rollback",
      changed: false,
      reason: "active playbook is not the pipeline-ownership migration version",
    }));
    return;
  }
  const previousName = active.name.slice(0, -VERSION_SUFFIX.length);
  const candidates = await db
    .select()
    .from(playbookVersions)
    .where(and(
      eq(playbookVersions.clinicId, clinicId),
      eq(playbookVersions.name, previousName),
      eq(playbookVersions.status, "historical"),
    ))
    .orderBy(desc(playbookVersions.updatedAt))
    .limit(2);
  if (candidates.length === 0) {
    throw new Error("Versão histórica anterior não encontrada; rollback abortado.");
  }
  const previous = candidates[0]!;
  console.log(JSON.stringify({
    mode: "rollback",
    activePlaybookId: active.id,
    restorePlaybookId: previous.id,
    restorePlaybookName: previous.name,
  }, null, 2));
  if (!maintenanceDb) return;

  const now = new Date();
  await maintenanceDb.transaction(async (tx) => {
    await tx
      .update(playbookVersions)
      .set({ status: "historical", updatedAt: now })
      .where(and(
        eq(playbookVersions.id, active.id),
        eq(playbookVersions.clinicId, clinicId),
        eq(playbookVersions.status, "active"),
      ));
    const restored = await tx
      .update(playbookVersions)
      .set({ status: "active", updatedAt: now })
      .where(and(
        eq(playbookVersions.id, previous.id),
        eq(playbookVersions.clinicId, clinicId),
        eq(playbookVersions.status, "historical"),
      ))
      .returning({ id: playbookVersions.id });
    if (restored.length !== 1) {
      throw new Error("Versão anterior mudou durante o rollback; abortando.");
    }
  });
  console.log(JSON.stringify({ rolledBack: true, activePlaybookId: previous.id }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await maintenanceClient?.end().catch(() => undefined);
  });
