/**
 * RECEITA DE BOLO — Onboarding de uma clínica nova de ponta a ponta.
 *
 * Cria, de forma idempotente (pelo slug):
 *   1. a clínica, com timezone, horário e credenciais de canal próprias;
 *   2. uma versão de playbook ATIVA (fonte única editorial);
 *   3. os procedimentos (treatments) com duração e regra de avaliação;
 *   4. o vínculo do(s) admin(s) em clinic_members.
 *
 * Uso:
 *   npx dotenv -e .env.local -- npx tsx scripts/create-clinic.ts ./clinic-nova.json
 *
 * O JSON segue o formato de docs/onboarding-clinica.md. Rodar de novo com o
 * mesmo slug ATUALIZA a clínica e republica o playbook (não duplica).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import { onboardingConfigSchema } from "../src/application/onboarding/onboarding-config";
import {
  organizations,
  treatments,
  playbookVersions,
  clinicMembers,
} from "../src/infrastructure/db/schema";
import { hashPassword } from "../src/lib/password";
import { resolveClinicCommercialSettings } from "../src/application/onboarding/clinic-commercial-settings";
import { resolveInitialClinicOperationalStatus } from "../src/application/clinics/clinic-operational-status";
import { resolveSegmentVocab } from "../src/application/onboarding/segment-vocab";
import { encryptCredentialNullable } from "../src/infrastructure/crypto/credential-vault";
import { syncModulesForPlan } from "../src/application/modules/module-gate";

type NewClinicConfig = {
  name: string;
  slug: string;
  segment?: string;
  specialty?: string;
  timezone?: string;
  businessHours?: string;
  greetingMessage?: string;
  receptionistPhone?: string;
  calendarMode?: "internal" | "google_calendar";
  googleCalendarId?: string;
  isTest?: boolean;
  plan?: "essencial" | "avancado" | "rede" | "custom";
  billingActive?: boolean;
  monthlyRevenueBrl?: number;
  billingStartedAt?: string;
  channel: {
    provider: "z_api" | "meta_cloud_api";
    zapi?: { instanceId: string; token: string; clientToken?: string };
    meta?: { phoneNumberId: string; accessToken: string; appSecret: string };
  };
  playbook: {
    commercialPolicy: string;
    toneOfVoice?: string;
    differentials?: string[];
    objections?: { objection: string; response: string }[];
    notes?: string;
  };
  procedures?: {
    name: string;
    durationMinutes?: number;
    description?: string;
    requiresEvaluationFirst?: boolean;
  }[];
  admins: {
    email: string;
    password: string;
    role?: "owner" | "org_admin";
    // Nome amigável exibido na saudação do dashboard (ex.: "Dr. Gregorie").
    displayName?: string;
  }[];
};

const configPath = process.argv[2];
if (!configPath) {
  console.error("Uso: tsx scripts/create-clinic.ts <config.json>");
  process.exit(1);
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL não definido");
  process.exit(1);
}

const cfg: NewClinicConfig = JSON.parse(readFileSync(configPath, "utf8"));
const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

async function main() {
  const parsed = onboardingConfigSchema.safeParse(cfg);
  if (!parsed.success) {
    console.error("Configuração inválida:");
    for (const i of parsed.error.issues)
      console.error(` - ${i.path.join(".")}: ${i.message}`);
    process.exit(1);
  }
  const now = new Date();
  const commercialSettings = resolveClinicCommercialSettings({
    plan: parsed.data.plan,
    billingActive: parsed.data.billingActive,
    monthlyRevenueBrl: parsed.data.monthlyRevenueBrl,
    billingStartedAt: parsed.data.billingStartedAt,
    isTest: parsed.data.isTest,
  });

  // 1) clínica (upsert por slug)
  const existing = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, cfg.slug))
    .limit(1)
    .then((r) => r[0] ?? null);

  const segment = cfg.segment ?? "dental";
  const segmentVocab = resolveSegmentVocab(segment);

  const clinicValues = {
    name: cfg.name,
    slug: cfg.slug,
    segment,
    specialty: cfg.specialty ?? "odontology",
    timezone: cfg.timezone ?? "America/Sao_Paulo",
    businessHours: cfg.businessHours ?? null,
    greetingMessage: cfg.greetingMessage ?? null,
    receptionistPhone: cfg.receptionistPhone ?? null,
    calendarMode: cfg.calendarMode ?? "internal",
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
    metaAppSecret: encryptCredentialNullable(cfg.channel.meta?.appSecret),
    agentRole: segmentVocab.agentRole,
    bookingNoun: segmentVocab.bookingNoun,
    contactNoun: segmentVocab.contactNoun,
    businessDescriptor: segmentVocab.businessDescriptor,
    updatedAt: now,
  };

  let clinicId: string;
  if (existing) {
    clinicId = existing.id;
    await db.update(organizations).set(clinicValues).where(eq(organizations.id, clinicId));
    console.log(`Clínica existente atualizada: ${cfg.name} (${clinicId})`);
  } else {
    const inserted = await db
      .insert(organizations)
      .values(clinicValues)
      .returning({ id: organizations.id });
    clinicId = inserted[0].id;
    console.log(`Clínica criada: ${cfg.name} (${clinicId})`);
  }

  // 2) playbook ativo (arquiva o anterior, publica o novo)
  await db
    .update(playbookVersions)
    .set({ status: "historical", updatedAt: now })
    .where(
      and(
        eq(playbookVersions.clinicId, clinicId),
        eq(playbookVersions.status, "active"),
      ),
    );

  await db.insert(playbookVersions).values({
    clinicId,
    name: `Onboarding — ${now.toLocaleDateString("pt-BR")}`,
    status: "active",
    specialty: cfg.specialty ?? "odontology",
    toneOfVoice: cfg.playbook.toneOfVoice ?? "acolhedor",
    commercialPolicy: cfg.playbook.commercialPolicy,
    notes: cfg.playbook.notes ?? null,
    differentials: cfg.playbook.differentials ?? [],
    objections: cfg.playbook.objections ?? [],
  });
  console.log("Playbook ativo publicado.");

  // 3) procedimentos (upsert por nome dentro da clínica)
  for (const p of cfg.procedures ?? []) {
    const existsProc = await db
      .select({ id: treatments.id })
      .from(treatments)
      .where(
        and(eq(treatments.clinicId, clinicId), eq(treatments.name, p.name)),
      )
      .limit(1)
      .then((r) => r[0] ?? null);
    const vals = {
      clinicId,
      name: p.name,
      durationMinutes: p.durationMinutes ?? 60,
      description: p.description ?? null,
      requiresEvaluationFirst: p.requiresEvaluationFirst ?? false,
      updatedAt: now,
    };
    if (existsProc) {
      await db
        .update(treatments)
        .set(vals)
        .where(eq(treatments.id, existsProc.id));
    } else {
      await db.insert(treatments).values(vals);
    }
  }
  console.log(
    `${(cfg.procedures ?? []).length} procedimento(s) sincronizado(s).`,
  );

  // 4) admins vinculados
  for (const a of cfg.admins) {
    const email = a.email.trim().toLowerCase();
    const passwordHash = await hashPassword(a.password);
    const displayName = a.displayName?.trim() || null;
    const existsMember = await db
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
    if (existsMember) {
      await db
        .update(clinicMembers)
        .set({ role: a.role ?? "org_admin", passwordHash, displayName })
        .where(eq(clinicMembers.id, existsMember.id));
    } else {
      await db.insert(clinicMembers).values({
        clinicId,
        email,
        role: a.role ?? "org_admin",
        passwordHash,
        displayName,
      });
    }
  }
  console.log(`${cfg.admins.length} admin(s) vinculado(s).`);

  await syncModulesForPlan(clinicId, commercialSettings.plan, "create-clinic");
  console.log(`Módulos sincronizados para plano ${commercialSettings.plan}.`);

  console.log("\n✅ Onboarding concluído.");
  console.log(`   clinicId: ${clinicId}`);
  console.log(`   slug:     ${cfg.slug}`);
  console.log(
    "   Aponte o webhook do canal desta clínica para este ambiente e teste o checklist.",
  );
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error("Falha no onboarding:", err);
    await sql.end();
    process.exit(1);
  });
