/**
 * Consolida famílias de tratamento conhecidas sem inventar conteúdo.
 *
 * - Ximendes/Vitalli: mantém um pipeline canônico, aponta variantes para ele,
 *   limpa as cópias locais e deixa aliases genéricos somente no canônico.
 * - NC Beauty: hoje não há pipeline/mídias de cílios. Apenas elimina a disputa
 *   de aliases; não cria uma jornada fictícia.
 *
 * Dry-run:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-treatment-pipeline-families.ts
 *
 * Aplicação em sandbox preservando a ordem editorial cadastrada:
 *   ... --apply --entry=immediate --presentation=preserve
 *
 * Rollback:
 *   ... --rollback
 *
 * O rollback recompõe as cópias antigas a partir do canônico. A aplicação
 * aborta se uma cópia local divergir, para nunca apagar conteúdo não equivalente.
 */
import { and, eq, inArray } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { db } from "../src/infrastructure/db/client";
import { organizations, treatments } from "../src/infrastructure/db/schema";
import {
  pipelineDigest,
  removeLegacyXimendesQaOwnershipDuplication,
  transformFirstContentPresentation,
} from "../src/application/config/pipeline-family-migration";
import type {
  PipelineEntryBehavior,
  PipelineStep,
} from "../src/domain/entities/treatment";

type FamilyPlan = {
  key: "ximendes" | "vitalli" | "vitalli-removal" | "nc-beauty";
  clinicNames: string[];
  canonicalName: string;
  variantNames: string[];
  genericAliases: string[];
  canonicalOwnedGenericAliasesBefore: boolean;
  requiresCanonicalPipeline: boolean;
  legacyPresentation?: "media_then_text";
  introTextWhenMissing?: string;
  variantAliases?: Record<string, string[]>;
};

const PLANS: FamilyPlan[] = [
  {
    key: "ximendes",
    clinicNames: ["Ximendes Odontologia"],
    canonicalName: "Lentes em Resina Composta",
    variantNames: [
      "Lentes de resina composta simplificada",
      "Lentes de resina composta estratificada",
    ],
    genericAliases: [
      "lentes",
      "lente",
      "faceta",
      "facetas",
      "resina",
      "lentes de resina",
      "lentes de contato dental",
      "faceta de resina",
      "resina nos dentes",
      "lente no dente",
    ],
    canonicalOwnedGenericAliasesBefore: false,
    requiresCanonicalPipeline: true,
    legacyPresentation: "media_then_text",
    introTextWhenMissing: "Vou te mostrar as duas técnicas para você comparar:",
    variantAliases: {
      "Lentes de resina composta simplificada": [
        "simplificada",
        "simplificadas",
        "técnica simplificada",
        "técnicas simplificadas",
        "lentes simplificadas",
        "lentes de resina simplificadas",
        "lentes de resina composta simplificadas",
      ],
      "Lentes de resina composta estratificada": [
        "estratificada",
        "estratificadas",
        "técnica estratificada",
        "técnicas estratificadas",
        "lentes estratificadas",
        "lentes de resina estratificadas",
        "lentes de resina composta estratificadas",
      ],
    },
  },
  {
    key: "vitalli",
    clinicNames: ["Clínica Vitalli", "Clinica Vitalli"],
    canonicalName: "Lentes em Resina Composta",
    variantNames: [
      "Lente em Resina Premium",
      "Lente em Resina Estratificada",
    ],
    genericAliases: [
      "lentes",
      "lente",
      "lentes em resina",
      "lentes de resina",
      "facetas",
      "faceta",
      "facetas de resina",
      "lentes superiores",
      "lentes inferiores",
      "lente no dente",
      "sorriso",
      "resina",
    ],
    canonicalOwnedGenericAliasesBefore: true,
    requiresCanonicalPipeline: true,
    legacyPresentation: "media_then_text",
  },
  {
    key: "vitalli-removal",
    clinicNames: ["Clínica Vitalli", "Clinica Vitalli"],
    canonicalName: "Remoção de lentes",
    variantNames: ["Substituição de lente (un)"],
    genericAliases: [],
    canonicalOwnedGenericAliasesBefore: true,
    requiresCanonicalPipeline: true,
  },
  {
    key: "nc-beauty",
    clinicNames: ["NC Beauty & Clinic", "NC Beauty & clinic"],
    canonicalName: "Extensão de cílios — Técnicas Comuns",
    variantNames: ["Extensão de cílios — Técnicas Gringas"],
    genericAliases: [
      "cílios",
      "extensão de cílios",
      "alongamento de cílios",
    ],
    canonicalOwnedGenericAliasesBefore: true,
    requiresCanonicalPipeline: false,
    variantAliases: {
      "Extensão de cílios — Técnicas Gringas": ["fox", "cílios fox"],
    },
  },
];

