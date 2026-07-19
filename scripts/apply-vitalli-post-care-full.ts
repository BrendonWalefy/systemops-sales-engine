#!/usr/bin/env tsx
/**
 * Régua de pós-atendimento COMPLETA da Vitalli (decisão 17/07: subir guia+vídeo
 * antes de aplicar). Faz, em ordem:
 *   1. Sobe as 2 mídias de cuidados que faltavam — guia completo (2ª imagem) e
 *      vídeo — que não couberam no cap de 15 do upload pela UI. O script insere
 *      direto (bypassa o cap): a Vitalli fica intencionalmente em 12 mídias.
 *      Idempotente por título — re-rodar não duplica.
 *   2. Grava organizations.post_appointment_rules:
 *      - cuidados-lentes (1h, operational): intro + [pos-1, guia, vídeo].
 *      - feedback-lentes (24h, follow_up, só se "completed"): texto do Victor.
 *
 * ⚠️ GATED: dry-run por padrão. Só grava/sobe com --apply.
 *
 *   Dry-run:  npx dotenv -e .env.local -- npx tsx scripts/apply-vitalli-post-care-full.ts
 *   Aplicar:  npx dotenv -e .env.local -- npx tsx scripts/apply-vitalli-post-care-full.ts --apply
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { put } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { mediaAssets, organizations } from "../src/infrastructure/db/schema";
import type { PostAppointmentRule } from "../src/domain/entities/post-appointment-rule";

const VITALLI_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const LENTES_TREATMENT_ID = "39b29140-f356-4a0c-aa36-be533aa58c8e";
const CUIDADOS_POS1_ID = "7e620435-40bc-46ba-8051-9d52732ec525"; // já na biblioteca (item-13-cuidados-pos-1)
const APPLY = process.argv.includes("--apply");

const CONTENT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../docs/product/client-validation/vitalli-07-2026/conteudo-victor-17-07",
);

type CareUpload = { file: string; title: string; type: "image" | "video"; contentType: string };
const UPLOADS: CareUpload[] = [
  { file: "item-13-cuidados-pos-2-texto.jpeg", title: "Cuidados Pós Lentes — guia", type: "image", contentType: "image/jpeg" },
  { file: "item-13-video-cuidados.mp4", title: "Cuidados Pós Lentes — vídeo", type: "video", contentType: "video/mp4" },
];

// Sobe (ou reaproveita, se já existe pelo título) e devolve o mediaId.
async function ensureMedia(u: CareUpload): Promise<string> {
  const [existing] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.clinicId, VITALLI_ID), eq(mediaAssets.title, u.title)))
    .limit(1);
  if (existing) {
    console.log(`  ↺ "${u.title}" já existe → ${existing.id}`);
    return existing.id;
  }

  const filePath = join(CONTENT_DIR, u.file);
  const sizeBytes = statSync(filePath).size;
  if (!APPLY) {
    console.log(`  ⬆︎ (dry-run) subiria "${u.title}" (${(sizeBytes / 1024).toFixed(0)} KB, ${u.type})`);
    return "(novo-no-apply)";
  }

  const ext = u.file.slice(u.file.lastIndexOf("."));
  const key = `media/clinic/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const blob = await put(key, readFileSync(filePath), {
    access: "public",
    contentType: u.contentType,
    multipart: sizeBytes > 5 * 1024 * 1024,
  });
  const assetId = randomUUID();
  await db.insert(mediaAssets).values({
    id: assetId,
    clinicId: VITALLI_ID,
    treatmentId: null, // GERAL — enviável pela régua sem gate de procedimento
    title: u.title,
    url: blob.url,
    type: u.type,
    mimeType: u.contentType,
    sizeBytes,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`  ✅ "${u.title}" (${(sizeBytes / 1024).toFixed(0)} KB) → ${assetId}`);
  return assetId;
}

async function main() {
  const [clinic] = await db
    .select({ name: organizations.name, rules: organizations.postAppointmentRules })
    .from(organizations)
    .where(eq(organizations.id, VITALLI_ID))
    .limit(1);
  if (!clinic) throw new Error("Vitalli não encontrada.");

  console.log(`Clínica: ${clinic.name}`);
  console.log("Mídias de cuidados:");
  const guiaId = await ensureMedia(UPLOADS[0]);
  const videoId = await ensureMedia(UPLOADS[1]);

  const rules: PostAppointmentRule[] = [
    {
      id: "cuidados-lentes",
      label: "Cuidados pós-lentes (1h)",
      offsetHours: 1,
      anchor: "appointment_end",
      treatmentIds: [LENTES_TREATMENT_ID],
      message:
        "Oi {nome}! Tudo certo? 😊 Seu procedimento de lentes em resina foi concluído — seguem os cuidados para as próximas horas garantirem o melhor resultado do seu novo sorriso 🦷✨",
      mediaIds: [CUIDADOS_POS1_ID, guiaId, videoId],
      category: "operational",
    },
    {
      id: "feedback-lentes",
      label: "Pedido de feedback (24h)",
      offsetHours: 24,
      anchor: "appointment_end",
      requiresStatus: "completed",
      treatmentIds: [LENTES_TREATMENT_ID],
      message:
        "Olá {nome}, tudo bem? 😊 Passando para saber como foi seu atendimento aqui na clínica e o que você achou do resultado das suas lentes em resina ✨🦷 Sua opinião é muito importante para nós!",
      category: "follow_up",
    },
  ];

  console.log(`\nRegras a gravar:\n${JSON.stringify(rules, null, 2)}`);

  if (!APPLY) {
    console.log("\nℹ️  Dry-run — nada gravado/subido. Rode com --apply.\n");
    process.exit(0);
  }

  await db
    .update(organizations)
    .set({ postAppointmentRules: rules, updatedAt: new Date() })
    .where(eq(organizations.id, VITALLI_ID));

  console.log("\n✅ Régua completa aplicada na Vitalli (cuidados com guia+vídeo, feedback 24h).");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
