/**
 * NC Beauty — sobe uma mídia para a biblioteca da clínica e vincula ao
 * procedimento + playbook ativo, replicando o que a rota /api/media/upload faz:
 *
 *   1. upload no Vercel Blob (prefixo permanente `media/clinic/`);
 *   2. row em `media_assets` (dona do arquivo, clinic-level, com treatmentId);
 *   3. id adicionado ao `media_asset_ids` do playbook ATIVO (curadoria que
 *      autoriza a IA a enviar — sem isso a mídia não entra no prompt).
 *
 * Respeita o cap de 10 mídias por clínica (mesma régua da rota).
 *
 * Uso:
 *   npx dotenv -e .env.local -- npx tsx scripts/upload-nc-media.ts \
 *     "scripts/nc-media/Limpeza Facial Premium.mp4" "SPA Facial Premium" ["Título"]
 *
 * O 2º argumento é o NOME EXATO do treatment (gate de isolamento: a IA só vê a
 * mídia quando esse procedimento está ativo na conversa). O 3º é o título na
 * biblioteca (default: nome do arquivo sem extensão) — é por ele que o notes do
 * playbook referencia o vídeo.
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { put } from "@vercel/blob";
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  mediaAssets,
  playbookVersions,
  treatments,
} from "../src/infrastructure/db/schema";

const CLINIC_ID = "2b0028b1-6bf3-42d7-852e-62a8b5ca1035";
const MAX_ASSETS_PER_CLINIC = 10;

const CONTENT_TYPES: Record<string, { contentType: string; type: "video" | "image" }> = {
  ".mp4": { contentType: "video/mp4", type: "video" },
  ".mov": { contentType: "video/quicktime", type: "video" },
  ".webm": { contentType: "video/webm", type: "video" },
  ".jpg": { contentType: "image/jpeg", type: "image" },
  ".jpeg": { contentType: "image/jpeg", type: "image" },
  ".png": { contentType: "image/png", type: "image" },
  ".webp": { contentType: "image/webp", type: "image" },
};

const filePath = process.argv[2];
const treatmentName = process.argv[3];
if (!filePath || !treatmentName) {
  console.error('Uso: tsx scripts/upload-nc-media.ts <arquivo> "<nome do treatment>" ["Título"]');
  process.exit(1);
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL não definido"); process.exit(1); }
if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("❌ BLOB_READ_WRITE_TOKEN não definido"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

async function main() {
  const ext = extname(filePath).toLowerCase();
  const meta = CONTENT_TYPES[ext];
  if (!meta) { console.error(`❌ Extensão não suportada: ${ext}`); process.exit(1); }

  const title = process.argv[4] ?? basename(filePath, extname(filePath));
  const sizeBytes = statSync(filePath).size;
  if (sizeBytes > 100 * 1024 * 1024) { console.error("❌ Arquivo acima de 100 MB"); process.exit(1); }

  // Treatment dono (gate de isolamento por procedimento)
  const treatment = await db
    .select({ id: treatments.id, name: treatments.name })
    .from(treatments)
    .where(and(eq(treatments.clinicId, CLINIC_ID), eq(treatments.name, treatmentName)))
    .then((r) => r[0] ?? null);
  if (!treatment) { console.error(`❌ Treatment "${treatmentName}" não encontrado na clínica`); process.exit(1); }

  // Cap de biblioteca (mesma régua da rota /api/media/upload)
  const existing = await db
    .select({ id: mediaAssets.id, title: mediaAssets.title })
    .from(mediaAssets)
    .where(eq(mediaAssets.clinicId, CLINIC_ID));
  if (existing.some((a) => a.title === title)) {
    console.error(`❌ Já existe mídia com o título "${title}" — remova antes ou use outro título`);
    process.exit(1);
  }
  if (existing.length >= MAX_ASSETS_PER_CLINIC) {
    console.error(`❌ Limite de ${MAX_ASSETS_PER_CLINIC} mídias atingido`);
    process.exit(1);
  }

  // 1. Blob (prefixo permanente — o cron de limpeza só toca `tts/`)
  const key = `media/clinic/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const data = readFileSync(filePath);
  console.log(`⬆️  Subindo ${basename(filePath)} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)...`);
  const blob = await put(key, data, {
    access: "public",
    contentType: meta.contentType,
    multipart: sizeBytes > 5 * 1024 * 1024,
  });
  console.log(`✅ Blob: ${blob.url}`);

  // 2. media_assets (dona do arquivo)
  const assetId = randomUUID();
  await db.insert(mediaAssets).values({
    id: assetId,
    clinicId: CLINIC_ID,
    treatmentId: treatment.id,
    title,
    url: blob.url,
    type: meta.type,
    mimeType: meta.contentType,
    sizeBytes,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`✅ media_assets: "${title}" → ${treatment.name} (${assetId})`);

  // 3. Curadoria no playbook ativo (idempotente)
  const active = await db
    .select({ id: playbookVersions.id, mediaAssetIds: playbookVersions.mediaAssetIds })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, CLINIC_ID), eq(playbookVersions.status, "active")))
    .then((r) => r[0] ?? null);
  if (!active) { console.error("❌ Nenhum playbook ativo — rode seed-nc-beauty-config.ts antes"); process.exit(1); }

  const ids = new Set([...(active.mediaAssetIds ?? []), assetId]);
  await db
    .update(playbookVersions)
    .set({ mediaAssetIds: [...ids], updatedAt: new Date() })
    .where(eq(playbookVersions.id, active.id));
  console.log(`✅ Playbook ativo autoriza ${ids.size} mídia(s)`);

  await sql.end();
}

main().catch(async (err) => {
  console.error("❌ Erro:", err);
  await sql.end();
  process.exit(1);
});
