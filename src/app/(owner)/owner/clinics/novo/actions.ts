"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { organizations, playbookVersions, clinicMembers } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { hashPassword } from "@/lib/password";
import { resolveClinicCommercialSettings } from "@/application/onboarding/clinic-commercial-settings";
import { resolveInitialClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";

export type ProspectState = {
  ok: boolean;
  errors?: Record<string, string>;
  message?: string;
};

async function requireOwner(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner";
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

export async function createProspectClinic(
  _prev: ProspectState,
  formData: FormData,
): Promise<ProspectState> {
  if (!(await requireOwner())) {
    return { ok: false, message: "Apenas o owner pode cadastrar clínicas." };
  }

  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const specialty = (formData.get("specialty") as string | null)?.trim() || "odontologia";
  const city = (formData.get("city") as string | null)?.trim() || null;
  const plan = (formData.get("plan") as string | null) as
    | "essencial"
    | "clinica"
    | "rede"
    | null;
  const adminEmail = (formData.get("adminEmail") as string | null)?.trim().toLowerCase() ?? "";
  const adminPassword = (formData.get("adminPassword") as string | null) ?? "";

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Nome da clínica é obrigatório";
  if (!adminEmail || !adminEmail.includes("@")) errors.adminEmail = "Email inválido";
  if (adminPassword.length < 8) errors.adminPassword = "Mínimo 8 caracteres";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const resolvedPlan = plan ?? "essencial";
  const commercialSettings = resolveClinicCommercialSettings({
    plan: resolvedPlan,
    billingActive: false,
    monthlyRevenueBrl: undefined,
    billingStartedAt: undefined,
    isTest: false,
  });

  let slug = toSlug(name);
  const taken = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (taken) slug = `${slug}-${randomSuffix()}`;

  const now = new Date();

  const [inserted] = await db
    .insert(organizations)
    .values({
      name,
      slug,
      specialty,
      city: city ?? null,
      timezone: "America/Sao_Paulo",
      plan: commercialSettings.plan,
      operationalStatus: resolveInitialClinicOperationalStatus({ isTest: false }),
      monthlyRevenueBrl: commercialSettings.monthlyRevenueBrl,
      isTest: false,
      autoReplyEnabled: false,
      updatedAt: now,
    })
    .returning({ id: organizations.id });

  const clinicId = inserted.id;

  await db.insert(playbookVersions).values({
    clinicId,
    name: `Pré-cadastro — ${now.toLocaleDateString("pt-BR")}`,
    status: "active",
    specialty,
    procedureDescription: "",
    toneOfVoice: "acolhedor",
    commercialPolicy: "A definir",
    notes: null,
    differentials: [],
    objections: [],
    mediaLibrary: [],
  });

  const passwordHash = await hashPassword(adminPassword);
  await db.insert(clinicMembers).values({
    clinicId,
    email: adminEmail,
    role: "clinic_admin",
    passwordHash,
  });

  redirect(`/owner/organizations/${clinicId}/blueprint`);
}
