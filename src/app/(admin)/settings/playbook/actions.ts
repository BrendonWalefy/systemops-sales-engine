"use server";

import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function savePlaybook(formData: FormData) {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  await db
    .update(clinics)
    .set({
      toneOfVoice: (formData.get("toneOfVoice") as string) || null,
      businessHours: (formData.get("businessHours") as string) || null,
      commercialPolicy: (formData.get("commercialPolicy") as string) || null,
      playbook: (formData.get("playbook") as string) || null,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/settings/playbook");
}

export async function toggleAutoReply(currentValue: boolean) {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  await db
    .update(clinics)
    .set({
      autoReplyEnabled: !currentValue,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/settings/playbook");
}
