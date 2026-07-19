// Replay wave 3 — cenários reais das últimas 5h (19/07 manhã):
//   L — W3.1 Lineeh: "valores + pagamento + avaliação" não vira resposta de sinal
//   H — W3.3 Henrique: "dúvidas sobre o procedimento" não despeja catálogo
//   I — W3.2 Irys: pedido de endereço → resposta determinística completa
//   F — W3.4 Felipe: "Ambas" → direto ao conteúdo curado
//   R — pré-avaliação remota: valores → pedido de foto + imagem de instrução
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

type Step = { body: string; wait?: boolean; gapMs?: number };
type Scenario = { name: string; phone: string; sender: string; steps: Step[] };

const SCENARIOS: Scenario[] = [
  {
    name: "L — W3.1 Lineeh: valores+pagamento+avaliação",
    phone: "5500000950001",
    sender: "Lineeh W3",
    steps: [
      { body: AD_OPENER, wait: true },
      { body: "Quero sabe valores e formas de pagamento e fazer uma avaliação", wait: true },
    ],
  },
  {
    name: "H — W3.3 Henrique: dúvidas sobre o procedimento",
    phone: "5500000950002",
    sender: "Henrique W3",
    steps: [
      { body: AD_OPENER, wait: true },
      { body: "Tenho dúvidas sobre o procedimento", wait: true },
    ],
  },
  {
    name: "I — W3.2 Irys: onde fica a clínica",
    phone: "5500000950003",
    sender: "Irys W3",
    steps: [
      { body: AD_OPENER, wait: true },
      { body: "Fica onde a clínica?", wait: true },
    ],
  },
  {
    name: "F — W3.4 Felipe: Ambas",
    phone: "5500000950004",
    sender: "Felipe W3",
    steps: [
      { body: AD_OPENER, wait: true },
      { body: "Ambas", wait: true },
    ],
  },
  {
    name: "R — pré-avaliação por aqui: valores + instruções de foto",
    phone: "5500000950005",
    sender: "Pre Avaliacao Remota",
    steps: [
      { body: AD_OPENER, wait: true },
      { body: "Quero saber valores e formas de pagamento e fazer uma avaliação por aqui", wait: true },
    ],
  },
];

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
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}
async function agentCount(phone: string): Promise<number> {
  try {
    const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.phone, phone))).limit(1);
    if (!lead) return 0;
    const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.leadId, lead.id)).limit(1);
    if (!conv) return 0;
    const rows = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.author, "agent")));
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
async function dump(phone: string, name: string) {
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.phone, phone))).limit(1);
  if (!lead) return console.log(`${name}: sem lead`);
  const [conv] = await db.select().from(conversations).where(eq(conversations.leadId, lead.id)).limit(1);
  if (!conv) return console.log(`${name}: sem conversa`);
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(asc(messages.sentAt));
  console.log(`\n████ TRANSCRIPT — ${name}`);
  for (const m of msgs) console.log(`  [${m.author}${m.intent ? ` (${m.intent})` : ""}]${m.mediaUrl ? ` {${m.mediaType}}` : ""} ${m.body?.replace(/\n/g, "\n      ") ?? ""}`);
}
async function main() {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND !== "true") throw new Error("DISABLE_REAL_WHATSAPP_SEND!=true");
  for (const sc of SCENARIOS) {
    console.log(`\n━━━ ${sc.name}`);
    for (const step of sc.steps) {
      const before = await agentCount(sc.phone);
      console.log(`  Lead: ${step.body.slice(0, 60)}`);
      await post(sc.phone, sc.sender, step.body);
      if (step.gapMs) await sleep(step.gapMs);
      if (step.wait) await waitReply(sc.phone, before);
    }
  }
  console.log("\n══════════ TRANSCRIPTS ══════════");
  for (const sc of SCENARIOS) await dump(sc.phone, sc.name);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
