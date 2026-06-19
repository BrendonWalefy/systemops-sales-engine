"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  treatments,
  playbookVersions,
  clinicMembers,
} from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { onboardingConfigSchema } from "@/application/onboarding/onboarding-config";
import { hashPassword } from "@/lib/password";
import { resolveClinicCommercialSettings } from "@/application/onboarding/clinic-commercial-settings";
import { resolveInitialClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";
import { encryptCredentialNullable } from "@/infrastructure/crypto/credential-vault";
import { syncModulesForPlan } from "@/application/modules/module-gate";

export type OnboardingState = {
  ok: boolean;
  clinicId?: string;
  errors?: { field: string; message: string }[];
  message?: string;
};

async function requireOwner(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner";
}

export async function onboardClinic(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  if (!(await requireOwner())) {
    return { ok: false, message: "Apenas o owner pode cadastrar clínicas." };
  }

  // Monta o objeto a partir do form e valida pelo schema único.
  const provider =
    (formData.get("provider") as string) === "meta_cloud_api"
      ? "meta_cloud_api"
      : "z_api";
  const raw = {
    name: formData.get("name"),
    slug: formData.get("slug"),
    specialty: (formData.get("specialty") as string) || "odontology",
    segment: (formData.get("segment") as string) || "dental",
    serviceNoun: (formData.get("serviceNoun") as string) || "tratamento",
    timezone: (formData.get("timezone") as string) || "America/Sao_Paulo",
    businessHours: (formData.get("businessHours") as string) || undefined,
    greetingMessage: (formData.get("greetingMessage") as string) || undefined,
    receptionistPhone:
      (formData.get("receptionistPhone") as string) || undefined,
    calendarMode:
      (formData.get("calendarMode") as string) === "google_calendar"
        ? "google_calendar"
        : "internal",
    googleCalendarId: (formData.get("googleCalendarId") as string) || undefined,
    isTest: formData.get("isTest") === "on",
    plan: ((formData.get("plan") as string) || "custom") as
      | "essencial"
      | "clinica"
      | "rede"
      | "custom",
    billingActive: formData.get("billingActive") === "on",
    monthlyRevenueBrl: (() => {
      const rawValue = formData.get("monthlyRevenueBrl");
      if (typeof rawValue !== "string" || rawValue.trim() === "")
        return undefined;
      const parsedValue = Number(rawValue);
      return Number.isFinite(parsedValue) ? parsedValue : undefined;
    })(),
    billingStartedAt: (formData.get("billingStartedAt") as string) || undefined,
    channel: {
      provider,
      zapi:
        provider === "z_api"
          ? {
              instanceId: (formData.get("zapiInstanceId") as string) || "",
              token: (formData.get("zapiToken") as string) || "",
              clientToken:
                (formData.get("zapiClientToken") as string) || undefined,
            }
          : undefined,
      meta:
        provider === "meta_cloud_api"
          ? {
              phoneNumberId:
                (formData.get("metaPhoneNumberId") as string) || "",
              accessToken: (formData.get("metaAccessToken") as string) || "",
            }
          : undefined,
    },
    playbook: {
      commercialPolicy: (formData.get("commercialPolicy") as string) || "",
      toneOfVoice: (formData.get("toneOfVoice") as string) || "acolhedor",
      notes: (formData.get("notes") as string) || undefined,
    },
    admins: [
      {
        email: (formData.get("adminEmail") as string) || "",
        password: (formData.get("adminPassword") as string) || "",
        role: "clinic_admin" as const,
      },
    ],
  };

  const parsed = onboardingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    };
  }
  const cfg = parsed.data;
  const now = new Date();
  const commercialSettings = resolveClinicCommercialSettings({
    plan: cfg.plan,
    billingActive: cfg.billingActive,
    monthlyRevenueBrl: cfg.monthlyRevenueBrl,
    billingStartedAt: cfg.billingStartedAt,
    isTest: cfg.isTest,
  });

  // Slug único
  const slugTaken = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.slug, cfg.slug))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (slugTaken) {
    return {
      ok: false,
      errors: [
        { field: "slug", message: "já existe uma clínica com esse slug" },
      ],
    };
  }

  const inserted = await db
    .insert(clinics)
    .values({
      name: cfg.name,
      slug: cfg.slug,
      specialty: cfg.specialty,
      timezone: cfg.timezone,
      businessHours: cfg.businessHours ?? null,
      greetingMessage: cfg.greetingMessage ?? null,
      receptionistPhone: cfg.receptionistPhone ?? null,
      calendarMode: cfg.calendarMode,
      googleCalendarId: cfg.googleCalendarId ?? null,
      plan: commercialSettings.plan,
      operationalStatus: resolveInitialClinicOperationalStatus({
        isTest: commercialSettings.isTest,
      }),
      monthlyRevenueBrl: commercialSettings.monthlyRevenueBrl,
      billingStartedAt: commercialSettings.billingStartedAt,
      isTest: commercialSettings.isTest,
      channelProvider: cfg.channel.provider,
      zapiInstanceId: cfg.channel.zapi?.instanceId ?? null,
      zapiToken: encryptCredentialNullable(cfg.channel.zapi?.token),
      zapiClientToken: encryptCredentialNullable(cfg.channel.zapi?.clientToken),
      metaPhoneNumberId: cfg.channel.meta?.phoneNumberId ?? null,
      metaAccessToken: encryptCredentialNullable(cfg.channel.meta?.accessToken),
      segment: cfg.segment,
      serviceNoun: cfg.serviceNoun,
      updatedAt: now,
    })
    .returning({ id: clinics.id });
  const clinicId = inserted[0].id;

  await db.insert(playbookVersions).values({
    clinicId,
    name: `Onboarding — ${now.toLocaleDateString("pt-BR")}`,
    status: "active",
    specialty: cfg.specialty,
    procedureDescription: cfg.playbook.procedureDescription ?? "",
    toneOfVoice: cfg.playbook.toneOfVoice,
    commercialPolicy: cfg.playbook.commercialPolicy,
    notes: cfg.playbook.notes ?? null,
    differentials: cfg.playbook.differentials,
    objections: cfg.playbook.objections,
  });

  for (const p of cfg.procedures) {
    await db.insert(treatments).values({
      clinicId,
      name: p.name,
      durationMinutes: p.durationMinutes,
      description: p.description ?? null,
      requiresEvaluationFirst: p.requiresEvaluationFirst,
      updatedAt: now,
    });
  }

  await syncModulesForPlan(clinicId, commercialSettings.plan, "onboarding");

  for (const a of cfg.admins) {
    const email = a.email.toLowerCase();
    const passwordHash = await hashPassword(a.password);
    const exists = await db
      .select({ id: clinicMembers.id })
      .from(clinicMembers)
      .where(
        and(
          eq(clinicMembers.email, email),
          eq(clinicMembers.clinicId, clinicId),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!exists) {
      await db
        .insert(clinicMembers)
        .values({ clinicId, email, role: a.role, passwordHash });
    }
  }

  redirect(`/owner/clinics/${clinicId}`);
}
