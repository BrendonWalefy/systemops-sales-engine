/**
 * Replay REAL dos cenários da Wave 2 (doc 06 — mapeamento 18/07).
 *
 * Caminho idêntico ao de produção: POST no webhook Z-API → inbound_events →
 * message.process (cron worker) → ConversationOrchestrator → outbound →
 * message.send (sender worker). Única diferença: DISABLE_REAL_WHATSAPP_SEND=true
 * (nada sai pro WhatsApp) e DATABASE_URL aponta pro branch Neon isolado.
 *
 * Cenários copiados verbatim dos leads reais de 18/07 (Nathan, João Vitor,
 * Barbara) — cada um valida uma correção específica:
 *   A — N1: interesse genérico → conteúdo curado sem prosa LLM duplicada
 *   B — J2: "Boa noite pode sim" após oferta aberta → entrega, não re-saudação
 *   C — J3: "Valores e onde é o consultório" → endereço + cards no mesmo turno
 *   D — J4×J6: "20 lentes" + "Queria ver o trabalho" → valor exato + vitrine
 *   E — T1+T2: opener + criativo do anúncio após saudação → 1 turno, sem
 *       "Recebi sua foto"
 *   F — J8: "me mostra as cores" → só cores; "sim pode" → aí sim pedido de foto
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
const ALLOW_ACTIVE_CLINIC_REPLAY = process.env.ALLOW_ACTIVE_CLINIC_REPLAY === "true";

const CREATIVE_IMAGE =
  "https://wdambmfza8itfgaf.public.blob.vercel-storage.com/lead-media/858b14f7-e9af-4dae-b3bb-137d442f18eb-8hqaBTIMiY7AHD6kaRuhgy5btQAnyt.jpg";

const AD_OPENER = "Olá! Quero saber como posso transformar meu sorriso com as lentes  de resina?";

type Step =
  | { kind: "text"; body: string; wait?: boolean; gapMs?: number }
  | { kind: "image"; url: string; wait?: boolean; gapMs?: number };

type Scenario = { name: string; phone: string; sender: string; steps: Step[] };

const SCENARIOS: Scenario[] = [
  {
    name: "A — N1 Nathan: interesse genérico não duplica apresentação",
    phone: "5500000920001",
    sender: "Nathan W2",
    steps: [
      { kind: "text", body: AD_OPENER, wait: true },
      { kind: "text", body: "quero enteder um pouco mais como funciona e valores também", wait: true },
    ],
  },
  {
    name: "B — J2 João Vitor: 'Boa noite pode sim' entrega a oferta",
    phone: "5500000920002",
    sender: "Joao W2",
    steps: [
      { kind: "text", body: AD_OPENER, wait: true },
      { kind: "text", body: "Boa noite pode sim", wait: true },
    ],
  },
  {
    name: "C — J3: valores + endereço no mesmo turno",
    phone: "5500000920003",
    sender: "Composta W2",
    steps: [
      { kind: "text", body: AD_OPENER, wait: true },
      { kind: "text", body: "Valores e onde é o consultório", wait: true },
    ],
  },
  {
    name: "D — J4×J6: 20 lentes + ver trabalho no burst",
    phone: "5500000920004",
    sender: "Burst W2",
    steps: [
      { kind: "text", body: AD_OPENER, wait: true },
      { kind: "text", body: "Ver valores", wait: true },
      { kind: "text", body: "20 lentes", gapMs: 1_500 },
      { kind: "text", body: "Queria ver um pouco do trabalho de vocês", wait: true },
    ],
  },
  {
    name: "E — T1+T2 Barbara: criativo após saudação, sem 'Recebi sua foto'",
    phone: "5500000920005",
    sender: "Barbara W2",
    steps: [
      { kind: "text", body: AD_OPENER, wait: true },
      { kind: "text", body: AD_OPENER, gapMs: 1_500 },
      { kind: "image", url: CREATIVE_IMAGE, wait: true },
    ],
  },
  {
    name: "F — J8: cores → só cores; prontidão → pedido de foto",
    phone: "5500000920006",
    sender: "Cores W2",
    steps: [
      { kind: "text", body: AD_OPENER, wait: true },
      { kind: "text", body: "Ver valores", wait: true },
      { kind: "text", body: "me mostra as cores", wait: true },
      { kind: "text", body: "sim pode", wait: true },
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
  console.log(`     aiPaused=${conv.aiPaused} needsAttention=${conv.needsAttention} reason=${conv.attentionReason ?? "-"}`);
  for (const m of msgs) {
    const media = m.mediaUrl ? ` {${m.mediaType}}` : "";
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
  if (!org) throw new Error(`Clínica ${CLINIC_ID} não encontrada.`);
  if (!org.isTest && org.operationalStatus === "active" && !ALLOW_ACTIVE_CLINIC_REPLAY) {
    throw new Error(
      `Replay bloqueado: "${org.name}" está ativa e não é ambiente de teste. ` +
      "Aponte DATABASE_URL para um branch isolado e defina ALLOW_ACTIVE_CLINIC_REPLAY=true conscientemente.",
    );
  }
  console.log(`Replay wave2 contra clínica ${org.slug} — banco: ${process.env.DATABASE_URL?.match(/@([^.]+)/)?.[1]}`);

  for (const sc of SCENARIOS) {
    console.log(`\n━━━ ${sc.name} (${sc.phone})`);
    for (const step of sc.steps) {
      const before = await agentMsgCount(sc.phone);
      if (step.kind === "text") {
        console.log(`  Lead: ${step.body}`);
        await post({ ...basePayload(sc.phone, sc.sender), text: { message: step.body } });
      } else {
        console.log(`  Lead: [imagem/criativo]`);
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
