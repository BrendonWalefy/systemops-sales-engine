import { db } from "@/infrastructure/db/client";
import { clinicModules } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { MODULE_CATALOG } from "./module-catalog";
import type { ModuleKey } from "./module-catalog";
import type { ClinicPlan } from "@/application/onboarding/clinic-commercial-settings";

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

  const modulesForPlan = MODULE_CATALOG
    .filter((m) => m.plans.includes(plan))
    .map((m) => m.key);

  for (const def of MODULE_CATALOG) {
    const shouldBeActive = modulesForPlan.includes(def.key);
    await db
      .insert(clinicModules)
      .values({ clinicId, moduleKey: def.key, isActive: shouldBeActive, updatedBy })
      .onConflictDoUpdate({
        target: [clinicModules.clinicId, clinicModules.moduleKey],
        set: { isActive: shouldBeActive, updatedBy, updatedAt: new Date() },
      });
  }
}
