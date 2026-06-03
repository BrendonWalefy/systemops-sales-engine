import { cookies } from "next/headers";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics, clinicMembers } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME, type SessionPayload } from "@/lib/session";

/**
 * RESOLUÇÃO DE TENANT (qual clínica?).
 *
 * Existem três contextos e cada um resolve a clínica de uma forma:
 *  - Webhook (mensagem entrando): pela credencial do canal (instância Z-API
 *    ou phone_number_id da Meta) que recebeu a mensagem.
 *  - UI/rotas autenticadas: pela sessão do usuário logado.
 *  - Crons: rodam para TODAS as clínicas (ver listAllClinicIds).
 *
 * NUNCA resolva tenant por variável de ambiente global em código novo.
 */

/** Inbound Z-API: a instância que recebeu a mensagem identifica a clínica. */
export async function resolveClinicByZapiInstance(
  instanceId: string | null | undefined,
): Promise<string | null> {
  if (!instanceId) return null;
  const row = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.zapiInstanceId, instanceId))
    .limit(1)
    .then((r) => r[0] ?? null);
  return row?.id ?? null;
}

/** Inbound Meta: o phone_number_id do payload identifica a clínica. */
export async function resolveClinicByMetaPhoneNumberId(
  phoneNumberId: string | null | undefined,
): Promise<string | null> {
  if (!phoneNumberId) return null;
  const row = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.metaPhoneNumberId, phoneNumberId))
    .limit(1)
    .then((r) => r[0] ?? null);
  return row?.id ?? null;
}

/** Crons: lista todas as clínicas para iterar uma a uma. */
export async function listAllClinicIds(): Promise<string[]> {
  const rows = await db.select({ id: clinics.id }).from(clinics).orderBy(asc(clinics.createdAt));
  return rows.map((r) => r.id);
}

async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

const ACTIVE_CLINIC_COOKIE = "sops_active_clinic";

/**
 * Resolve a clínica do usuário logado.
 *  - clinic_admin → a clínica do seu vínculo em clinic_members.
 *  - owner → a clínica selecionada (cookie sops_active_clinic) ou, na ausência,
 *    a primeira clínica. Owner pode operar qualquer clínica.
 * Retorna null se não houver sessão válida ou vínculo.
 */
export async function getSessionClinicId(): Promise<string | null> {
  const session = await readSession();
  if (!session) return null;

  if (session.role === "owner") {
    const store = await cookies();
    const selected = store.get(ACTIVE_CLINIC_COOKIE)?.value;
    if (selected) {
      const exists = await db
        .select({ id: clinics.id })
        .from(clinics)
        .where(eq(clinics.id, selected))
        .limit(1)
        .then((r) => r[0] ?? null);
      if (exists) return exists.id;
    }
    const first = await db
      .select({ id: clinics.id })
      .from(clinics)
      .orderBy(asc(clinics.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null);
    return first?.id ?? null;
  }

  // clinic_admin: resolve pelo vínculo
  const member = await db
    .select({ clinicId: clinicMembers.clinicId })
    .from(clinicMembers)
    .where(eq(clinicMembers.email, session.email))
    .limit(1)
    .then((r) => r[0] ?? null);

  return member?.clinicId ?? null;
}

/**
 * Versão que lança se não resolver — para rotas que não podem prosseguir sem
 * tenant. Evita o antigo padrão de `clinicId ?? ""` que silenciava o erro.
 */
export async function requireSessionClinicId(): Promise<string> {
  const id = await getSessionClinicId();
  if (!id) throw new Error("Sem clínica resolvida para a sessão atual");
  return id;
}

/** Confirma que o usuário logado pode agir sobre a clínica informada. */
export async function assertSessionCanAccessClinic(clinicId: string): Promise<boolean> {
  const session = await readSession();
  if (!session) return false;
  if (session.role === "owner") return true;
  const member = await db
    .select({ id: clinicMembers.id })
    .from(clinicMembers)
    .where(and(eq(clinicMembers.email, session.email), eq(clinicMembers.clinicId, clinicId)))
    .limit(1)
    .then((r) => r[0] ?? null);
  return member !== null;
}
