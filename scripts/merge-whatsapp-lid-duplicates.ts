#!/usr/bin/env tsx
/**
 * Mescla leads duplicados da mesma clínica: um com telefone real e outro com @lid
 * (ou @lid ainda na coluna phone antes da migração).
 *
 * Uso: npx dotenv -e .env.local -- npx tsx scripts/merge-whatsapp-lid-duplicates.ts
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { DrizzleLeadRepository } from "../src/infrastructure/repositories/drizzle-lead-repository";

const envPath = new URL("../.env.local", import.meta.url).pathname;
const env = readFileSync(envPath, "utf-8");
const dbUrl = env.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL não encontrado no .env.local");

const sql = neon(dbUrl);
const leadRepo = new DrizzleLeadRepository();

type PairRow = {
  phone_lead_id: string;
  lid_lead_id: string;
  name: string;
};

const pairs = (await sql`
  SELECT
    phone_lead.id AS phone_lead_id,
    lid_lead.id AS lid_lead_id,
    phone_lead.name
  FROM leads phone_lead
  JOIN leads lid_lead
    ON phone_lead.clinic_id = lid_lead.clinic_id
    AND phone_lead.id <> lid_lead.id
    AND phone_lead.phone IS NOT NULL
    AND phone_lead.phone NOT LIKE '%@lid%'
    AND (
      lid_lead.whatsapp_lid IS NOT NULL
      OR lid_lead.phone LIKE '%@lid%'
    )
    AND lower(trim(coalesce(phone_lead.name, ''))) = lower(trim(coalesce(lid_lead.name, '')))
    AND trim(coalesce(phone_lead.name, '')) <> ''
`) as PairRow[];

console.log(`Encontrados ${pairs.length} par(es) candidato(s) a merge.`);

for (const pair of pairs) {
  console.log(`  Mesclando "${pair.name}" — canônico=${pair.phone_lead_id.slice(0, 8)} dup=${pair.lid_lead_id.slice(0, 8)}`);
  await leadRepo.mergeDuplicateLeads({
    canonicalLeadId: pair.phone_lead_id,
    duplicateLeadId: pair.lid_lead_id,
  });
}

// Move @lid remanescentes da coluna phone para whatsapp_lid
const moved = await sql`
  UPDATE leads
  SET whatsapp_lid = phone, phone = NULL, updated_at = NOW()
  WHERE phone LIKE '%@lid%' AND (whatsapp_lid IS NULL OR whatsapp_lid = '')
  RETURNING id, name, whatsapp_lid
`;

if (moved.length > 0) {
  console.log(`\nMovidos ${moved.length} @lid da coluna phone para whatsapp_lid.`);
}

console.log("\nConcluído.");
