#!/usr/bin/env tsx
// Exporta todas as conversas da clínica BW Odontologia como texto legível.
// Uso: tsx scripts/dump-bw-transcripts.ts [outputDir]
//
// Salva um arquivo por conversa em docs/testing/transcripts/bw/<timestamp>_<leadName>.txt
// com autor, intent, timestamp e conteúdo de cada mensagem.
// Útil para: evidência de evolução de qualidade antes/depois de ajustes no playbook,
// apresentação ao cliente, e análise de bugs em produção.

import { neon } from "@neondatabase/serverless";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const envPath = new URL("../.env.local", import.meta.url).pathname;
const env = readFileSync(envPath, "utf-8");
const dbUrl = env.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL não encontrado no .env.local");

const sql = neon(dbUrl);
const BW_CLINIC_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

const outputDir = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(process.cwd(), "docs/testing/transcripts/bw");

mkdirSync(outputDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const leads = await sql`
  SELECT DISTINCT l.id, l.name, l.phone, l.status, l.temperature, l.created_at
  FROM leads l
  JOIN conversations c ON c.lead_id = l.id
  WHERE c.clinic_id = ${BW_CLINIC_ID}
  ORDER BY l.created_at DESC
`;

console.log(`Encontrados ${leads.length} lead(s) na BW Odontologia.`);

for (const lead of leads) {
  const conversations = await sql`
    SELECT c.id, c.ai_paused, c.needs_attention, c.attention_reason,
           c.consecutive_unclear_count, c.last_message_at, c.created_at
    FROM conversations c
    WHERE c.lead_id = ${lead.id} AND c.clinic_id = ${BW_CLINIC_ID}
    ORDER BY c.created_at ASC
  `;

  const lines: string[] = [];
  lines.push("=".repeat(65));
  lines.push(`LEAD: ${lead.name ?? "desconhecido"} | ${lead.phone}`);
  lines.push(`Status: ${lead.status} | Temperatura: ${lead.temperature ?? "—"}`);
  lines.push(`Criado em: ${new Date(lead.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  lines.push("=".repeat(65));

  for (const conv of conversations) {
    lines.push("");
    lines.push(`  CONVERSA ${conv.id.slice(0, 8)}`);
    lines.push(`  Criada: ${new Date(conv.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
    lines.push(`  ai_paused=${conv.ai_paused} | needs_attention=${conv.needs_attention}`);
    if (conv.attention_reason) lines.push(`  attention_reason: ${conv.attention_reason}`);
    lines.push("  " + "-".repeat(60));

    const messages = await sql`
      SELECT author, body, intent, sent_at
      FROM messages
      WHERE conversation_id = ${conv.id}
      ORDER BY sent_at ASC
    `;

    for (const msg of messages) {
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
  console.log(`  Salvo: ${filename} (${conversations.length} conversa(s), ${lines.length} linhas)`);
}

console.log(`\nTranscrições exportadas para: ${outputDir}`);
