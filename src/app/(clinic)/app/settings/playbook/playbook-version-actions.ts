"use server";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { organizations, clinicModules, playbookVersions, treatments } from "@/infrastructure/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MenuItem } from "@/domain/entities/clinic";
import { publishablePlaybookSchema, blockingPlaybookNotesIssues, blockingCommercialPolicyIssues, blockingTreatmentDescriptionIssues } from "@/application/config/editorial-config";
import { preserveVoiceOutputEnabled, type VoiceTtsConfig, type VoiceElevenLabsConfig } from "@/application/modules/module-configs";
import type { VoiceMode } from "@/domain/entities/voice-mode";
import { activateExistingPlaybookVersion } from "@/application/config/playbook-publication";


type PlaybookVersionData = {
  specialty?: string | null;
  toneOfVoice?: string;
  receptionistName?: string;
  differentials?: string[];
  commercialPolicy?: string | null;
  objections?: { objection: string; response: string }[];
  // null = não cadastrado (a IA diz que confirma com a equipe);
  // offersWarranty: false = a clínica não dá garantia, e a IA pode informar isso.
  warrantyPolicy?: {
    offersWarranty: boolean;
    tiers: { periodMonths: number; covers: string }[];
    conditions: string | null;
  } | null;
  notes?: string | null;
  // Seleção de ids da biblioteca clinic-level (`media_assets`) que este playbook
  // autoriza a IA a enviar. A biblioteca é gerenciada em /app/settings/biblioteca.
  mediaAssetIds?: string[];
};

export async function createPlaybookVersion(name: string) {
  const CLINIC_ID = await requireSessionClinicId();
  const [version] = await db
    .insert(playbookVersions)
    .values({ clinicId: CLINIC_ID, name, status: "draft" })
    .returning({ id: playbookVersions.id });

  revalidatePath("/app/settings/playbook");
  redirect(`/app/settings/playbook/${version.id}`);
}

export async function updatePlaybookVersion(id: string, data: PlaybookVersionData) {
  const CLINIC_ID = await requireSessionClinicId();
  await db
    .update(playbookVersions)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)));

  revalidatePath(`/app/settings/playbook/${id}`);
}

