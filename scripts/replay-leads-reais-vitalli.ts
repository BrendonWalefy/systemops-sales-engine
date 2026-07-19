/**
 * Replay REAL das últimas conversas de leads da Vitalli.
 *
 * Caminho idêntico ao de produção: POST no webhook Z-API → inbound_events →
 * message.process (cron worker) → ConversationOrchestrator → outbound →
 * message.send (sender worker). Única diferença: DISABLE_REAL_WHATSAPP_SEND=true
 * (nada sai pro WhatsApp) e DATABASE_URL aponta pro branch Neon isolado.
 *
 * Mensagens copiadas verbatim dos leads reais de 17-18/07 (extract-vitalli-last-30).
 */
import { db } from "../src/infrastructure/db/client";
import { organizations, conversations, messages, leads } from "../src/infrastructure/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

const BASE = "http://localhost:3411";
const INSTANCE = "3F5B7D6043D871F185FB66427513BEA4"; // Vitalli
const SECRET = process.env.ZAPI_WEBHOOK_SECRET!;
const CRON = process.env.CRON_SECRET!;
const CLINIC_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const ALLOW_ACTIVE_CLINIC_REPLAY =
  process.env.ALLOW_ACTIVE_CLINIC_REPLAY === "true";

const SIMONE_PHOTO =
  "https://wdambmfza8itfgaf.public.blob.vercel-storage.com/lead-media/858b14f7-e9af-4dae-b3bb-137d442f18eb-8hqaBTIMiY7AHD6kaRuhgy5btQAnyt.jpg";

type Step =
  | { kind: "text"; body: string; wait?: boolean; gapMs?: number }
  | { kind: "image"; url: string; wait?: boolean; gapMs?: number };

type Scenario = { name: string; phone: string; sender: string; steps: Step[] };

