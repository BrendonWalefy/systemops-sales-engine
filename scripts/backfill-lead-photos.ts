#!/usr/bin/env tsx
/**
 * Backfill / teste de fotos de perfil dos leads.
 *
 * Contexto: o webhook `senderPhoto` da Z-API chega vazio (0/41 leads têm foto)
 * e, mesmo quando vem, a URL do WhatsApp expira em 48h. A solução durável é
 * buscar a foto sob demanda via `GET /profile-picture` e re-hospedar no Vercel
 * Blob (URL permanente) antes de gravar em `leads.profile_pic_url`.
 *
 * Este script valida essa abordagem com os leads reais ANTES de tocar no
 * caminho quente do webhook:
 *
 *   - Dry-run (padrão): para cada lead com telefone, chama o endpoint da Z-API
 *     e reporta se há foto disponível. NÃO baixa, NÃO sobe no Blob, NÃO grava.
 *   - --commit: além de buscar, baixa a imagem, sobe no Vercel Blob e atualiza
 *     `leads.profile_pic_url` com a URL permanente.
 *
 * Flags:
 *   --commit        aplica de fato (re-hospeda + grava no banco)
 *   --all           inclui leads que já têm profile_pic_url (default: só os sem)
 *   --limit=N       processa no máximo N leads
 *
 * Uso:
 *   npx dotenv -e .env.local -- npx tsx scripts/backfill-lead-photos.ts
 *   npx dotenv -e .env.local -- npx tsx scripts/backfill-lead-photos.ts --commit
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import * as schema from "../src/infrastructure/db/schema";
import { resolveChannelConfig, type ZapiCreds } from "../src/infrastructure/adapters/channels/whatsapp/channel-config";
import { VercelBlobStorageGateway } from "../src/infrastructure/adapters/storage/vercel-blob-storage-gateway";

const { clinics, leads } = schema;

const COMMIT = process.argv.includes("--commit");
const INCLUDE_ALL = process.argv.includes("--all");
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? Number(arg.split("=")[1]) : Infinity;
})();

type ProfilePicResult =
  | { ok: true; link: string }
  | { ok: false; reason: string };

/** Z-API: GET /profile-picture?phone=... → { link } ou [{ link }] (formatos variam). */
async function fetchProfilePicture(phone: string, creds: ZapiCreds): Promise<ProfilePicResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (creds.clientToken) headers["Client-Token"] = creds.clientToken;

  let res: Response;
  try {
    res = await fetch(
      `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.token}/profile-picture?phone=${encodeURIComponent(phone)}`,
      { method: "GET", headers, signal: AbortSignal.timeout(10_000) },
    );
  } catch (err) {
    return { ok: false, reason: `erro de rede: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, reason: `HTTP ${res.status} ${body.slice(0, 120)}` };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: "resposta não-JSON" };
  }

  const entry = Array.isArray(data) ? data[0] : data;
  const link = entry && typeof entry === "object" ? (entry as { link?: unknown }).link : undefined;
  if (typeof link !== "string" || !link.startsWith("http")) {
    return { ok: false, reason: "sem foto disponível (link vazio)" };
  }
  return { ok: true, link };
}

async function rehostToBlob(
  link: string,
  leadId: string,
  storage: VercelBlobStorageGateway,
): Promise<string> {
  const res = await fetch(link, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`download da foto falhou (HTTP ${res.status})`);
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const bytes = await res.arrayBuffer();
  return storage.upload(`lead-avatars/${leadId}`, bytes, { contentType, folder: "lead-avatars" });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não definida");

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });
  const storage = new VercelBlobStorageGateway();

  console.log(
    `\nMODO: ${COMMIT ? "COMMIT (re-hospeda no Blob + grava no banco)" : "DRY-RUN (apenas consulta)"}\n` +
      `Escopo: ${INCLUDE_ALL ? "todos os leads com telefone" : "leads SEM foto e com telefone"}\n`,
  );

  // Carrega leads + credenciais Z-API da clínica de cada um.
  const rows = await db
    .select({
      leadId: leads.id,
      name: leads.name,
      phone: leads.phone,
      profilePicUrl: leads.profilePicUrl,
      channelProvider: clinics.channelProvider,
      zapiInstanceId: clinics.zapiInstanceId,
      zapiToken: clinics.zapiToken,
      zapiClientToken: clinics.zapiClientToken,
    })
    .from(leads)
    .innerJoin(clinics, eq(leads.clinicId, clinics.id))
    .where(
      and(
        isNotNull(leads.phone),
        INCLUDE_ALL ? undefined : isNull(leads.profilePicUrl),
      ),
    );

  const targets = rows.slice(0, LIMIT);
  console.log(`Leads a processar: ${targets.length}\n`);

  let available = 0;
  let unavailable = 0;
  let rehosted = 0;
  let errors = 0;

  for (const row of targets) {
    const label = row.name ?? row.phone ?? row.leadId;
    const config = resolveChannelConfig(row);
    if (!config.zapi || !config.zapi.instanceId || !config.zapi.token) {
      console.log(`  [skip] ${label} — clínica sem credenciais Z-API`);
      continue;
    }

    const result = await fetchProfilePicture(row.phone!, config.zapi);
    if (!result.ok) {
      unavailable++;
      console.log(`  [vazio] ${label} — ${result.reason}`);
      continue;
    }

    available++;
    if (!COMMIT) {
      console.log(`  [foto]  ${label} — disponível: ${result.link.slice(0, 80)}…`);
      continue;
    }

    try {
      const permanentUrl = await rehostToBlob(result.link, row.leadId, storage);
      await db
        .update(leads)
        .set({ profilePicUrl: permanentUrl, updatedAt: new Date() })
        .where(eq(leads.id, row.leadId));
      rehosted++;
      console.log(`  [ok]    ${label} — re-hospedada: ${permanentUrl.slice(0, 80)}…`);
    } catch (err) {
      errors++;
      console.error(`  [erro]  ${label} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`Com foto disponível na Z-API: ${available}`);
  console.log(`Sem foto / indisponível:       ${unavailable}`);
  if (COMMIT) {
    console.log(`Re-hospedadas no Blob + gravadas: ${rehosted}`);
    console.log(`Erros ao re-hospedar:            ${errors}`);
  } else {
    console.log(`\n(dry-run — nada foi gravado. Rode com --commit para aplicar.)`);
  }
  console.log("=".repeat(70) + "\n");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
