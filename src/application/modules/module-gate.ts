import { db } from "@/infrastructure/db/client";
import { clinicModules, playbookVersions } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import type { ModuleKey } from "./module-catalog";
import type { ClinicPlan } from "@/application/onboarding/clinic-commercial-settings";
import type { VoiceElevenLabsConfig } from "./module-configs";
import {
  applyPlanActivations,
  mergeRedeBWaveConfig,
  REDE_RECOMMENDED_TONE,
  resolvePlanModules,
  shouldApplyRedeToneRecommendation,
} from "./plan-presets";

export type ActiveModule = {
  key: ModuleKey;
  config: Record<string, unknown> | null;
};

/**
 * Retorna todos os módulos ativos para uma clínica.
 * Chamada única por request — guarde o resultado em variável local.
 */
export async function getClinicModules(clinicId: string): Promise<ActiveModule[]> {
  const rows = await db
    .select({ moduleKey: clinicModules.moduleKey, config: clinicModules.config })
    .from(clinicModules)
    .where(
      and(
        eq(clinicModules.clinicId, clinicId),
        eq(clinicModules.isActive, true),
      ),
    );

  return rows.map((r) => ({
    key: r.moduleKey as ModuleKey,
    config: r.config as Record<string, unknown> | null,
  }));
}

/**
 * Verifica se um módulo específico está ativo.
 * Use quando só precisa checar um módulo — evita carregar todos.
 */
export async function clinicHasModule(clinicId: string, key: ModuleKey): Promise<boolean> {
  const [row] = await db
    .select({ id: clinicModules.id })
    .from(clinicModules)
    .where(
      and(
        eq(clinicModules.clinicId, clinicId),
        eq(clinicModules.moduleKey, key),
        eq(clinicModules.isActive, true),
      ),
    )
    .limit(1);

  return !!row;
}

/**
 * Retorna a config tipada de um módulo específico.
 * Usar quando o módulo tem configuração (ex: voice_tts, voice_elevenlabs).
 */
export async function getModuleConfig<T = Record<string, unknown>>(
  clinicId: string,
  key: ModuleKey,
): Promise<T | null> {
  const [row] = await db
    .select({ config: clinicModules.config })
    .from(clinicModules)
    .where(
      and(
        eq(clinicModules.clinicId, clinicId),
        eq(clinicModules.moduleKey, key),
        eq(clinicModules.isActive, true),
      ),
    )
    .limit(1);

  return (row?.config as T) ?? null;
}

/**
 * Sincroniza os módulos de uma clínica com base no plano.
 * Chamado ao criar clínica ou ao mudar de plano.
 * Para plano "custom": não faz nada (owner configura manualmente).
 */
export async function syncModulesForPlan(
  clinicId: string,
  plan: ClinicPlan,
  updatedBy: string,
): Promise<void> {
  if (plan === "custom") return;

  const currentRows = await db
    .select({
      moduleKey: clinicModules.moduleKey,
      isActive: clinicModules.isActive,
    })
    .from(clinicModules)
    .where(eq(clinicModules.clinicId, clinicId));

  const currentState = Object.fromEntries(
    currentRows.map((row) => [row.moduleKey as ModuleKey, row.isActive]),
  ) as Partial<Record<ModuleKey, boolean>>;
  const nextState = applyPlanActivations(currentState, plan);

  for (const key of resolvePlanModules(plan)) {
    const shouldBeActive = nextState[key] ?? true;
    await db
      .insert(clinicModules)
      .values({ clinicId, moduleKey: key, isActive: shouldBeActive, updatedBy })
      .onConflictDoUpdate({
        target: [clinicModules.clinicId, clinicModules.moduleKey],
        set: { isActive: shouldBeActive, updatedBy, updatedAt: new Date() },
      });
  }
}

export async function applyClinicPlanPreset(
  clinicId: string,
  plan: ClinicPlan,
  updatedBy: string,
): Promise<void> {
  await syncModulesForPlan(clinicId, plan, updatedBy);

  if (plan !== "rede") return;

  const [bwaveModule, activePlaybook] = await Promise.all([
    db
      .select({ config: clinicModules.config })
      .from(clinicModules)
      .where(
        and(
          eq(clinicModules.clinicId, clinicId),
          eq(clinicModules.moduleKey, "voice_elevenlabs"),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.query.playbookVersions.findFirst({
      where: and(
        eq(playbookVersions.clinicId, clinicId),
        eq(playbookVersions.status, "active"),
      ),
      columns: {
        id: true,
        toneOfVoice: true,
      },
    }),
  ]);

  const nextBWaveConfig = mergeRedeBWaveConfig(
    (bwaveModule?.config as Partial<VoiceElevenLabsConfig> | null) ?? null,
  );

  await db
    .insert(clinicModules)
    .values({
      clinicId,
      moduleKey: "voice_elevenlabs",
      isActive: true,
      config: nextBWaveConfig,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [clinicModules.clinicId, clinicModules.moduleKey],
      set: {
        isActive: true,
        config: nextBWaveConfig,
        updatedBy,
        updatedAt: new Date(),
      },
    });

  if (
    activePlaybook?.id &&
    shouldApplyRedeToneRecommendation(activePlaybook.toneOfVoice)
  ) {
    await db
      .update(playbookVersions)
      .set({
        toneOfVoice: REDE_RECOMMENDED_TONE,
        updatedAt: new Date(),
      })
      .where(eq(playbookVersions.id, activePlaybook.id));
  }
}
