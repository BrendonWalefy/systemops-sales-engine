#!/usr/bin/env tsx
// Runner E2E completo para BW Odontologia via webhook real.
// Executa T01-T12: conversação, agendamento, cancelamento, reagendamento,
// needs_human, human takeover, urgência clínica.
//
// Requisitos:
//   - Servidor Next.js rodando localmente (npm run dev)
//   - OpenAI real habilitado (DISABLE_REAL_OPENAI não setado)
//   - E2E_MODE desabilitado (roteamento real via Z-API + whatsapp_qa_routes)
//   - DISABLE_REAL_WHATSAPP_SEND=true (para não enviar mensagens reais)
//
// Uso: npm run bw:e2e
//
// Cada sessão de testes é registrada em docs/testing/bw-e2e-history.md
// com os resultados, bugs e correções aplicadas.

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url).pathname, "utf-8");
const sql = neon(env.match(/DATABASE_URL="([^"]+)"/)?.[1] ?? "");

const BASE = "http://localhost:3000";
const ZAPI_INSTANCE = "3F3939F113D8221F7B34C609B9308FED";
const TEST_PHONE = "5511953628848";
const BW_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let msgCounter = Date.now();

async function webhook(text: string, fromMe = false): Promise<void> {
  const payload = {
    phone: TEST_PHONE,
    instanceId: ZAPI_INSTANCE,
    messageId: `bw-e2e-${msgCounter++}`,
    momment: Date.now(),
    status: "RECEIVED",
    chatName: "BW QA Lead",
    senderName: "BW QA Lead",
    text: { message: text },
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
    fromMe,
  };
  const res = await fetch(`${BASE}/api/whatsapp/zapi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook falhou: ${res.status}`);
}

async function waitAgent(timeoutMs = 20000): Promise<{ conv: Record<string, unknown>; msg: Record<string, unknown> } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 900));
    const [conv] = await sql`
      SELECT c.id, c.ai_paused, c.needs_attention, c.attention_reason,
             c.consecutive_unclear_count, c.takeover_expires_at
      FROM conversations c JOIN leads l ON l.id = c.lead_id
      WHERE c.clinic_id = ${BW_ID} AND l.phone = ${TEST_PHONE}
      ORDER BY c.last_message_at DESC LIMIT 1
    `;
    if (!conv) continue;
    const [msg] = await sql`
      SELECT author, body, intent FROM messages
      WHERE conversation_id = ${conv.id as string} ORDER BY sent_at DESC LIMIT 1
    `;
    if (msg?.author === "agent") return { conv, msg };
  }
  return null;
}

async function getConv(): Promise<Record<string, unknown> | null> {
  const [c] = await sql`
    SELECT c.id, c.ai_paused, c.needs_attention, c.attention_reason,
           c.consecutive_unclear_count, c.takeover_expires_at, l.status as lead_status
    FROM conversations c JOIN leads l ON l.id = c.lead_id
    WHERE c.clinic_id = ${BW_ID} AND l.phone = ${TEST_PHONE}
    ORDER BY c.last_message_at DESC LIMIT 1
  `;
  return c ?? null;
}

async function getAppts(): Promise<Record<string, unknown>[]> {
  const [lead] = await sql`SELECT id FROM leads WHERE clinic_id = ${BW_ID} AND phone = ${TEST_PHONE}`;
  if (!lead) return [];
  return sql`SELECT id, status, source, calendar_event_id, starts_at FROM appointments WHERE lead_id = ${lead.id as string} ORDER BY created_at DESC`;
}

