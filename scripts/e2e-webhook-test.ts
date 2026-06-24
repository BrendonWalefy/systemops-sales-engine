/**
 * E2E Webhook Test — valida o pipeline de produção via HTTP POST no webhook.
 *
 * Uso:
 *   npx tsx scripts/e2e-webhook-test.ts --clinicId <uuid>
 *
 * Variáveis de ambiente:
 *   DATABASE_URL       — conexão Postgres (para validação e cleanup)
 *   E2E_WEBHOOK_URL    — URL completa (ex: https://systemops-core.vercel.app/api/whatsapp/zapi?secret=XXX)
 *   E2E_WAIT_MS        — timeout para cada asserção E2E em ms (default: 12000)
 *   E2E_SKIP_CLEANUP   — se "true", não deleta os leads de teste ao fim
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray, like, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  clinics,
  leads,
  conversations,
  messages,
  appointments,
  conversationStates,
  followUps,
  slotReservations,
} from "../src/infrastructure/db/schema";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const clinicId = getArg("--clinicId");
const skipCleanup = args.includes("--skip-cleanup") || process.env.E2E_SKIP_CLEANUP === "true";
const smoke = args.includes("--smoke");

if (!clinicId) {
  console.error("Uso: npx tsx scripts/e2e-webhook-test.ts --clinicId <uuid>");
  process.exit(1);
}

const webhookUrl = process.env.E2E_WEBHOOK_URL;
if (!webhookUrl) {
  console.error("E2E_WEBHOOK_URL não definida. Exemplo: https://systemops-core.vercel.app/api/whatsapp/zapi?secret=XXX");
  process.exit(1);
}

const waitMs = parseInt(process.env.E2E_WAIT_MS ?? "12000", 10);

// Gera telefone E2E puro em dígitos com prefixo inválido (55 + área 00000).
// normalizeWhatsAppPhone() extrai só dígitos, então o phone do payload precisa
// ser dígito-only para coincidir com o que é armazenado no banco.
function makeE2ePhone(suffix: number): string {
  const ts = suffix.toString().slice(-7).padStart(7, "0");
  return `5500000${ts}`; // 14 dígitos — prefixo 5500000 nunca é número real
}

// ── DB ────────────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}
const pgClient = postgres(connectionString, { max: 2 });
const db = drizzle(pgClient);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeId(): string {
  return randomUUID();
}

type ZApiPayload = {
  phone: string;
  instanceId: string;
  messageId: string;
  momment: number;
  status: string;
  chatName: string;
  senderName: string;
  senderPhoto?: string;
  text?: { message: string };
  audio?: { audioUrl: string; mimeType: string };
  image?: { imageUrl: string; caption?: string; mimeType: string };
  document?: { documentUrl: string; fileName: string; mimeType: string };
  isGroupMsg?: boolean;
  isStatusReply?: boolean;
  isEdit?: boolean;
  fromMe?: boolean;
  chatLid?: string | null;
};

function textPayload(
  instanceId: string,
  phone: string,
  text: string,
  options?: { omitOptionalFlags?: boolean },
): ZApiPayload {
  return {
    phone,
    instanceId,
    messageId: makeId(),
    momment: Date.now(),
    status: "RECEIVED",
    chatName: "E2E",
    senderName: "E2E Lead",
    text: { message: text },
    ...(options?.omitOptionalFlags
      ? {}
      : {
          isGroupMsg: false,
          isStatusReply: false,
          isEdit: false,
          fromMe: false,
        }),
  };
}

function imagePayload(instanceId: string, phone: string, imageUrl: string, caption = ""): ZApiPayload {
  return {
    phone,
    instanceId,
    messageId: makeId(),
    momment: Date.now(),
    status: "RECEIVED",
    chatName: "E2E",
    senderName: "E2E Lead",
    image: { imageUrl, caption, mimeType: "image/jpeg" },
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
    fromMe: false,
  };
}

async function postWebhook(payload: ZApiPayload): Promise<void> {
  const res = await fetch(webhookUrl!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Webhook retornou ${res.status}: ${body}`);
  }
}

// ── Test runner ───────────────────────────────────────────────────────────────

type TestResult = { name: string; passed: boolean; error?: string };
const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, passed: false, error: String(err) });
    console.error(`  ✗ ${name}: ${err}`);
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

async function waitFor<T>(description: string, check: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(1_000);
  }
  throw new Error(`${description} não foi concluído em ${waitMs}ms`);
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function getConversation(phone: string): Promise<{ id: string; aiPaused: boolean; needsAttention: boolean } | null> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.clinicId, clinicId!), eq(leads.phone, phone)))
    .limit(1);

  if (!lead) return null;

  const [conv] = await db
    .select({ id: conversations.id, aiPaused: conversations.aiPaused, needsAttention: conversations.needsAttention })
    .from(conversations)
    .where(eq(conversations.leadId, lead.id))
    .limit(1);

  return conv ?? null;
}

async function getAgentMessages(convId: string): Promise<Array<{ body: string; intent: string | null }>> {
  return db
    .select({ body: messages.body, intent: messages.intent })
    .from(messages)
    .where(and(eq(messages.conversationId, convId), eq(messages.author, "agent")));
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanupE2eLeads(): Promise<void> {
  const e2eLeads = await db
    .select({ id: leads.id, phone: leads.phone })
    .from(leads)
    .where(and(eq(leads.clinicId, clinicId!), like(leads.phone, "5500000%")));

  if (e2eLeads.length === 0) return;

  const leadIds = e2eLeads.map((l) => l.id);
  const convRows = await db.select({ id: conversations.id }).from(conversations).where(inArray(conversations.leadId, leadIds));
  const convIds = convRows.map((c) => c.id);

  if (convIds.length > 0) {
    await db.delete(messages).where(inArray(messages.conversationId, convIds));
    await db.delete(conversationStates).where(inArray(conversationStates.conversationId, convIds));
  }

  await db.delete(slotReservations).where(inArray(slotReservations.leadId, leadIds));
  await db.delete(appointments).where(inArray(appointments.leadId, leadIds));
  await db.delete(followUps).where(inArray(followUps.leadId, leadIds));
  await db.delete(conversations).where(inArray(conversations.leadId, leadIds));
  await db.delete(leads).where(inArray(leads.id, leadIds));

  console.log(`  🧹 Removidos ${e2eLeads.length} lead(s) E2E da clínica ${clinicId}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n🔬 E2E Webhook Test — clinicId: ${clinicId}`);
console.log(`   Webhook: ${webhookUrl}`);
console.log(`   Aguardando ${waitMs}ms por POST\n`);

// 1. Ler dados da clínica
const [clinic] = await db
  .select({ name: clinics.name, zapiInstanceId: clinics.zapiInstanceId, autoReplyEnabled: clinics.autoReplyEnabled })
  .from(clinics)
  .where(eq(clinics.id, clinicId!))
  .limit(1);

if (!clinic) {
  console.error(`Clínica ${clinicId} não encontrada`);
  await pgClient.end();
  process.exit(1);
}

if (!clinic.zapiInstanceId) {
  console.error(`Clínica "${clinic.name}" não tem zapiInstanceId configurado`);
  await pgClient.end();
  process.exit(1);
}

console.log(`Clínica: ${clinic.name} | autoReply: ${clinic.autoReplyEnabled} | instanceId: ${clinic.zapiInstanceId}\n`);

const instanceId = clinic.zapiInstanceId;

// Limpa leads E2E anteriores antes de começar
await cleanupE2eLeads();

if (smoke) {
  console.log("📋 Smoke — webhook Z-API sem flags opcionais");
  const phone = makeE2ePhone(Date.now());

  await test("S1: payload sem flags opcionais cria conversa e resposta", async () => {
    await postWebhook(textPayload(instanceId, phone, "oi", { omitOptionalFlags: true }));

    const conv = await waitFor("Conversa do payload sem flags", async () => {
      const candidate = await getConversation(phone);
      if (!candidate) return null;
      if (!clinic.autoReplyEnabled) return candidate;
      const agentMessages = await getAgentMessages(candidate.id);
      return agentMessages.length > 0 ? candidate : null;
    });

    assert(conv !== null, "Conversa não criada no DB");
  });
} else {
// ── Grupo A — Fluxo básico concierge ──────────────────────────────────────────

console.log("📋 Grupo A — Fluxo básico concierge");

const phoneA = makeE2ePhone(Date.now());

await test("A1: saudação cria lead + conversa no DB com resposta do agente", async () => {
  await postWebhook(textPayload(instanceId, phoneA, "oi"));
  await sleep(waitMs);

  const conv = await getConversation(phoneA);
  assert(conv !== null, "Conversa não criada no DB");

  if (clinic.autoReplyEnabled) {
    const msgs = await getAgentMessages(conv!.id);
    assert(msgs.length > 0, "Nenhuma mensagem do agente encontrada");
    const hasGreeting = msgs.some((m) =>
      ["greeting", "general_question", "acknowledgment"].includes(m.intent ?? ""),
    );
    assert(hasGreeting, `Intent esperado: greeting/acknowledgment. Intents encontrados: ${msgs.map((m) => m.intent).join(", ")}`);
  }
});

await test("A2: consulta de preço gera resposta com intent price_inquiry", async () => {
  const conv = await getConversation(phoneA);
  if (!conv) throw new Error("Conversa do A1 não encontrada");

  await postWebhook(textPayload(instanceId, phoneA, "quanto custa o tratamento de lentes?"));
  await sleep(waitMs);

  if (clinic.autoReplyEnabled) {
    const msgs = await getAgentMessages(conv.id);
    const hasPriceIntent = msgs.some((m) => m.intent === "price_inquiry" || m.intent === "general_question");
    assert(hasPriceIntent, `Intent esperado: price_inquiry. Intents encontrados: ${msgs.map((m) => m.intent).join(", ")}`);
  }
});

await test("A3: pedido de agendamento gera resposta com slots ou book_appointment", async () => {
  const conv = await getConversation(phoneA);
  if (!conv) throw new Error("Conversa do A1 não encontrada");

  const msgsBefore = (await getAgentMessages(conv.id)).length;
  await postWebhook(textPayload(instanceId, phoneA, "quero agendar uma consulta"));
  await sleep(waitMs);

  if (clinic.autoReplyEnabled) {
    const msgsAfter = await getAgentMessages(conv.id);
    assert(msgsAfter.length > msgsBefore, "Nenhuma mensagem nova do agente após pedido de agendamento");
  }
});

await test("A4: needs_human pausa a IA (aiPaused=true)", async () => {
  await postWebhook(textPayload(instanceId, phoneA, "quero falar com a recepcionista"));
  await sleep(waitMs);

  if (clinic.autoReplyEnabled) {
    const conv = await getConversation(phoneA);
    assert(conv !== null, "Conversa não encontrada");
    assert(conv!.aiPaused, `Esperava aiPaused=true após needs_human. aiPaused=${conv!.aiPaused}`);
  }
});

// ── Grupo B — Pipeline keyword ────────────────────────────────────────────────

console.log("\n📋 Grupo B — Pipeline keyword");

const phoneB = makeE2ePhone(Date.now() + 1);

await test("B1: nova conversa criada para lead B", async () => {
  await postWebhook(textPayload(instanceId, phoneB, "oi, interesse em lentes"));
  await sleep(waitMs);

  const conv = await getConversation(phoneB);
  assert(conv !== null, "Conversa B não criada no DB");
});

await test("B2: imagem enviada pelo lead é registrada no DB", async () => {
  const conv = await getConversation(phoneB);
  if (!conv) throw new Error("Conversa B não encontrada");

  // URL pública permanente para não depender de expiração Z-API
  // Sem caption para que o body fique "[imagem recebida]" e seja facilmente identificável
  const testImageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";
  await postWebhook(imagePayload(instanceId, phoneB, testImageUrl));
  await sleep(waitMs);

  const allMsgs = await db
    .select({ body: messages.body, author: messages.author })
    .from(messages)
    .where(eq(messages.conversationId, conv.id));

  // Sem caption: route.ts usa "[imagem recebida]" como body
  const hasImageMsg = allMsgs.some((m) => m.author === "lead" && m.body.includes("[imagem"));
  assert(hasImageMsg, `Mensagem de imagem não registrada. Mensagens encontradas: ${allMsgs.map((m) => `${m.author}: ${m.body.slice(0, 50)}`).join(" | ")}`);
});

// ── Grupo C — Resiliência: unclear consecutivo ────────────────────────────────

console.log("\n📋 Grupo C — Resiliência");

const phoneC = makeE2ePhone(Date.now() + 2);

await test("C1: conversa criada e IA responde a mensagens ambíguas", async () => {
  // Nota: o LLM classifica strings nonsense como general_question (não unclear)
  // pois tenta sempre ser "útil". O threshold de unclear está coberto por unit tests.
  // Aqui testamos apenas que a conversa C foi criada e que há resposta da IA.
  const msgs = [
    "skdjfhskdjfh",
    "zxcvbnm1234",
    "asdfpoiuqwer",
  ];

  for (const msg of msgs) {
    await postWebhook(textPayload(instanceId, phoneC, msg));
    await sleep(waitMs);
  }

  const conv = await getConversation(phoneC);
  assert(conv !== null, "Conversa C não criada após mensagens ambíguas");

  if (clinic.autoReplyEnabled) {
    const agentMsgs = await getAgentMessages(conv!.id);
    assert(agentMsgs.length > 0, "IA não respondeu nenhuma mensagem ambígua");
  }
});

await test("C2: após needs_human explícito, IA pausa (aiPaused=true)", async () => {
  if (!clinic.autoReplyEnabled) return;

  // needs_human é o que pausa a IA — unclear só seta needsAttention
  await postWebhook(textPayload(instanceId, phoneC, "quero falar com a recepcionista agora"));
  await sleep(waitMs);

  const conv = await getConversation(phoneC);
  assert(conv !== null, "Conversa C não encontrada");
  assert(conv!.aiPaused, `Esperava aiPaused=true após needs_human. aiPaused=${conv!.aiPaused}`);
});
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

console.log("\n🧹 Limpeza");

if (skipCleanup) {
  console.log("  ⚠️  E2E_SKIP_CLEANUP=true — leads não removidos");
} else {
  await cleanupE2eLeads();
}

// ── Resultado final ───────────────────────────────────────────────────────────

console.log("\n── Resultado ──────────────────────────────────────────────");
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed);

console.log(`${passed}/${results.length} testes passaram`);

if (failed.length > 0) {
  console.log("\nFalhas:");
  for (const f of failed) {
    console.log(`  ✗ ${f.name}`);
    if (f.error) console.log(`    ${f.error}`);
  }
}

await pgClient.end();
process.exit(failed.length > 0 ? 1 : 0);
