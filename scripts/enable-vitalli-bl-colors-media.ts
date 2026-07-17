#!/usr/bin/env tsx
/**
 * Anexo determinístico da tabela de cores BL na Q&A de lentes da Vitalli
 * (pedido do Victor, reunião 17/07/2026): quando o lead pergunta sobre cor/tom
 * durante a conversa consultiva de lentes, o SISTEMA anexa a imagem
 * "Cores BL1, BL2 e BL3" — antes isso dependia da discrição do LLM (que nesse
 * ponto do fluxo não tem como anexar mídia), então a imagem nunca ia junto.
 *
 * Pluga `mediaOnKeywords` no step "qa" do tratamento de lentes. Idempotente.
 *
 * ⚠️ GATED: dry-run por padrão. Só grava com --apply.
 *
 *   Dry-run:  npx dotenv -e .env.local -- npx tsx scripts/enable-vitalli-bl-colors-media.ts
 *   Aplicar:  npx dotenv -e .env.local -- npx tsx scripts/enable-vitalli-bl-colors-media.ts --apply
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { treatments } from "../src/infrastructure/db/schema";
import type { PipelineStep } from "../src/domain/entities/treatment";

const LENTES_TREATMENT_ID = "39b29140-f356-4a0c-aa36-be533aa58c8e"; // Lentes em Resina Composta
const BL_COLORS_MEDIA_ID = "5d383eb4-7dce-4fe3-a14a-5fad569fe6a7"; // "Cores BL1, BL2 e BL3" (GERAL)
const APPLY = process.argv.includes("--apply");

const COLOR_KEYWORDS = [
  "cor",
  "cores",
  "tom",
  "tonalidade",
  "matiz",
  "branco",
  "branca",
  "clarinho",
  "clareza",
  "bl1",
  "bl2",
  "bl3",
  "bl 1",
  "bl 2",
  "bl 3",
];

async function main() {
  const [treatment] = await db
    .select({ id: treatments.id, name: treatments.name, steps: treatments.pipelineSteps })
    .from(treatments)
    .where(eq(treatments.id, LENTES_TREATMENT_ID))
    .limit(1);
  if (!treatment) throw new Error("Tratamento de lentes não encontrado.");

  const steps = (treatment.steps as PipelineStep[] | null) ?? [];
  const qaIndex = steps.findIndex((s) => s.type === "qa");
  if (qaIndex === -1) throw new Error(`Tratamento "${treatment.name}" não tem step qa.`);

  const before = JSON.stringify(steps[qaIndex]);
  const updatedSteps = steps.map((s, i) =>
    i === qaIndex && s.type === "qa"
      ? { ...s, mediaOnKeywords: [{ keywords: COLOR_KEYWORDS, mediaId: BL_COLORS_MEDIA_ID }] }
      : s,
  );

  console.log(`Tratamento: ${treatment.name} (${treatment.id})`);
  console.log(`Step qa no índice ${qaIndex}`);
  console.log(`Antes:  ${before}`);
  console.log(`Depois: ${JSON.stringify(updatedSteps[qaIndex])}`);

  if (!APPLY) {
    console.log("\nℹ️  Dry-run — nada gravado. Rode com --apply.\n");
    process.exit(0);
  }

  await db
    .update(treatments)
    .set({ pipelineSteps: updatedSteps, updatedAt: new Date() })
    .where(eq(treatments.id, LENTES_TREATMENT_ID));

  console.log("\n✅ mediaOnKeywords aplicado na Q&A de lentes (cores BL).");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
