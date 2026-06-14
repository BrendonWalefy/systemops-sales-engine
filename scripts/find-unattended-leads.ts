#!/usr/bin/env tsx
// Levanta todos os leads que estão sem resposta da IA ou humano.
// Critérios:
// 1. ai_paused=true com takeover_expires_at expirado (ninguém assumiu)
// 2. Última mensagem é do LEAD e tem mais de 2h sem resposta (IA parou de responder)
// 3. status=waiting_response com último autor sendo lead

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url).pathname, "utf-8");
const dbUrl = env.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL não encontrado");

const sql = neon(dbUrl);
const now = new Date();

// 1. Takeover expirado com IA pausada
const expiredTakeovers = await sql`
  SELECT
    l.name,
    l.phone,
    l.temperature,
    l.status as lead_status,
    c.id as conv_id,
    c.ai_paused,
    c.takeover_expires_at,
    c.last_message_at,
    EXTRACT(EPOCH FROM (NOW() - c.takeover_expires_at)) / 3600 as hours_expired,
    (SELECT m.author FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 1) as last_author,
    LEFT((SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 1), 100) as last_msg
  FROM leads l
  JOIN conversations c ON c.lead_id = l.id
  WHERE c.ai_paused = true
    AND c.takeover_expires_at IS NOT NULL
    AND c.takeover_expires_at < NOW()
  ORDER BY c.takeover_expires_at ASC
`;

// 2. Lead respondeu e IA ficou muda por mais de 2h (ai_paused=false, último autor=lead)
const aiSilent = await sql`
  SELECT
    l.name,
    l.phone,
    l.temperature,
    l.status as lead_status,
    c.id as conv_id,
    c.ai_paused,
    c.last_message_at,
    EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 3600 as hours_since_last,
    (SELECT m.author FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 1) as last_author,
    LEFT((SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 1), 100) as last_msg
  FROM leads l
  JOIN conversations c ON c.lead_id = l.id
  WHERE c.ai_paused = false
    AND c.last_message_at IS NOT NULL
    AND c.last_message_at < NOW() - INTERVAL '2 hours'
    AND (
      SELECT m.author FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 1
    ) = 'lead'
    AND l.status NOT IN ('lost', 'won')
  ORDER BY c.last_message_at ASC
`;

console.log("=".repeat(80));
console.log("LEADS SEM ATENDIMENTO — " + now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }));
console.log("=".repeat(80));

console.log(`\n── TAKEOVER EXPIRADO (IA pausada, humano sumiu) — ${expiredTakeovers.length} ──`);
for (const r of expiredTakeovers) {
  const exp = Number(r.hours_expired).toFixed(0);
  console.log(`  ${r.name ?? r.phone} | ${r.temperature ?? "sem temp"} | ${r.lead_status} | expirado há ${exp}h`);
  console.log(`    última msg (${r.last_author}): "${r.last_msg}"`);
}

console.log(`\n── IA SILENCIOSA +2H (ai ligada, lead esperando) — ${aiSilent.length} ──`);
for (const r of aiSilent) {
  const hrs = Number(r.hours_since_last).toFixed(0);
  console.log(`  ${r.name ?? r.phone} | ${r.temperature ?? "sem temp"} | ${r.lead_status} | ${hrs}h sem resposta`);
  console.log(`    última msg (lead): "${r.last_msg}"`);
}

console.log(`\nTotal: ${expiredTakeovers.length + aiSilent.length} leads sem atendimento`);