const apply = process.argv.includes("--apply");
const rollback = process.argv.includes("--rollback");
const requestedClinic =
  process.argv.find((argument) => argument.startsWith("--clinic="))?.split("=")[1] ??
  "all";
const entryRaw =
  process.argv.find((argument) => argument.startsWith("--entry="))?.split("=")[1] ??
  "legacy";
const entryBehavior: PipelineEntryBehavior | null =
  entryRaw === "immediate" || entryRaw === "qualify_then_present"
    ? entryRaw
    : entryRaw === "legacy"
      ? null
      : (() => {
          throw new Error(`--entry inválido: ${entryRaw}`);
        })();
const presentationRaw =
  process.argv.find((argument) => argument.startsWith("--presentation="))?.split("=")[1] ??
  "preserve";
if (presentationRaw !== "preserve" && presentationRaw !== "text_then_media") {
  throw new Error(`--presentation inválido: ${presentationRaw}`);
}

if (apply && rollback) {
  throw new Error("Use apenas --apply ou --rollback.");
}
const maintenanceClient = apply || rollback
  ? postgres(process.env.DATABASE_URL ?? "", { max: 1 })
  : null;
const maintenanceDb = maintenanceClient
  ? drizzlePostgres(maintenanceClient)
  : null;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniqueAliases(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withoutAliases(values: string[], removed: string[]): string[] {
  const removedKeys = new Set(removed.map(normalize));
  return values.filter((value) => !removedKeys.has(normalize(value)));
}

function samePipeline(
  left: PipelineStep[] | null,
  right: PipelineStep[] | null,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function migratePlan(plan: FamilyPlan) {
  const [clinic] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(inArray(organizations.name, plan.clinicNames))
    .limit(1);
  if (!clinic) throw new Error(`[${plan.key}] clínica não encontrada.`);

  const rows = await db
    .select()
    .from(treatments)
    .where(and(
      eq(treatments.clinicId, clinic.id),
      inArray(treatments.name, [plan.canonicalName, ...plan.variantNames]),
    ));
  const byName = new Map(rows.map((row) => [row.name, row]));
  const canonical = byName.get(plan.canonicalName);
  const variants = plan.variantNames.map((name) => byName.get(name));
  if (!canonical || variants.some((variant) => !variant)) {
    throw new Error(`[${plan.key}] família incompleta; nenhuma alteração foi feita.`);
  }

  const canonicalSteps = (canonical.pipelineSteps as PipelineStep[] | null) ?? null;
  if (plan.requiresCanonicalPipeline && !canonicalSteps?.length) {
    throw new Error(`[${plan.key}] tratamento canônico está sem pipeline.`);
  }

  if (!rollback && canonicalSteps?.length) {
    for (const variant of variants) {
      const localSteps = (variant!.pipelineSteps as PipelineStep[] | null) ?? null;
      if (localSteps?.length && !samePipeline(localSteps, canonicalSteps)) {
        throw new Error(
          `[${plan.key}] pipeline de "${variant!.name}" diverge do canônico; abortando.`,
        );
      }
    }
  } else if (!canonicalSteps?.length) {
    const variantWithPipeline = variants.find(
      (variant) => ((variant!.pipelineSteps as PipelineStep[] | null) ?? null)?.length,
    );
    if (variantWithPipeline) {
      throw new Error(
        `[${plan.key}] "${variantWithPipeline.name}" tem pipeline, mas o canônico não; abortando.`,
      );
    }
  }
  const targetPresentation =
    presentationRaw === "preserve"
      ? "preserve"
      : rollback
        ? plan.legacyPresentation ?? "preserve"
        : "text_then_media";
  const presentationSteps = transformFirstContentPresentation(
    canonicalSteps,
    targetPresentation,
    plan.introTextWhenMissing,
  );
  const sourcePipelineDigest = pipelineDigest(canonicalSteps);
  const presentationPipelineDigest = pipelineDigest(presentationSteps);
  if (
    targetPresentation === "preserve" &&
    sourcePipelineDigest !== presentationPipelineDigest
  ) {
    throw new Error(
      `[${plan.key}] modo preserve alterou o pipeline; abortando.`,
    );
  }
  const targetCanonicalSteps =
    plan.key === "ximendes" && !rollback
      ? removeLegacyXimendesQaOwnershipDuplication(presentationSteps)
      : presentationSteps;
  const targetPipelineDigest = pipelineDigest(targetCanonicalSteps);

  const changes = {
    clinic: clinic.name,
    mode: rollback ? "rollback" : apply ? "apply" : "dry-run",
    canonical: canonical.name,
    variants: variants.map((variant) => variant!.name),
    pipelineConsolidation: Boolean(canonicalSteps?.length),
    presentation: targetPresentation,
    sourcePipelineDigest,
    targetPipelineDigest,
    pipelineContentPreserved: sourcePipelineDigest === targetPipelineDigest,
    qaOwnershipCleanup:
      presentationPipelineDigest !== targetPipelineDigest,
    entryBehavior: rollback ? null : entryBehavior,
    genericAliases: plan.genericAliases,
  };
  console.log(JSON.stringify(changes, null, 2));
  if (!apply && !rollback) return;

  if (!maintenanceDb) throw new Error("Conexão transacional indisponível.");
  await maintenanceDb.transaction(async (tx) => {
    const now = new Date();
    const canonicalAliases = rollback && !plan.canonicalOwnedGenericAliasesBefore
      ? withoutAliases(canonical.aliases, plan.genericAliases)
      : uniqueAliases([...canonical.aliases, ...plan.genericAliases]);

    await tx
      .update(treatments)
      .set({
        aliases: canonicalAliases,
        pipelineSteps: targetCanonicalSteps,
        pipelineEntryBehavior: rollback ? null : entryBehavior,
        updatedAt: now,
      })
      .where(and(
        eq(treatments.id, canonical.id),
        eq(treatments.clinicId, clinic.id),
      ));

    for (const variant of variants) {
      const configuredVariantAliases =
        plan.variantAliases?.[variant!.name] ?? [];
      const aliases = rollback
        ? uniqueAliases([
            ...withoutAliases(variant!.aliases, configuredVariantAliases),
            ...plan.genericAliases,
          ])
        : uniqueAliases([
            ...withoutAliases(variant!.aliases, plan.genericAliases),
            ...configuredVariantAliases,
          ]);
      const hasCanonicalPipeline = Boolean(canonicalSteps?.length);
      await tx
        .update(treatments)
        .set({
          aliases,
          pipelineSourceTreatmentId:
            hasCanonicalPipeline && !rollback ? canonical.id : null,
          pipelineSteps:
            hasCanonicalPipeline
              ? (rollback ? targetCanonicalSteps : null)
              : variant!.pipelineSteps,
          pipelineEntryBehavior: rollback ? null : entryBehavior,
          updatedAt: now,
        })
        .where(and(
          eq(treatments.id, variant!.id),
          eq(treatments.clinicId, clinic.id),
        ));
    }
  });
}

async function main() {
  const selectedPlans = requestedClinic === "all"
    ? PLANS
    : PLANS.filter((plan) => plan.key === requestedClinic);
  if (selectedPlans.length === 0) {
    throw new Error(`--clinic desconhecido: ${requestedClinic}`);
  }
  for (const plan of selectedPlans) {
    await migratePlan(plan);
  }
  await maintenanceClient?.end();
}

main().catch(async (error) => {
  await maintenanceClient?.end().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
