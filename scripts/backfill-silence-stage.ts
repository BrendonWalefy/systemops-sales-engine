#!/usr/bin/env tsx
/**
 * Motor de Reativação (ADR-009) — backfill do estágio do silêncio.
 *
 * Preenche `lead_outcomes.silence_stage` para classificações feitas antes do
 * campo existir. Não chama LLM: o estágio é computado do histórico de mensagens
 * (`computeSilenceStage`), então rodar isto é gratuito e idempotente.
 *
 * Uso:
 *   npx dotenv -e .env.local -- tsx scripts/backfill-silence-stage.ts          # simulação
 *   npx dotenv -e .env.local -- tsx scripts/backfill-silence-stage.ts --aplicar
 */

import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  computeSilenceStage,
  SILENCE_STAGE_LABELS,
  type SilenceStage,
  type StageMessage,
} from "@/core/intelligence/silence-stage";

const aplicar = process.argv.includes("--aplicar");
if (!aplicar) {
  console.log("SIMULAÇÃO — nada será gravado. Use --aplicar para persistir.\n");
}

const pendentes = await db.execute(sql`
  SELECT lo.id, lo.conversation_id, lo.organization_id, lo.reason::text AS reason,
         o.name AS clinica
  FROM lead_outcomes lo
  JOIN organizations o ON o.id = lo.organization_id
  WHERE lo.silence_stage IS NULL
    AND lo.conversation_id IS NOT NULL
  ORDER BY lo.classified_at DESC
`);

const linhas = pendentes.rows as Array<{
  id: string;
  conversation_id: string;
  organization_id: string;
  reason: string;
  clinica: string;
}>;

/**
 * Mídias de preço por clínica, em cache. Clínicas que mandam os valores em arte
 * (a Vitalli faz isso por decisão do dentista) gravam a imagem como mensagem de
 * texto com o título no corpo — sem esta lista, o backfill marcaria como
 * "perguntou e não foi respondida" quem recebeu a tabela completa.
 */
const midiasPorClinica = new Map<string, Set<string>>();
async function titulosDePreco(clinicId: string): Promise<Set<string>> {
  const cache = midiasPorClinica.get(clinicId);
  if (cache) return cache;
  const r = await db.execute(sql`
    SELECT title FROM media_assets
    WHERE organization_id = ${clinicId}
      AND title ~* 'valor|preç|preco|pacote|investiment|tabela'
  `);
  const set = new Set(
    (r.rows as Array<{ title: string }>).map((x) => x.title.trim()),
  );
  midiasPorClinica.set(clinicId, set);
  return set;
}

console.log(`${linhas.length} classificações sem estágio.\n`);

const contagem = new Map<SilenceStage, number>();
const cruzamento = new Map<string, number>();

for (const linha of linhas) {
  const msgs = await db.execute(sql`
    SELECT author, body FROM messages
    WHERE conversation_id = ${linha.conversation_id}
      AND author IN ('lead', 'agent', 'clinic_user')
    ORDER BY sent_at ASC
  `);

  const stage = computeSilenceStage(
    msgs.rows as StageMessage[],
    await titulosDePreco(linha.organization_id),
  );
  contagem.set(stage, (contagem.get(stage) ?? 0) + 1);

  const chave = `${linha.reason} → ${stage}`;
  cruzamento.set(chave, (cruzamento.get(chave) ?? 0) + 1);

  if (aplicar) {
    await db.execute(sql`
      UPDATE lead_outcomes SET silence_stage = ${stage}::silence_stage, updated_at = NOW()
      WHERE id = ${linha.id}
    `);
  }
}

console.log("Distribuição por estágio:");
for (const [stage, n] of [...contagem.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = Math.round((n / linhas.length) * 100);
  console.log(`  ${String(n).padStart(3)} (${String(pct).padStart(2)}%)  ${SILENCE_STAGE_LABELS[stage]}`);
}

console.log("\nCruzamento motivo → estágio:");
for (const [chave, n] of [...cruzamento.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${chave}`);
}

console.log(
  aplicar
    ? "\nAplicado."
    : "\nNada gravado. Rode com --aplicar para persistir.",
);
