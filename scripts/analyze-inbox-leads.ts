#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// Analisa conversas dos leads visíveis no Inbox para mapear oportunidades e problemas.

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const envPath = new URL("../.env.local", import.meta.url).pathname;
const env = readFileSync(envPath, "utf-8");
const dbUrl = env.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL não encontrado");

const sql = neon(dbUrl);

// 1. Summary de cada lead
const leads = await sql`
  SELECT
    l.id,
    l.name,
    l.phone,
    l.temperature,
    l.status,
    l.treatment_interest,
    l.created_at,
    c.id as conv_id,
    c.ai_paused,
    c.takeover_expires_at,
    c.needs_attention,
    c.attention_reason,
    c.consecutive_unclear_count,
    c.last_message_at,
    c.summary as conv_summary
  FROM leads l
  JOIN conversations c ON c.lead_id = l.id
  WHERE l.name ILIKE ANY(ARRAY['%Bianca%','%Gregorie%','%Marjorie%','%Aylane%','%Pedro%','%Brendon%'])
  ORDER BY c.last_message_at DESC NULLS LAST
`;

const leadIds = leads.map((l: any) => l.id);
const convIds = leads.map((l: any) => l.conv_id);

// 2. Appointments
const appointments = await sql`
  SELECT
    a.lead_id,
    a.starts_at,
    a.ends_at,
    a.status as appt_status,
    a.source,
    a.reminder_sent_at,
    a.created_at as appt_created_at
  FROM appointments a
  WHERE a.lead_id = ANY(${leadIds})
  ORDER BY a.starts_at DESC
`;

// 3. All messages for each conversation
const messages = await sql`
  SELECT
    m.conversation_id,
    m.author,
    m.body,
    m.sent_at,
    m.intent,
    m.media_type,
    m.external_id
  FROM messages m
  WHERE m.conversation_id = ANY(${convIds})
  ORDER BY m.conversation_id, m.sent_at ASC
`;

// 4. Follow-ups
const followUps = await sql`
  SELECT
    f.lead_id,
    f.due_at,
    f.status as fu_status,
    f.reason,
    f.suggested_message,
    f.completed_at
  FROM follow_ups f
  WHERE f.lead_id = ANY(${leadIds})
  ORDER BY f.due_at DESC
`;

// --- PRINT ---

console.log("=".repeat(80));
console.log("ANÁLISE DE LEADS — INBOX IA");
console.log(`Data: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
console.log("=".repeat(80));

for (const lead of leads) {
  const leadAppts = appointments.filter((a: any) => a.lead_id === lead.id);
  const leadMsgs = messages.filter((m: any) => m.conversation_id === lead.conv_id);
  const leadFUs = followUps.filter((f: any) => f.lead_id === lead.id);

  const lastMsg = leadMsgs[leadMsgs.length - 1];
  const lastMsgAt = lastMsg ? new Date(lastMsg.sent_at) : null;
  const hoursAgo = lastMsgAt ? Math.round((Date.now() - lastMsgAt.getTime()) / 3600000) : null;

  console.log(`\n${"─".repeat(80)}`);
  console.log(`LEAD: ${lead.name} | ${(lead.temperature ?? "sem temp").toUpperCase()} | Status: ${lead.status}`);
  console.log(`Interesse: ${lead.treatment_interest ?? "?"} | AI Paused: ${lead.ai_paused} | Unclear streak: ${lead.consecutive_unclear_count}`);
  if (lead.needs_attention) console.log(`⚠️  NEEDS ATTENTION: ${lead.attention_reason}`);
  if (lead.takeover_expires_at) {
    const exp = new Date(lead.takeover_expires_at);
    const isExpired = exp < new Date();
    console.log(`Takeover expira: ${exp.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} ${isExpired ? "(EXPIRADO)" : "(ativo)"}`);
  }
  if (hoursAgo !== null) {
    console.log(`Última msg: ${hoursAgo}h atrás (${lastMsg.author}) — "${lastMsg.body?.slice(0, 120)}"`);
  }
  if (lead.conv_summary) {
    console.log(`Resumo conv: ${lead.conv_summary.slice(0, 200)}`);
  }

  // Appointments
  if (leadAppts.length > 0) {
    console.log(`\n  AGENDAMENTOS (${leadAppts.length}):`);
    for (const a of leadAppts) {
      const apptDate = new Date(a.starts_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const createdDate = new Date(a.appt_created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      console.log(`  • ${apptDate} | status: ${a.appt_status} | source: ${a.source} | criado: ${createdDate}`);
      if (a.reminder_sent_at) console.log(`    ↳ Lembrete enviado: ${new Date(a.reminder_sent_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
    }
  } else {
    console.log(`\n  AGENDAMENTOS: nenhum`);
  }

  // Follow-ups
  if (leadFUs.length > 0) {
    console.log(`\n  FOLLOW-UPS (${leadFUs.length}):`);
    for (const f of leadFUs) {
      const dueDate = new Date(f.due_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const completedMark = f.completed_at ? `✅ concluído ${new Date(f.completed_at).toLocaleDateString("pt-BR")}` : f.fu_status;
      console.log(`  • ${dueDate} | ${completedMark} | motivo: ${f.reason}`);
      if (f.suggested_message) console.log(`    msg: "${f.suggested_message.slice(0, 100)}"`);
    }
  }

  // Conversation full history
  console.log(`\n  CONVERSA COMPLETA (${leadMsgs.length} msgs):`);
  for (const m of leadMsgs) {
    const ts = new Date(m.sent_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const tag = m.intent ? ` [${m.intent}]` : "";
    const media = m.media_type ? ` [${m.media_type}]` : "";
    const authorLabel = m.author === "lead" ? "LEAD" : m.author === "agent" ? "IA  " : "HUM ";
    console.log(`  ${ts} | ${authorLabel}${tag}${media}: ${m.body?.slice(0, 150)}`);
  }
}

console.log(`\n${"=".repeat(80)}`);
console.log(`Leads: ${leads.length} | Agendamentos: ${appointments.length} | Follow-ups: ${followUps.length}`);
