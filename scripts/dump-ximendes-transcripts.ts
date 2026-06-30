#!/usr/bin/env tsx
// Exporta todas as conversas da clínica Ximendes Odontologia como texto legível.
// Uso: npx dotenv -e .env.local -- npx tsx scripts/dump-ximendes-transcripts.ts [outputDir]
//
// Salva um arquivo por conversa em docs/testing/transcripts/ximendes/<timestamp>_<leadName>.txt
// Inclui: lead info, estado da conversa, mensagens com author/intent/timestamp
// Também gera um resumo análitico agregado para facilitar a revisão

import { neon } from "@neondatabase/serverless";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const envPath = new URL("../.env.local", import.meta.url).pathname;
const env = readFileSync(envPath, "utf-8");
const dbUrl = env.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL não encontrado no .env.local");

const sql = neon(dbUrl);

// Buscar o ID da Ximendes dinamicamente
const clinicRows = await sql`SELECT id, name, slug FROM organizations WHERE name ILIKE '%ximendes%' OR slug ILIKE '%ximendes%' LIMIT 1`;
if (clinicRows.length === 0) throw new Error("Clínica Ximendes não encontrada no banco");
const XIMENDES_CLINIC_ID = clinicRows[0].id;
console.log(`\nClínica: ${clinicRows[0].name} (${XIMENDES_CLINIC_ID})\n`);

const outputDir = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(process.cwd(), "docs/testing/transcripts/ximendes");

