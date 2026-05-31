"use server";

import { db } from "@/infrastructure/db/client";
import { clinics, playbookVersions } from "@/infrastructure/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const CLINIC_ID = process.env.PILOT_CLINIC_ID!;

type PlaybookVersionData = {
  specialty?: string | null;
  procedureDescription?: string | null;
  toneOfVoice?: string;
  differentials?: string[];
  commercialPolicy?: string | null;
  objections?: { objection: string; response: string }[];
};

function compileToClinicFields(data: PlaybookVersionData) {
  const parts: string[] = [];

  if (data.specialty) {
    parts.push(`ESPECIALIDADE: ${data.specialty}`);
  }
  if (data.procedureDescription) {
    parts.push(`\nSOBRE O PROCEDIMENTO:\n${data.procedureDescription}`);
  }
  if (data.differentials && data.differentials.length > 0) {
    parts.push(
      `\nDIFERENCIAIS DA CLÍNICA:\n${data.differentials.map((d) => `- ${d}`).join("\n")}`,
    );
  }
  if (data.objections && data.objections.length > 0) {
    const objText = data.objections
      .map((o) => `Objeção: ${o.objection}\nResposta: ${o.response}`)
      .join("\n\n");
    parts.push(`\nOBJEÇÕES E RESPOSTAS:\n${objText}`);
  }

  const toneMap: Record<string, string> = {
    acolhedor: "Acolhedor e empático",
    tecnico: "Técnico e informativo",
    persuasivo: "Persuasivo e orientado a resultados",
    luxo: "Premium e exclusivo",
  };

  return {
    playbook: parts.join("\n") || null,
    commercialPolicy: data.commercialPolicy || null,
    toneOfVoice: toneMap[data.toneOfVoice ?? "acolhedor"] ?? data.toneOfVoice ?? null,
  };
}

export async function createPlaybookVersion(name: string) {
  const [version] = await db
    .insert(playbookVersions)
    .values({ clinicId: CLINIC_ID, name, status: "draft" })
    .returning({ id: playbookVersions.id });

  revalidatePath("/app/settings/playbook");
  redirect(`/app/settings/playbook/${version.id}`);
}

export async function updatePlaybookVersion(id: string, data: PlaybookVersionData) {
  await db
    .update(playbookVersions)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)));

  revalidatePath(`/app/settings/playbook/${id}`);
}

export async function activatePlaybookVersion(id: string) {
  const [version] = await db
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)))
    .limit(1);

  if (!version) return;

  await db
    .update(playbookVersions)
    .set({ status: "historical", updatedAt: new Date() })
    .where(
      and(
        eq(playbookVersions.clinicId, CLINIC_ID),
        ne(playbookVersions.id, id),
        ne(playbookVersions.status, "draft"),
      ),
    );

  await db
    .update(playbookVersions)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(playbookVersions.id, id));

  const clinicFields = compileToClinicFields({
    specialty: version.specialty,
    procedureDescription: version.procedureDescription,
    toneOfVoice: version.toneOfVoice,
    differentials: version.differentials,
    commercialPolicy: version.commercialPolicy,
    objections: version.objections,
  });

  await db
    .update(clinics)
    .set({ ...clinicFields, updatedAt: new Date() })
    .where(eq(clinics.id, CLINIC_ID));

  revalidatePath("/app/settings/playbook");
}

export async function renamePlaybookVersion(id: string, name: string) {
  await db
    .update(playbookVersions)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)));

  revalidatePath("/app/settings/playbook");
}

export async function duplicatePlaybookVersion(id: string) {
  const [original] = await db
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)))
    .limit(1);

  if (!original) return;

  await db.insert(playbookVersions).values({
    clinicId: CLINIC_ID,
    name: `${original.name} (cópia)`,
    status: "draft",
    specialty: original.specialty,
    procedureDescription: original.procedureDescription,
    toneOfVoice: original.toneOfVoice,
    differentials: original.differentials,
    commercialPolicy: original.commercialPolicy,
    objections: original.objections,
  });

  revalidatePath("/app/settings/playbook");
}

export async function updateClinicOperationalSettings(data: {
  businessHours?: string | null;
  takeoverTtlHours?: number;
  postAppointmentBufferMinutes?: number;
}) {
  await db
    .update(clinics)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(clinics.id, CLINIC_ID));
  revalidatePath("/app/settings/playbook");
}

export async function deletePlaybookVersion(id: string) {
  const [version] = await db
    .select({ status: playbookVersions.status })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)))
    .limit(1);

  if (!version || version.status === "active") return;

  await db
    .delete(playbookVersions)
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)));

  revalidatePath("/app/settings/playbook");
}
