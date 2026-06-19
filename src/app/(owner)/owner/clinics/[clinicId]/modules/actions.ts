"use server";

import { db } from "@/infrastructure/db/client";
import { clinicModules } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import type { ModuleKey } from "@/application/modules/module-catalog";
import { syncModulesForPlan } from "@/application/modules/module-gate";
import type { ClinicPlan } from "@/application/onboarding/clinic-commercial-settings";

async function assertOwnerSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) throw new Error("Não autorizado");
  const session = await verifyToken(token);
  if (!session || session.role !== "owner") throw new Error("Apenas o owner pode gerenciar módulos");
}

export async function toggleModule(
  clinicId: string,
  moduleKey: ModuleKey,
  isActive: boolean,
) {
  await assertOwnerSession();
  await db
    .insert(clinicModules)
    .values({ clinicId, moduleKey, isActive, updatedBy: "owner" })
    .onConflictDoUpdate({
      target: [clinicModules.clinicId, clinicModules.moduleKey],
      set: { isActive, updatedBy: "owner", updatedAt: new Date() },
    });
  revalidatePath(`/owner/clinics/${clinicId}/modules`);
}

export async function updateModuleConfig(
  clinicId: string,
  moduleKey: ModuleKey,
  config: Record<string, unknown>,
) {
  await assertOwnerSession();
  await db
    .update(clinicModules)
    .set({ config, updatedBy: "owner", updatedAt: new Date() })
    .where(
      and(
        eq(clinicModules.clinicId, clinicId),
        eq(clinicModules.moduleKey, moduleKey),
      ),
    );
  revalidatePath(`/owner/clinics/${clinicId}/modules`);
}

export async function syncPlanModules(clinicId: string, plan: ClinicPlan) {
  await assertOwnerSession();
  await syncModulesForPlan(clinicId, plan, "owner_sync");
  revalidatePath(`/owner/clinics/${clinicId}/modules`);
}
