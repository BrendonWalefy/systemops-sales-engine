"use server";

import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  playbookVersions,
  treatments,
} from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import type { PipelineStep } from "@/domain/entities/treatment";
import { resolveTreatmentIdsToDelete } from "@/application/onboarding/treatment-sync";
import {
  resolveClinicCommercialSettings,
  type OrgPlan,
} from "@/application/onboarding/clinic-commercial-settings";
import { resolveOperationalStatusFromAutomationState } from "@/application/clinics/clinic-operational-status";
import { encryptCredentialNullable } from "@/infrastructure/crypto/credential-vault";

type Result = { success: boolean; error?: string };

async function requireOwner(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner";
}

async function getActivePlaybookId(clinicId: string): Promise<string | null> {
  const pv = await db.query.playbookVersions.findFirst({
    where: and(
      eq(playbookVersions.clinicId, clinicId),
      eq(playbookVersions.status, "active"),
    ),
    columns: { id: true },
  });
  return pv?.id ?? null;
}

export async function saveWizardIdentity(
  clinicId: string,
  data: {
    specialty: string;
    city: string;
    address: string;
    addressComplement: string;
    mapsUrl: string;
    greetingMessage: string;
    channelProvider: "z_api" | "meta_cloud_api";
    zapiInstanceId: string;
    zapiToken: string;
    zapiClientToken: string;
    metaPhoneNumberId: string;
    metaAccessToken: string;
  },
): Promise<Result> {
  if (!(await requireOwner()))
    return { success: false, error: "Sem permissão" };
  try {
    const { zapiToken, zapiClientToken, metaAccessToken, ...rest } = data;
    // Campo vazio = "não alterar", não "apagar". O wizard nunca preenche estes
    // três campos com o valor salvo (channel-pairing e channel-provision não
    // serializam segredos ao client) — sobrescrever incondicionalmente apagaria
    // a credencial a cada "Próximo" clicado sem o campo preenchido de novo.
    const secretUpdates: Partial<Record<"zapiToken" | "zapiClientToken" | "metaAccessToken", string | null>> = {};
    if (zapiToken) secretUpdates.zapiToken = encryptCredentialNullable(zapiToken);
    if (zapiClientToken) secretUpdates.zapiClientToken = encryptCredentialNullable(zapiClientToken);
    if (metaAccessToken) secretUpdates.metaAccessToken = encryptCredentialNullable(metaAccessToken);

    await db
      .update(organizations)
      .set({
        ...rest,
        ...secretUpdates,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, clinicId));
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export async function saveWizardReceptionist(
  clinicId: string,
  data: { toneOfVoice: string; differentials: string[] },
): Promise<Result> {
  if (!(await requireOwner()))
    return { success: false, error: "Sem permissão" };
  try {
    const pvId = await getActivePlaybookId(clinicId);
    if (!pvId)
      return { success: false, error: "Playbook ativo não encontrado" };
    await db
      .update(playbookVersions)
      .set({
        toneOfVoice: data.toneOfVoice,
        differentials: data.differentials,
        updatedAt: new Date(),
      })
      .where(eq(playbookVersions.id, pvId));
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export async function saveWizardSchedule(
  clinicId: string,
  data: {
    businessHours: string;
    calendarMode: "internal" | "google_calendar";
    googleCalendarId: string;
    receptionistPhone: string;
    defaultAppointmentDurationMinutes: number;
    postAppointmentBufferMinutes: number;
    takeoverTtlHours: number;
  },
): Promise<Result> {
  if (!(await requireOwner()))
    return { success: false, error: "Sem permissão" };
  try {
    await db
      .update(organizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(organizations.id, clinicId));
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export type WizardTreatment = {
  id?: string;
  name: string;
  durationMinutes: number;
  requiresEvaluationFirst: boolean;
  isAesthetic: boolean;
  aliases: string;
};

export async function saveWizardTreatments(
  clinicId: string,
  items: WizardTreatment[],
): Promise<Result & { savedIds: { tempKey: string; id: string }[] }> {
  if (!(await requireOwner()))
    return { success: false, error: "Sem permissão", savedIds: [] };
  try {
    const existing = await db.query.treatments.findMany({
      where: eq(treatments.clinicId, clinicId),
      columns: { id: true },
    });

    const existingIds = existing.map((t) => t.id);
    const incomingIds = items.filter((t) => t.id).map((t) => t.id!);
    const toDelete = resolveTreatmentIdsToDelete(existingIds, incomingIds);

    if (toDelete.length > 0) {
      await db
        .delete(treatments)
        .where(
          and(
            eq(treatments.clinicId, clinicId),
            inArray(treatments.id, toDelete),
          ),
        );
    }

    const savedIds: { tempKey: string; id: string }[] = [];

    for (const item of items) {
      const aliasArray = item.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      if (item.id) {
        await db
          .update(treatments)
          .set({
            name: item.name,
            durationMinutes: item.durationMinutes,
            requiresEvaluationFirst: item.requiresEvaluationFirst,
            isAesthetic: item.isAesthetic,
            aliases: aliasArray,
            updatedAt: new Date(),
          })
          .where(eq(treatments.id, item.id));
        savedIds.push({ tempKey: item.id, id: item.id });
      } else {
        const [row] = await db
          .insert(treatments)
          .values({
            clinicId,
            name: item.name,
            durationMinutes: item.durationMinutes,
            requiresEvaluationFirst: item.requiresEvaluationFirst,
            isAesthetic: item.isAesthetic,
            aliases: aliasArray,
            keywordMatchEnabled: true,
            pipelineSteps: null,
          })
          .returning({ id: treatments.id });
        savedIds.push({ tempKey: item.name, id: row.id });
      }
    }

    return { success: true, savedIds };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Erro",
      savedIds: [],
    };
  }
}

export async function saveWizardPipelines(
  pipelines: { treatmentId: string; steps: PipelineStep[] }[],
): Promise<Result> {
  if (!(await requireOwner()))
    return { success: false, error: "Sem permissão" };
  try {
    for (const { treatmentId, steps } of pipelines) {
      await db
        .update(treatments)
        .set({
          pipelineSteps: steps.length > 0 ? steps : null,
          updatedAt: new Date(),
        })
        .where(eq(treatments.id, treatmentId));
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export async function saveWizardPolicy(
  clinicId: string,
  data: {
    commercialPolicy: string;
    notes: string;
    plan: OrgPlan;
    billingActive: boolean;
    monthlyRevenueBrl?: number;
    billingStartedAt?: string;
    isTest: boolean;
  },
): Promise<Result> {
  if (!(await requireOwner()))
    return { success: false, error: "Sem permissão" };
  try {
    const pvId = await getActivePlaybookId(clinicId);
    if (!pvId)
      return { success: false, error: "Playbook ativo não encontrado" };
    const clinic = await db.query.organizations.findFirst({
      where: eq(organizations.id, clinicId),
      columns: {
        autoReplyEnabled: true,
        operationalStatus: true,
      },
    });
    if (!clinic) return { success: false, error: "Organização não encontrada" };

    const commercial = resolveClinicCommercialSettings({
      plan: data.plan,
      billingActive: data.billingActive,
      monthlyRevenueBrl: data.monthlyRevenueBrl,
      billingStartedAt: data.billingStartedAt,
      isTest: data.isTest,
    });

    await db
      .update(playbookVersions)
      .set({
        commercialPolicy: data.commercialPolicy,
        notes: data.notes,
        updatedAt: new Date(),
      })
      .where(eq(playbookVersions.id, pvId));

    await db
      .update(organizations)
      .set({
        plan: commercial.plan,
        operationalStatus: resolveOperationalStatusFromAutomationState({
          currentStatus: clinic.operationalStatus,
          isTest: commercial.isTest,
          autoReplyEnabled: clinic.autoReplyEnabled,
        }),
        monthlyRevenueBrl: commercial.monthlyRevenueBrl,
        billingStartedAt: commercial.billingStartedAt,
        isTest: commercial.isTest,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, clinicId));

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erro" };
  }
}