async function cleanState(): Promise<void> {
  const leads = await sql`SELECT id FROM leads WHERE clinic_id = ${BW_ID} AND phone = ${TEST_PHONE}`;
  for (const l of leads) {
    await sql`DELETE FROM appointments WHERE lead_id = ${l.id as string}`;
    await sql`DELETE FROM slot_reservations WHERE lead_id = ${l.id as string}`;
    const convs = await sql`SELECT id FROM conversations WHERE lead_id = ${l.id as string}`;
    for (const c of convs) {
      await sql`DELETE FROM messages WHERE conversation_id = ${c.id as string}`;
      await sql`DELETE FROM conversation_states WHERE conversation_id = ${c.id as string}`;
    }
    await sql`DELETE FROM conversations WHERE lead_id = ${l.id as string}`;
    await sql`DELETE FROM follow_ups WHERE lead_id = ${l.id as string}`;
    await sql`DELETE FROM leads WHERE id = ${l.id as string}`;
  }
  await sql`DELETE FROM slot_reservations WHERE clinic_id = ${BW_ID}`;
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

let totalPass = 0;
let totalFail = 0;
const issues: string[] = [];

function ok(cond: boolean, label: string, detail = ""): boolean {
  if (cond) { totalPass++; console.log(`  ✅  ${label}`); }
  else { totalFail++; issues.push(label + (detail ? `: ${detail}` : "")); console.log(`  ❌  ${label}${detail ? " — " + detail : ""}`); }
  return cond;
}

function section(title: string): void {
  console.log(`\n${"═".repeat(58)}\n  ${title}\n${"═".repeat(58)}`);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

console.log("\n🧪 BW Odontologia — Runner E2E Completo");
console.log(`   Servidor: ${BASE}`);
console.log(`   Clínica:  ${BW_ID}`);
console.log(`   Phone:    ${TEST_PHONE}\n`);

// Verificar servidor
try {
  const ping = await fetch(`${BASE}/api/health`).catch(() => ({ ok: false, status: 0 }));
  if (!(ping as Response).ok) throw new Error("server not reachable");
} catch {
  console.log("⚠️  Servidor não acessível em " + BASE);
  console.log("   Execute 'npm run dev' em outro terminal e tente novamente.\n");
  process.exit(1);
}

console.log("🗑️  Limpando estado anterior da BW...");
await cleanState();
console.log("   Pronto.\n");

// ─── T01-T04: Conversação ────────────────────────────────────────────────────

section("T01 — Saudação concierge");
await webhook("Oi");
const t01 = await waitAgent();
ok(!!t01, "agente respondeu");
ok(t01?.msg?.intent === "greeting" || t01?.msg?.intent === "acknowledgment", "intent greeting/acknowledgment");
ok(!String(t01?.msg?.body ?? "").includes("menu"), "sem menu numerado forçado");
ok(t01?.conv?.ai_paused === false, "IA não pausada");
console.log("  resp:", String(t01?.msg?.body ?? "").slice(0, 120));

section("T02 — Lentes (palavra isolada) — 2 opções com preço");
await wait(1500);
await webhook("Lentes");
const t02 = await waitAgent();
ok(!!t02, "agente respondeu");
ok(String(t02?.msg?.body ?? "").toLowerCase().includes("simplificad"), "mencionou simplificada");
ok(String(t02?.msg?.body ?? "").toLowerCase().includes("estratificad"), "mencionou estratificada");
ok(String(t02?.msg?.body ?? "").includes("2.500") || String(t02?.msg?.body ?? "").includes("a partir"), "preço a partir de");
console.log("  resp:", String(t02?.msg?.body ?? "").replace(/\n/g, " | ").slice(0, 250));

section("T03 — Opções de lentes — NÃO deve ser unclear");
await wait(1500);
await webhook("Tem quais opcoes de lentes?");
const t03 = await waitAgent();
ok(!!t03, "agente respondeu");
ok(t03?.msg?.intent !== "unclear", "intent NÃO é unclear");
console.log("  intent:", t03?.msg?.intent, "| resp:", String(t03?.msg?.body ?? "").replace(/\n/g, " | ").slice(0, 160));

section("T04 — Price inquiry com valores explícitos");
await wait(1500);
await webhook("qual o valor das lentes simplificadas e estratificadas?");
const t04 = await waitAgent();
ok(!!t04, "agente respondeu");
ok(t04?.msg?.intent === "price_inquiry", "intent price_inquiry");
ok(String(t04?.msg?.body ?? "").includes("2.500") || String(t04?.msg?.body ?? "").includes("2500"), "R$ 2.500 simplificada");
ok(String(t04?.msg?.body ?? "").includes("5.000") || String(t04?.msg?.body ?? "").includes("5000"), "R$ 5.000 estratificada");
console.log("  resp:", String(t04?.msg?.body ?? "").replace(/\n/g, " | ").slice(0, 200));

// ─── T05-T08: Agendamento / Cancelamento / Reagendamento ────────────────────

section("T05 — Agendamento completo");
await wait(1500);
await webhook("quero agendar uma avaliacao odontologica");
const t05a = await waitAgent();
ok(!!t05a, "agente respondeu ao pedido de agendamento");
const t05HasSlots = String(t05a?.msg?.body ?? "").includes("1.") && String(t05a?.msg?.body ?? "").toLowerCase().includes("h");
ok(t05HasSlots, "slots oferecidos");
console.log("  intent:", t05a?.msg?.intent);

await wait(1500);
await webhook("1");
const t05b = await waitAgent();
ok(!!t05b, "agente confirmou slot");
ok(t05b?.msg?.intent === "confirm_slot" || String(t05b?.msg?.body ?? "").toLowerCase().includes("confirmad"), "confirmação na resposta");
console.log("  intent:", t05b?.msg?.intent, "| resp:", String(t05b?.msg?.body ?? "").replace(/\n/g, " | ").slice(0, 150));

section("T06 — Verificar appointment no banco");
await wait(1500);
const appts06 = await getAppts();
ok(appts06.length > 0, "appointment criado no banco");
const a06 = appts06.find(a => a.status === "scheduled");
ok(!!a06, "status = scheduled");
ok(a06?.source === "app", "source = app (calendário interno)");
ok(a06?.calendar_event_id === null, "calendarEventId = null (sem Google)");
const conv06 = await getConv();
ok(conv06?.lead_status === "appointment_scheduled", "lead status = appointment_scheduled");
if (a06) console.log(`  Appt: status=${a06.status} source=${a06.source} starts=${String(a06.starts_at).slice(0, 16)}`);

section("T07 — Cancelamento");
await wait(1500);
await webhook("quero cancelar minha consulta");
const t07 = await waitAgent();
ok(!!t07, "agente respondeu ao cancelamento");
ok(t07?.msg?.intent === "cancel_appointment", "intent cancel_appointment");
await wait(1500);
const appts07 = await getAppts();
ok(!!appts07.find(a => a.status === "cancelled"), "appointment cancelado no banco");
const conv07 = await getConv();
ok(conv07?.lead_status === "in_conversation", "lead voltou para in_conversation");
console.log("  appts:", appts07.map(a => a.status).join(", "));

section("T08 — Reagendamento após cancelamento");
await wait(1500);
await webhook("quero agendar uma avaliacao");
const t08a = await waitAgent();
ok(!!t08a, "agente respondeu ao pedido de reagendamento");
const needsProcedure = String(t08a?.msg?.body ?? "").toLowerCase().includes("procedimento");
if (needsProcedure) {
  console.log("  → agente pediu procedimento, enviando nome...");
  await wait(1500);
  await webhook("Avaliacao odontologica");
  const t08proc = await waitAgent();
  ok(String(t08proc?.msg?.body ?? "").includes("1."), "slots oferecidos após procedimento");
}
await wait(1500);
await webhook("1");
const t08b = await waitAgent();
ok(!!t08b, "agente respondeu confirmação");
ok(t08b?.msg?.intent === "confirm_slot" || String(t08b?.msg?.body ?? "").toLowerCase().includes("confirmad"), "reagendamento confirmado");
await wait(1500);
const appts08 = await getAppts();
const newAppt = appts08.find(a => a.status === "scheduled");
ok(!!newAppt, "novo appointment scheduled no banco");
if (newAppt) {
  ok(newAppt.source === "app", "source = app");
  ok(newAppt.calendar_event_id === null, "calendarEventId = null");
}
ok(!!appts08.find(a => a.status === "cancelled"), "appointment anterior mantido como cancelled");

// ─── T09-T12: Handoff / Urgência / Unclear ───────────────────────────────────

section("T09 — Needs Human (handoff ao operador)");
// Resetar IA para estado limpo
const convReset = await getConv();
if (convReset?.id) {
  await sql`UPDATE conversations SET ai_paused=false, takeover_expires_at=null, needs_attention=false, consecutive_unclear_count=0 WHERE id=${convReset.id as string}`;
  await sql`UPDATE leads SET status='in_conversation' WHERE id=(SELECT lead_id FROM conversations WHERE id=${convReset.id as string})`;
}
await wait(500);

await webhook("quero falar diretamente com o dentista");
const t09 = await waitAgent();
ok(!!t09, "agente respondeu");
ok(t09?.msg?.intent === "needs_human", "intent needs_human");
ok(t09?.conv?.ai_paused === true, "ai_paused = true no banco");
ok(t09?.conv?.needs_attention === true, "needs_attention = true no banco");
ok(!!t09?.conv?.attention_reason, "attention_reason preenchido");
console.log("  attention_reason:", t09?.conv?.attention_reason);
console.log("  resp:", String(t09?.msg?.body ?? "").replace(/\n/g, " | ").slice(0, 150));

section("T09b — IA em silêncio com ai_paused=true");
await wait(1500);
await webhook("e o desconto?");
await wait(3000);
const [lastMsg09b] = await sql`SELECT author FROM messages WHERE conversation_id=${String(t09?.conv?.id ?? "")} ORDER BY sent_at DESC LIMIT 1`;
ok(lastMsg09b?.author !== "agent", "IA manteve silêncio (não respondeu)");
console.log("  último author:", lastMsg09b?.author);

section("T10 — Human Takeover via fromMe (operador no celular)");
const convId10 = String(t09?.conv?.id ?? "");
await sql`UPDATE conversations SET ai_paused=false, takeover_expires_at=null, needs_attention=false WHERE id=${convId10}`;
await wait(500);

await webhook("Olá! Temos uma condição especial para você.", true);
await wait(3000);
const conv10 = await getConv();
ok(conv10?.ai_paused === true, "IA pausada pelo operador (ai_paused=true)");
ok(!!conv10?.takeover_expires_at, "takeoverExpiresAt setado (TTL ativo)");
const ttlFuture = conv10?.takeover_expires_at ? new Date(String(conv10.takeover_expires_at)) > new Date() : false;
ok(ttlFuture, "takeoverExpiresAt é no futuro");
const [opMsg10] = await sql`SELECT author, body FROM messages WHERE conversation_id=${convId10} AND author='clinic_user' ORDER BY sent_at DESC LIMIT 1`;
ok(opMsg10?.author === "clinic_user", "mensagem salva com author=clinic_user");
console.log("  TTL:", conv10?.takeover_expires_at);

section("T11 — Urgência clínica");
await sql`UPDATE conversations SET ai_paused=false, takeover_expires_at=null, needs_attention=false WHERE id=${convId10}`;
await wait(500);

await webhook("estou com muita dor de dente");
const t11 = await waitAgent();
ok(!!t11, "agente respondeu");
ok(t11?.msg?.intent === "clinical_urgency", "intent clinical_urgency");
ok(String(t11?.msg?.body ?? "").toLowerCase().match(/equipe|contato|acion/) !== null, "mencionou contato/equipe");
console.log("  intent:", t11?.msg?.intent, "| resp:", String(t11?.msg?.body ?? "").replace(/\n/g, " | ").slice(0, 150));

// ─── Resultado final ──────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(58)}`);
console.log(`  RESULTADO FINAL: ${totalPass} ✅  ${totalFail} ❌  (${totalPass + totalFail} total)`);
if (issues.length > 0) {
  console.log(`\n  Falhas:`);
  issues.forEach(i => console.log(`    • ${i}`));
}
console.log(`${"═".repeat(58)}\n`);
console.log(`💡 Para exportar transcrições desta sessão: npm run bw:dump`);

process.exit(totalFail > 0 ? 1 : 0);
