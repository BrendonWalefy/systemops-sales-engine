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
  clinics,
  treatments,
  playbookVersions,
  clinicMembers,
} from "../src/infrastructure/db/schema";

type NewClinicConfig = {
  name: string;
  slug: string;
  specialty?: string;
  timezone?: string;
  businessHours?: string;
  greetingMessage?: string;
  channel: {
    provider: "z_api" | "meta_cloud_api";
    zapi?: { instanceId: string; token: string; clientToken?: string };
    meta?: { phoneNumberId: string; accessToken: string };
  };
  playbook: {
    commercialPolicy: string;
    procedureDescription?: string;
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
  admins: { email: string; role?: "owner" | "clinic_admin" }[];
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
    for (const i of parsed.error.issues) console.error(` - ${i.path.join('.')}: ${i.message}`);
    process.exit(1);
  }
  const now = new Date();

  // 1) clínica (upsert por slug)
  const existing = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.slug, cfg.slug))
    .limit(1)
    .then((r) => r[0] ?? null);

  const clinicValues = {
    name: cfg.name,
    slug: cfg.slug,
    specialty: cfg.specialty ?? "odontology",
    timezone: cfg.timezone ?? "America/Sao_Paulo",
    businessHours: cfg.businessHours ?? null,
    greetingMessage: cfg.greetingMessage ?? null,
    channelProvider: cfg.channel.provider,
    zapiInstanceId: cfg.channel.zapi?.instanceId ?? null,
    zapiToken: cfg.channel.zapi?.token ?? null,
    zapiClientToken: cfg.channel.zapi?.clientToken ?? null,
    metaPhoneNumberId: cfg.channel.meta?.phoneNumberId ?? null,
    metaAccessToken: cfg.channel.meta?.accessToken ?? null,
    updatedAt: now,
  };

  let clinicId: string;
  if (existing) {
    clinicId = existing.id;
    await db.update(clinics).set(clinicValues).where(eq(clinics.id, clinicId));
    console.log(`Clínica existente atualizada: ${cfg.name} (${clinicId})`);
  } else {
    const inserted = await db
      .insert(clinics)
      .values(clinicValues)
      .returning({ id: clinics.id });
    clinicId = inserted[0].id;
    console.log(`Clínica criada: ${cfg.name} (${clinicId})`);
  }

  // 2) playbook ativo (arquiva o anterior, publica o novo)
  await db
    .update(playbookVersions)
    .set({ status: "historical", updatedAt: now })
    .where(and(eq(playbookVersions.clinicId, clinicId), eq(playbookVersions.status, "active")));

  await db.insert(playbookVersions).values({
    clinicId,
    name: `Onboarding — ${now.toLocaleDateString("pt-BR")}`,
    status: "active",
    specialty: cfg.specialty ?? "odontology",
    procedureDescription: cfg.playbook.procedureDescription ?? "",
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
      .where(and(eq(treatments.clinicId, clinicId), eq(treatments.name, p.name)))
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
      await db.update(treatments).set(vals).where(eq(treatments.id, existsProc.id));
    } else {
      await db.insert(treatments).values(vals);
    }
  }
  console.log(`${(cfg.procedures ?? []).length} procedimento(s) sincronizado(s).`);

  // 4) admins vinculados
  for (const a of cfg.admins) {
    const email = a.email.trim().toLowerCase();
    const existsMember = await db
      .select({ id: clinicMembers.id })
      .from(clinicMembers)
      .where(and(eq(clinicMembers.email, email), eq(clinicMembers.clinicId, clinicId)))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!existsMember) {
      await db.insert(clinicMembers).values({
        clinicId,
        email,
        role: a.role ?? "clinic_admin",
      });
    }
  }
  console.log(`${cfg.admins.length} admin(s) vinculado(s).`);

  console.log("\n✅ Onboarding concluído.");
  console.log(`   clinicId: ${clinicId}`);
  console.log(`   slug:     ${cfg.slug}`);
  console.log("   Aponte o webhook do canal desta clínica para este ambiente e teste o checklist.");
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error("Falha no onboarding:", err);
    await sql.end();
    process.exit(1);
  });
