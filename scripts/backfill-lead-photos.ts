#!/usr/bin/env tsx
/**
 * Backfill de fotos de perfil dos leads existentes.
 *
 * Para cada lead sem foto, busca via Z-API /profile-picture, re-hospeda
 * no Vercel Blob (URL permanente) e atualiza leads.profile_pic_url.
 *
 * A mesma lógica roda automaticamente no webhook para novos leads —
 * este script serve apenas para corrigir leads já cadastrados.
 *
 * Flags:
 *   --commit        aplica de fato (re-hospeda + grava no banco); padrão: dry-run
 *   --all           inclui leads que já têm profile_pic_url
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
import { resolveChannelConfig } from "../src/infrastructure/adapters/channels/whatsapp/channel-config";
import { fetchAndPersistLeadPhoto } from "../src/infrastructure/adapters/channels/whatsapp/lead-photo-service";

const { clinics, leads } = schema;

const COMMIT = process.argv.includes("--commit");
const INCLUDE_ALL = process.argv.includes("--all");
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? Number(arg.split("=")[1]) : Infinity;
})();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não definida");

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  console.log(
    `\nMODO: ${COMMIT ? "COMMIT (re-hospeda no Blob + grava no banco)" : "DRY-RUN (apenas consulta, nada é gravado)"}\n` +
      `Escopo: ${INCLUDE_ALL ? "todos os leads com telefone" : "leads SEM foto e com telefone"}\n`,
  );

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

  let updated = 0;
  let skipped = 0;

  for (const row of targets) {
    const label = row.name ?? row.phone ?? row.leadId;
    const config = resolveChannelConfig(row);

    if (!config.zapi || !config.zapi.instanceId || !config.zapi.token) {
      console.log(`  [skip] ${label} — clínica sem credenciais Z-API`);
      skipped++;
      continue;
    }

    if (!COMMIT) {
      console.log(`  [dry]  ${label} — seria processado`);
      continue;
    }

    const before = row.profilePicUrl;
    await fetchAndPersistLeadPhoto(row.leadId, row.phone!, config.zapi);

    // Re-lê para confirmar se gravou
    const after = await db.query.leads.findFirst({
      where: eq(leads.id, row.leadId),
      columns: { profilePicUrl: true },
    });

    if (after?.profilePicUrl && after.profilePicUrl !== before) {
      updated++;
      console.log(`  [ok]   ${label} — ${after.profilePicUrl.slice(0, 80)}…`);
    } else {
      skipped++;
      console.log(`  [vazio] ${label} — sem foto disponível na Z-API`);
    }
  }

  console.log("\n" + "=".repeat(70));
  if (COMMIT) {
    console.log(`Atualizados: ${updated}`);
    console.log(`Sem foto / pulados: ${skipped}`);
  } else {
    console.log(`Leads elegíveis encontrados: ${targets.length - skipped}`);
    console.log(`\n(dry-run — nada foi gravado. Rode com --commit para aplicar.)`);
  }
  console.log("=".repeat(70) + "\n");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
