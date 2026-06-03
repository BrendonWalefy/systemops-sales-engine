"use server";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function toggleAutoReply(currentValue: boolean) {
  const clinicId = await requireSessionClinicId();
  await db
    .update(clinics)
    .set({
      autoReplyEnabled: !currentValue,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/settings/playbook");
}
