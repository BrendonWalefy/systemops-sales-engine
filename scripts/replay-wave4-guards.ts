/**
 * Replay wave 4 — cenários reais de 19/07 contra branch Neon isolado.
 *   PAULA (W4.3): operador ofertou horário manual → lead confirma → IA deve
 *     acenar + pausar (needs_human), NUNCA re-ofertar "avaliação presencial".
 *   ST (W4.2): pergunta de preço em general_question → deve receber os CARDS.
 */
import { db } from "../src/infrastructure/db/client";
import { conversations, messages, leads } from "../src/infrastructure/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

const BASE = "http://localhost:3411";
const INSTANCE = "3F5B7D6043D871F185FB66427513BEA4";
const SECRET = process.env.ZAPI_WEBHOOK_SECRET!;
const CRON = process.env.CRON_SECRET!;
const CLINIC_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const AD_OPENER = "Olá! Quero saber como posso transformar meu sorriso com as lentes  de resina?";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pump() {
  await fetch(`${BASE}/api/cron/message-worker`, { headers: { Authorization: `Bearer ${CRON}` } }).catch(() => {});
  await fetch(`${BASE}/api/cron/sender-worker`, { headers: { Authorization: `Bearer ${CRON}` } }).catch(() => {});
}
async function post(phone: string, sender: string, body: string) {
  const res = await fetch(`${BASE}/api/whatsapp/zapi?secret=${SECRET}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, instanceId: INSTANCE, messageId: randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20), momment: Date.now(), status: "RECEIVED", chatName: sender, senderName: sender, isGroupMsg: false, isStatusReply: false, isEdit: false, fromMe: false, text: { message: body } }),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${await res.text()}`);
}
async function findConv(phone: string) {
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.phone, phone))).limit(1);
  if (!lead) return null;
  const [conv] = await db.select().from(conversations).where(eq(conversations.leadId, lead.id)).limit(1);
  return conv ? { leadId: lead.id, conv } : null;
}
async function agentCount(phone: string): Promise<number> {
  try {
    const c = await findConv(phone);
    if (!c) return 0;
    const rows = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, c.conv.id), eq(messages.author, "agent")));
    return rows.length;
  } catch { return -1; }
}
async function waitReply(phone: string, before: number, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let grownAt: number | null = null; let last = before;
  while (Date.now() < deadline) {
    await pump(); await sleep(1500);
    const c = await agentCount(phone);
    if (c < 0) continue;
    if (c > last) { last = c; grownAt = Date.now(); }
    if (grownAt && Date.now() - grownAt > 8000) return;
  }
}
async function insertMsg(convId: string, author: string, body: string, offsetMin: number, mediaType: string | null = null) {
  await db.insert(messages).values({
    id: randomUUID(), conversationId: convId, author: author as any, body,
    mediaType: mediaType as any, sentAt: new Date(Date.now() - offsetMin * 60_000), externalId: null,
  });
}
async function dump(phone: string, name: string) {
  const c = await findConv(phone);
  if (!c) return console.log(`${name}: sem conversa`);
  console.log(`\n████ ${name} — aiPaused=${c.conv.aiPaused} needsAttention=${c.conv.needsAttention} reason=${c.conv.attentionReason ?? "-"}`);
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, c.conv.id)).orderBy(asc(messages.sentAt));
  for (const m of msgs) console.log(`  [${m.author}${m.intent ? ` (${m.intent})` : ""}]${m.mediaUrl ? ` {${m.mediaType}}` : ""} ${(m.body ?? "").replace(/\n/g, " ⏎ ").slice(0, 200)}`);
}

async function main() {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND !== "true") throw new Error("DISABLE_REAL_WHATSAPP_SEND!=true");

  // ── PAULA (W4.3) ──
  const PAULA = "5500000960001";
  console.log("\n━━━ PAULA (W4.3): semeia opener + oferta manual do operador");
  await post(PAULA, "Paula W4", AD_OPENER);
  await waitReply(PAULA, 0);
  const c = await findConv(PAULA);
  if (c) {
    // Operador assume: pré-avaliação feita + oferta concreta para o PROCEDIMENTO
    await insertMsg(c.conv.id, "clinic_user", "Realizamos uma pré-avaliação do seu sorriso, ficou muito bacana!", 6);
    await insertMsg(c.conv.id, "clinic_user", "Olha só, vagou um horário Sab. 01/08 as 16:00 para o procedimento de lentes, oque acha?", 4);
  }
  const beforePaula = await agentCount(PAULA);
  console.log("  Lead: Ok, podemos marcar para o dia 01/08 então");
  await post(PAULA, "Paula W4", "Ok, podemos marcar para o dia 01/08 então");
  await waitReply(PAULA, beforePaula);

  // ── ST (W4.2) ──
  const ST = "5500000960002";
  console.log("\n━━━ ST (W4.2): opener → pergunta de preço estilo confirmação");
  await post(ST, "ST W4", AD_OPENER);
  await waitReply(ST, 0);
  const beforeSt = await agentCount(ST);
  console.log("  Lead: Quero saber como é feito a avaliação e o agendamento, é esse valor de 2k mesmo?");
  await post(ST, "ST W4", "Quero saber como é feito a avaliação e o agendamento, é esse valor de 2k mesmo?");
  await waitReply(ST, beforeSt);

  console.log("\n══════════ TRANSCRIPTS ══════════");
  await dump(PAULA, "PAULA (W4.3)");
  await dump(ST, "ST (W4.2)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