export async function activatePlaybookVersion(id: string) {
  const CLINIC_ID = await requireSessionClinicId();
  const [version] = await db
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)))
    .limit(1);

  if (!version) return;

  const validation = publishablePlaybookSchema.safeParse({
    specialty: version.specialty ?? "",
    toneOfVoice: version.toneOfVoice ?? "acolhedor",
    receptionistName: version.receptionistName,
    differentials: version.differentials ?? [],
    commercialPolicy: version.commercialPolicy ?? "",
  });

  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Playbook inválido para ativação: ${issues}`);
  }

  // Gate anti-drift: um FATO com casa estruturada (preço em R$) no campo de
  // conduta livre bloqueia a publicação. Evita que o notes vire depósito de
  // preço — a mesma classe de erro que gerou respostas erradas em produção.
  const notesIssues = blockingPlaybookNotesIssues(version.notes);
  if (notesIssues.length > 0) {
    throw new Error(`Playbook inválido para ativação: ${notesIssues.join("; ")}`);
  }

  // Preço em Campanhas (aba Financeiro) tem casa própria agora — não sobra motivo
  // legítimo para número em R$ na política comercial. Bloqueia igual a notes/description.
  const policyIssues = blockingCommercialPolicyIssues(version.commercialPolicy);
  if (policyIssues.length > 0) {
    throw new Error(`Playbook inválido para ativação: ${policyIssues.join("; ")}`);
  }

  // Item 6 §6C: mesma régua para a descrição do procedimento — preço mora em
  // treatments.priceCents (a IA fala derivado). R$ na descrição bloqueia o publish.
  const clinicTreatments = await db
    .select({ name: treatments.name, description: treatments.description })
    .from(treatments)
    .where(eq(treatments.clinicId, CLINIC_ID));
  const descIssues = blockingTreatmentDescriptionIssues(clinicTreatments);
  if (descIssues.length > 0) {
    throw new Error(`Playbook inválido para ativação: ${descIssues.join("; ")}`);
  }

  await activateExistingPlaybookVersion({ clinicId: CLINIC_ID, versionId: id });

  revalidatePath("/app/settings/playbook");
}

export async function renamePlaybookVersion(id: string, name: string) {
  const CLINIC_ID = await requireSessionClinicId();
  await db
    .update(playbookVersions)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)));

  revalidatePath("/app/settings/playbook");
}

export async function duplicatePlaybookVersion(id: string) {
  const CLINIC_ID = await requireSessionClinicId();
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
    toneOfVoice: original.toneOfVoice,
    receptionistName: original.receptionistName,
    differentials: original.differentials,
    commercialPolicy: original.commercialPolicy,
    objections: original.objections,
    notes: original.notes,
    mediaAssetIds: original.mediaAssetIds,
  });

  revalidatePath("/app/settings/playbook");
}

export async function updateClinicOperationalSettings(data: {
  businessHours?: string | null;
  takeoverTtlHours?: number;
  postAppointmentBufferMinutes?: number;
  greetingMessage?: string | null;
  menuItems?: MenuItem[] | null;
  receptionistPhone?: string | null;
  staleConversationHours?: number;
  conversationRestartHours?: number;
  slotLookaheadDays?: number;
  mediaTakeoverTtlHours?: number | null;
  installmentRates?: { n: number; rate: number; active: boolean }[] | null;
}) {
  const CLINIC_ID = await requireSessionClinicId();
  await db
    .update(organizations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(organizations.id, CLINIC_ID));
  revalidatePath("/app/settings/playbook");
}

export async function toggleVoiceOutput(
  moduleKey: "voice_tts" | "voice_elevenlabs",
  voiceOutputEnabled: boolean,
) {
  const CLINIC_ID = await requireSessionClinicId();
  const [row] = await db
    .select({ config: clinicModules.config })
    .from(clinicModules)
    .where(and(eq(clinicModules.clinicId, CLINIC_ID), eq(clinicModules.moduleKey, moduleKey)))
    .limit(1);

  if (!row) return;
  await db
    .update(clinicModules)
    .set({
      config: { ...(row.config ?? {}), voiceOutputEnabled },
      updatedAt: new Date(),
      updatedBy: "org_admin",
    })
    .where(and(eq(clinicModules.clinicId, CLINIC_ID), eq(clinicModules.moduleKey, moduleKey)));
  revalidatePath("/app/settings/playbook");
}

export async function updateVoiceModuleConfig(config: VoiceTtsConfig) {
  const CLINIC_ID = await requireSessionClinicId();
  const [row] = await db
    .select({ config: clinicModules.config })
    .from(clinicModules)
    .where(
      and(
        eq(clinicModules.clinicId, CLINIC_ID),
        eq(clinicModules.moduleKey, "voice_tts"),
      ),
    )
    .limit(1);

  await db
    .update(clinicModules)
    .set({
      config: preserveVoiceOutputEnabled(config, row?.config),
      updatedAt: new Date(),
      updatedBy: "org_admin",
    })
    .where(
      and(
        eq(clinicModules.clinicId, CLINIC_ID),
        eq(clinicModules.moduleKey, "voice_tts"),
      ),
    );
  revalidatePath("/app/settings/playbook");
}

// Clínica pode ajustar apenas velocidade — voiceId e mode são controlados pelo owner
export async function updateBWaveSpeed(speed: number) {
  const CLINIC_ID = await requireSessionClinicId();
  const [row] = await db
    .select({ config: clinicModules.config })
    .from(clinicModules)
    .where(
      and(
        eq(clinicModules.clinicId, CLINIC_ID),
        eq(clinicModules.moduleKey, "voice_elevenlabs"),
      ),
    )
    .limit(1);

  if (!row) return;
  const current = (row.config ?? {}) as Partial<VoiceElevenLabsConfig>;
  const clampedSpeed = Math.min(1.2, Math.max(0.7, speed));

  await db
    .update(clinicModules)
    .set({
      config: { ...current, speed: clampedSpeed },
      updatedAt: new Date(),
      updatedBy: "org_admin",
    })
    .where(
      and(
        eq(clinicModules.clinicId, CLINIC_ID),
        eq(clinicModules.moduleKey, "voice_elevenlabs"),
      ),
    );
  revalidatePath("/app/settings/playbook");
}

export async function updateBWaveConfig(config: VoiceElevenLabsConfig) {
  const CLINIC_ID = await requireSessionClinicId();
  const mode: VoiceMode =
    config.mode === "mix" || config.mode === "full" ? config.mode : "impact";
  const [row] = await db
    .select({ config: clinicModules.config })
    .from(clinicModules)
    .where(
      and(
        eq(clinicModules.clinicId, CLINIC_ID),
        eq(clinicModules.moduleKey, "voice_elevenlabs"),
      ),
    )
    .limit(1);

  await db
    .update(clinicModules)
    .set({
      config: preserveVoiceOutputEnabled(
        {
          voiceId: config.voiceId.trim(),
          stability: Math.min(1, Math.max(0, config.stability)),
          similarityBoost: Math.min(1, Math.max(0, config.similarityBoost)),
          speed: Math.min(1.2, Math.max(0.7, config.speed)),
          mode,
        },
        row?.config,
      ),
      updatedAt: new Date(),
      updatedBy: "org_admin",
    })
    .where(
      and(
        eq(clinicModules.clinicId, CLINIC_ID),
        eq(clinicModules.moduleKey, "voice_elevenlabs"),
      ),
    );

  revalidatePath("/app/settings/playbook");
  revalidatePath(`/owner/clinics/${CLINIC_ID}`);
  revalidatePath(`/owner/clinics/${CLINIC_ID}/blueprint`);
  revalidatePath(`/owner/clinics/${CLINIC_ID}/modules`);
}

export async function deletePlaybookVersion(id: string) {
  const CLINIC_ID = await requireSessionClinicId();
  const [version] = await db
    .select({ status: playbookVersions.status })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, CLINIC_ID)))
    .limit(1);

  if (!version || version.status === "active") return;

  await db
    .delete(playbookVersions)
    .where(and(
      eq(playbookVersions.id, id),
      eq(playbookVersions.clinicId, CLINIC_ID),
      ne(playbookVersions.status, "active"),
    ));

  revalidatePath("/app/settings/playbook");
}