const SCENARIOS: Scenario[] = [
  {
    name: "Ana Paula — CTA anúncio (longa)",
    phone: "5500000910001",
    sender: "Ana Paula",
    steps: [
      { kind: "text", body: "Olá! Quero saber como posso transformar meu sorriso com as lentes  de resina?", wait: true },
    ],
  },
  {
    name: "rafa — CTA anúncio (longa, repetida p/ consistência)",
    phone: "5500000910002",
    sender: "rafa",
    steps: [
      { kind: "text", body: "Olá! Quero saber como posso transformar meu sorriso com as lentes  de resina?", wait: true },
    ],
  },
  {
    name: "Babi — CTA anúncio (curta)",
    phone: "5500000910003",
    sender: "Babi",
    steps: [
      { kind: "text", body: "Olá, quero saber mais sobre as lentes em resina !", wait: true },
    ],
  },
  {
    name: "Eisete — quer 2 lentes, escreve com erros",
    phone: "5500000910004",
    sender: "Eisete",
    steps: [
      { kind: "text", body: "Olá, quero saber mais sobre as lentes em resina !", wait: true },
      { kind: "text", body: "Boa tarde vitor e Leonardo", wait: true },
      { kind: "text", body: "Eae eu queria fazer duas lente que Caio", wait: true },
      { kind: "text", body: "Segunda", wait: true },
      { kind: "text", body: "Atare", wait: true },
    ],
  },
  {
    name: "Simone — dúvida técnica + fotos + endereço + preço avaliação",
    phone: "5500000910005",
    sender: "Simone De Paula",
    steps: [
      { kind: "text", body: "Olá, quero saber mais sobre as lentes em resina !", wait: true },
      {
        kind: "text",
        body: "Olá Gleice. Eu estou bem. E você? Tenho muitas dúvidas. Quais os benefícios e diferenças com resina estratificada?",
        wait: true,
      },
      { kind: "image", url: SIMONE_PHOTO, gapMs: 2000 },
      { kind: "image", url: SIMONE_PHOTO, wait: true },
      { kind: "text", body: "Boa tarde", gapMs: 4000 },
      { kind: "text", body: "Qual o endereço de vocês?", wait: true },
      { kind: "text", body: "A avaliação é cobrada?", wait: true },
    ],
  },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pump() {
  await fetch(`${BASE}/api/cron/message-worker`, { headers: { Authorization: `Bearer ${CRON}` } }).catch(() => {});
  await fetch(`${BASE}/api/cron/sender-worker`, { headers: { Authorization: `Bearer ${CRON}` } }).catch(() => {});
}

async function post(payload: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/whatsapp/zapi?secret=${SECRET}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${await res.text()}`);
}

function basePayload(phone: string, sender: string) {
  return {
    phone,
    instanceId: INSTANCE,
    messageId: randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20),
    momment: Date.now(),
    status: "RECEIVED",
    chatName: sender,
    senderName: sender,
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
    fromMe: false,
  };
}

async function agentMsgCount(phone: string): Promise<number> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.phone, phone)))
    .limit(1);
  if (!lead) return 0;
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.leadId, lead.id))
    .limit(1);
  if (!conv) return 0;
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conv.id), eq(messages.author, "agent")));
  return rows.length;
}

async function waitForReply(phone: string, before: number, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let grownAt: number | null = null;
  let lastCount = before;
  while (Date.now() < deadline) {
    await pump();
    await sleep(1500);
    const count = await agentMsgCount(phone);
    if (count > lastCount) {
      lastCount = count;
      grownAt = Date.now();
    }
    // resposta chegou e ficou estável por 8s (cobre multi-parte/mídia)
    if (grownAt && Date.now() - grownAt > 8000) return;
  }
  if (lastCount === before) console.log("      ⏱️ TIMEOUT — nenhuma resposta do agente");
}

async function dumpConversation(phone: string, name: string) {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.phone, phone)))
    .limit(1);
  if (!lead) return console.log("  (sem lead criado)");
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.leadId, lead.id))
    .limit(1);
  if (!conv) return console.log("  (sem conversa criada)");
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(asc(messages.sentAt));
  console.log(`\n████ TRANSCRIPT — ${name}`);
  console.log(`     aiPaused=${conv.aiPaused} needsAttention=${conv.needsAttention} reason=${conv.attentionReason ?? "-"} category=${conv.category}`);
  for (const m of msgs) {
    const media = m.mediaUrl ? ` {${m.mediaType}: ${m.mediaUrl.slice(0, 90)}}` : "";
    const intent = m.intent ? ` (${m.intent})` : "";
    console.log(`  [${m.author}${intent}]${media} ${m.body?.replace(/\n/g, "\n      ") ?? ""}`);
  }
}

async function main() {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND !== "true") {
    throw new Error("DISABLE_REAL_WHATSAPP_SEND precisa ser true — abortando.");
  }
  const [org] = await db
    .select({
      name: organizations.name,
      slug: organizations.slug,
      isTest: organizations.isTest,
      operationalStatus: organizations.operationalStatus,
    })
    .from(organizations)
    .where(eq(organizations.id, CLINIC_ID)).limit(1);
  if (!org) {
    throw new Error(`Clínica ${CLINIC_ID} não encontrada.`);
  }
  if (!org.isTest && org.operationalStatus === "active" && !ALLOW_ACTIVE_CLINIC_REPLAY) {
    throw new Error(
      `Replay bloqueado: "${org.name}" está ativa e não é ambiente de teste. ` +
      "Aponte DATABASE_URL para um branch isolado ou defina ALLOW_ACTIVE_CLINIC_REPLAY=true conscientemente.",
    );
  }
  console.log(`Replay contra clínica ${org.slug} — banco: ${process.env.DATABASE_URL?.match(/@([^.]+)/)?.[1]}`);

  for (const sc of SCENARIOS) {
    console.log(`\n━━━ ${sc.name} (${sc.phone})`);
    for (const step of sc.steps) {
      const before = await agentMsgCount(sc.phone);
      if (step.kind === "text") {
        console.log(`  Lead: ${step.body}`);
        await post({ ...basePayload(sc.phone, sc.sender), text: { message: step.body } });
      } else {
        console.log(`  Lead: [foto do sorriso]`);
        await post({ ...basePayload(sc.phone, sc.sender), image: { imageUrl: step.url, caption: "", mimeType: "image/jpeg" } });
      }
      if (step.gapMs) await sleep(step.gapMs);
      if (step.wait) await waitForReply(sc.phone, before);
    }
  }

  console.log("\n\n══════════ TRANSCRIPTS FINAIS ══════════");
  for (const sc of SCENARIOS) {
    await dumpConversation(sc.phone, sc.name);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