mkdirSync(outputDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const leads = await sql`
  SELECT DISTINCT l.id, l.name, l.phone, l.status, l.temperature, l.treatment_interest, l.created_at
  FROM leads l
  JOIN conversations c ON c.lead_id = l.id
  WHERE c.clinic_id = ${XIMENDES_CLINIC_ID}
  ORDER BY l.created_at DESC
`;

console.log(`Encontrados ${leads.length} lead(s) com conversas na Ximendes.`);

const summary: string[] = [];
summary.push("=".repeat(70));
summary.push(`ANÁLISE DE CONVERSAS — Ximendes Odontologia`);
summary.push(`Exportado em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
summary.push(`Total de leads: ${leads.length}`);
summary.push("=".repeat(70));
summary.push("");

// Contadores para análise
const intentCounts: Record<string, number> = {};
let totalMessages = 0;
let aiMessages = 0;
let leadMessages = 0;
let clinicMessages = 0;
let unclearConversations = 0;
let takeoverConversations = 0;
let needsAttentionConversations = 0;

const statusDist: Record<string, number> = {};
const tempDist: Record<string, number> = {};

for (const lead of leads) {
  statusDist[lead.status] = (statusDist[lead.status] || 0) + 1;
  if (lead.temperature) tempDist[lead.temperature] = (tempDist[lead.temperature] || 0) + 1;

  const conversations = await sql`
    SELECT c.id, c.ai_paused, c.needs_attention, c.attention_reason,
           c.consecutive_unclear_count, c.last_message_at, c.created_at,
           c.takeover_expires_at
    FROM conversations c
    WHERE c.lead_id = ${lead.id} AND c.clinic_id = ${XIMENDES_CLINIC_ID}
    ORDER BY c.created_at ASC
  `;

  const lines: string[] = [];
  lines.push("=".repeat(65));
  lines.push(`LEAD: ${lead.name ?? "desconhecido"} | ${lead.phone}`);
  lines.push(`Status: ${lead.status} | Temperatura: ${lead.temperature ?? "—"}`);
  if (lead.treatment_interest) lines.push(`Interesse: ${lead.treatment_interest}`);
  lines.push(`Criado em: ${new Date(lead.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  lines.push("=".repeat(65));

  for (const conv of conversations) {
    if (conv.needs_attention) needsAttentionConversations++;
    if (conv.ai_paused) takeoverConversations++;
    if (conv.consecutive_unclear_count > 0) unclearConversations++;

    lines.push("");
    lines.push(`  CONVERSA ${conv.id.slice(0, 8)}`);
    lines.push(`  Criada: ${new Date(conv.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
    if (conv.last_message_at) {
      lines.push(`  Última msg: ${new Date(conv.last_message_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
    }
    lines.push(`  ai_paused=${conv.ai_paused} | needs_attention=${conv.needs_attention} | unclear_count=${conv.consecutive_unclear_count}`);
    if (conv.attention_reason) lines.push(`  attention_reason: ${conv.attention_reason}`);
    if (conv.takeover_expires_at) lines.push(`  takeover_expires_at: ${new Date(conv.takeover_expires_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
    lines.push("  " + "-".repeat(60));

    const msgs = await sql`
      SELECT author, body, intent, sent_at
      FROM messages
      WHERE conversation_id = ${conv.id}
      ORDER BY sent_at ASC
    `;

    for (const msg of msgs) {
      totalMessages++;
      if (msg.author === "agent") aiMessages++;
      else if (msg.author === "lead") leadMessages++;
      else clinicMessages++;

      if (msg.intent) {
        intentCounts[msg.intent] = (intentCounts[msg.intent] || 0) + 1;
      }

      const time = new Date(msg.sent_at).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const authorLabel =
        msg.author === "agent"       ? "🤖 IA   " :
        msg.author === "lead"        ? "👤 Lead " :
        msg.author === "clinic_user" ? "👨‍⚕️ Op.  " :
        `   ${msg.author}`;

      const intentTag = msg.intent ? ` [${msg.intent}]` : "";
      lines.push(`  [${time}] ${authorLabel}${intentTag}`);

      const body = (msg.body ?? "").replace(/\n/g, "\n          ");
      lines.push(`          ${body}`);
      lines.push("");
    }
  }

  lines.push("");

  const safeName = (lead.name ?? lead.phone ?? "unknown")
    .replace(/[^a-zA-Z0-9À-ɏ\s]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase()
    .slice(0, 40);

  const filename = `${timestamp}_${safeName}_${lead.id.slice(0, 8)}.txt`;
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, lines.join("\n"), "utf-8");

  const msgCount = lines.filter((l) => l.includes("[")).length;
  console.log(
    `  ✓ ${lead.name ?? lead.phone} — ${conversations.length} conversa(s) | messages: ${msgCount} | status: ${lead.status}`,
  );
}

// Montar resumo analítico
summary.push("## STATUS DOS LEADS");
Object.entries(statusDist).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
  summary.push(`  ${status.padEnd(20)} ${count}`);
});
summary.push("");

summary.push("## TEMPERATURA DOS LEADS");
Object.entries(tempDist).sort((a, b) => b[1] - a[1]).forEach(([temp, count]) => {
  summary.push(`  ${temp.padEnd(20)} ${count}`);
});
summary.push("");

summary.push("## MENSAGENS");
summary.push(`  Total de mensagens:   ${totalMessages}`);
summary.push(`  Mensagens da IA:      ${aiMessages}`);
summary.push(`  Mensagens de leads:   ${leadMessages}`);
summary.push(`  Mensagens da equipe:  ${clinicMessages}`);
summary.push("");

summary.push("## INTENTS DETECTADOS (top 20)");
Object.entries(intentCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([intent, count]) => {
    summary.push(`  ${intent.padEnd(30)} ${count}`);
  });
summary.push("");

summary.push("## SAÚDE DAS CONVERSAS");
summary.push(`  Conversas com needs_attention:  ${needsAttentionConversations}`);
summary.push(`  Conversas com ai_paused:         ${takeoverConversations}`);
summary.push(`  Conversas com unclear > 0:       ${unclearConversations}`);
summary.push("");

const summaryFile = join(outputDir, `${timestamp}_SUMMARY.txt`);
writeFileSync(summaryFile, summary.join("\n"), "utf-8");

console.log(`\n📊 Resumo analítico salvo em: ${summaryFile}`);
console.log(`📁 Transcrições salvas em:     ${outputDir}`);
console.log(`\nTotal de mensagens analisadas: ${totalMessages}`);
