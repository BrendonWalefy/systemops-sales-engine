#!/usr/bin/env tsx

import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const envPath = new URL("../.env.local", import.meta.url).pathname;
const env = readFileSync(envPath, "utf-8");

function readEnv(name: string): string | null {
  const match = env.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, "m"));
  return match?.[1] ?? null;
}

const dbUrl = readEnv("DATABASE_URL");
const cronSecret = readEnv("CRON_SECRET");
const webhookSecret = readEnv("ZAPI_WEBHOOK_SECRET");

if (!dbUrl) throw new Error("DATABASE_URL nao encontrado no .env.local");
if (!cronSecret) throw new Error("CRON_SECRET nao encontrado no .env.local");

const sql = neon(dbUrl);

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ZAPI_INSTANCE = "3F3939F113D8221F7B34C609B9308FED";
const BW_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";
const TEST_PHONE = "5511953628848";
const RECEPTIONIST_PHONE = "5511940617713";

let totalPass = 0;
let totalFail = 0;
const issues: string[] = [];
let msgCounter = Date.now();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function section(title: string): void {
  console.log(`\n${"=".repeat(64)}\n${title}\n${"=".repeat(64)}`);
}

function ok(condition: boolean, label: string, detail = ""): boolean {
  if (condition) {
    totalPass++;
    console.log(`  PASS ${label}`);
    return true;
  }

  totalFail++;
  issues.push(detail ? `${label}: ${detail}` : label);
  console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  return false;
}

function buildWebhookUrl(): string {
  if (!webhookSecret) return `${BASE}/api/whatsapp/zapi`;
  return `${BASE}/api/whatsapp/zapi?secret=${encodeURIComponent(webhookSecret)}`;
}

async function ensureServer(): Promise<void> {
  const response = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!response?.ok) {
    throw new Error(`Servidor indisponivel em ${BASE}. Inicie 'npm run dev' antes do replay.`);
  }
}

async function postWebhook(params: {
  phone: string;
  text: string;
  fromMe?: boolean;
  messageId?: string;
}): Promise<void> {
  const response = await fetch(buildWebhookUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone: params.phone,
      instanceId: ZAPI_INSTANCE,
      messageId: params.messageId ?? `bw-phase4-${msgCounter++}`,
      momment: Date.now(),
      status: "RECEIVED",
      chatName: "BW Incident Replay",
      senderName: "BW Incident Replay",
      text: { message: params.text },
      isGroupMsg: false,
      isStatusReply: false,
      isEdit: false,
      fromMe: params.fromMe ?? false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook falhou (${response.status})`);
  }
}

async function triggerFollowUpDispatcher(): Promise<{
  clinics: number;
  dispatched: number;
  failed: number;
}> {
  const response = await fetch(`${BASE}/api/cron/follow-up-dispatcher`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${cronSecret}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Dispatcher falhou (${response.status})`);
  }

  return response.json() as Promise<{
    clinics: number;
    dispatched: number;
    failed: number;
  }>;
}

async function cleanPhoneState(phone: string): Promise<void> {
  const leads = await sql`
    SELECT id
    FROM leads
    WHERE clinic_id = ${BW_ID}
      AND phone = ${phone}
  `;

  for (const lead of leads) {
    const leadId = String(lead.id);

    await sql`DELETE FROM appointments WHERE lead_id = ${leadId}`;
    await sql`DELETE FROM slot_reservations WHERE lead_id = ${leadId}`;

    const conversations = await sql`
      SELECT id
      FROM conversations
      WHERE lead_id = ${leadId}
    `;

    for (const conversation of conversations) {
      const conversationId = String(conversation.id);
      await sql`DELETE FROM messages WHERE conversation_id = ${conversationId}`;
      await sql`DELETE FROM conversation_states WHERE conversation_id = ${conversationId}`;
    }

    await sql`DELETE FROM conversations WHERE lead_id = ${leadId}`;
    await sql`DELETE FROM follow_ups WHERE lead_id = ${leadId}`;
    await sql`DELETE FROM leads WHERE id = ${leadId}`;
  }
}

async function countArtifactsByPhone(phone: string): Promise<{
  leads: number;
  conversations: number;
  messages: number;
}> {
  const [row] = await sql`
    SELECT
      COUNT(DISTINCT l.id)::int AS leads,
      COUNT(DISTINCT c.id)::int AS conversations,
      COUNT(m.id)::int AS messages
    FROM leads l
    LEFT JOIN conversations c ON c.lead_id = l.id
    LEFT JOIN messages m ON m.conversation_id = c.id
    WHERE l.clinic_id = ${BW_ID}
      AND l.phone = ${phone}
  `;

  return {
    leads: Number(row?.leads ?? 0),
    conversations: Number(row?.conversations ?? 0),
    messages: Number(row?.messages ?? 0),
  };
}

async function createLeadConversation(params: {
  phone: string;
  name: string;
}): Promise<{ leadId: string; conversationId: string }> {
  const leadId = randomUUID();
  const conversationId = randomUUID();
  const now = new Date();

  await sql`
    INSERT INTO leads (
      id, clinic_id, name, phone, channel, status, created_at, updated_at
    )
    VALUES (
      ${leadId}, ${BW_ID}, ${params.name}, ${params.phone}, 'whatsapp', 'in_conversation', ${now}, ${now}
    )
  `;

  await sql`
    INSERT INTO conversations (
      id, clinic_id, lead_id, channel, external_thread_id, ai_paused,
      needs_attention, consecutive_unclear_count, last_message_at, created_at, updated_at
    )
    VALUES (
      ${conversationId}, ${BW_ID}, ${leadId}, 'whatsapp', ${params.phone}, false,
      false, 0, ${now}, ${now}, ${now}
    )
  `;

  return { leadId, conversationId };
}

async function insertAgentMessage(params: {
  conversationId: string;
  body: string;
  externalId: string | null;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | "audio" | "document" | null;
}): Promise<string> {
  const messageId = randomUUID();
  const sentAt = new Date();

  await sql`
    INSERT INTO messages (
      id, conversation_id, author, body, media_url, media_type, sent_at,
      external_id, intent, delivery_format, created_at
    )
    VALUES (
      ${messageId}, ${params.conversationId}, 'agent', ${params.body},
      ${params.mediaUrl ?? null}, ${params.mediaType ?? null}, ${sentAt},
      ${params.externalId}, 'general_question', 'text', ${sentAt}
    )
  `;

  await sql`
    UPDATE conversations
    SET last_message_at = ${sentAt}, updated_at = ${sentAt}
    WHERE id = ${params.conversationId}
  `;

  return messageId;
}

async function listMessages(conversationId: string): Promise<Array<{
  author: string;
  body: string;
  externalId: string | null;
}>> {
  const rows = await sql`
    SELECT author, body, external_id
    FROM messages
    WHERE conversation_id = ${conversationId}
    ORDER BY sent_at ASC
  `;

  return rows.map((row) => ({
    author: String(row.author),
    body: String(row.body),
    externalId: row.external_id ? String(row.external_id) : null,
  }));
}

async function getConversationFlags(conversationId: string): Promise<{
  aiPaused: boolean;
  needsAttention: boolean;
}> {
  const [row] = await sql`
    SELECT ai_paused, needs_attention
    FROM conversations
    WHERE id = ${conversationId}
  `;

  return {
    aiPaused: Boolean(row?.ai_paused),
    needsAttention: Boolean(row?.needs_attention),
  };
}

async function insertFollowUp(params: {
  leadId: string;
  reason: string;
  dueAt: Date;
  createdAt: Date;
}): Promise<void> {
  await sql`
    INSERT INTO follow_ups (
      id, clinic_id, lead_id, due_at, status, reason, suggested_message, completed_at, created_at, updated_at
    )
    VALUES (
      ${randomUUID()}, ${BW_ID}, ${params.leadId}, ${params.dueAt}, 'pending',
      ${params.reason}, null, null, ${params.createdAt}, ${params.createdAt}
    )
  `;
}

async function scenarioInternalAlertSuppression(): Promise<void> {
  section("Scenario 1 - Internal attention alert suppression");
  await cleanPhoneState(RECEPTIONIST_PHONE);

  const before = await countArtifactsByPhone(RECEPTIONIST_PHONE);
  await postWebhook({
    phone: RECEPTIONIST_PHONE,
    text: "Fulano precisa de voce\n\nPrecisa de atendimento humano.\n\nAcesse o Inbox para responder.",
  });
  await wait(400);
  const after = await countArtifactsByPhone(RECEPTIONIST_PHONE);

  ok(after.leads === before.leads, "alerta interno nao cria lead");
  ok(after.conversations === before.conversations, "alerta interno nao cria conversa");
  ok(after.messages === before.messages, "alerta interno nao persiste mensagem");
}

async function scenarioDuplicateVideoFollowUpSuppression(): Promise<void> {
  section("Scenario 2 - Duplicate video follow-up suppression");
  await cleanPhoneState(TEST_PHONE);

  const { leadId, conversationId } = await createLeadConversation({
    phone: TEST_PHONE,
    name: "BW Replay FollowUp",
  });

  const now = new Date();
  await insertFollowUp({
    leadId,
    reason: "video_sent:Lentes - Tecnica Simplificada",
    dueAt: new Date(now.getTime() - 60_000),
    createdAt: new Date(now.getTime() - 120_000),
  });
  await insertFollowUp({
    leadId,
    reason: "video_sent:Lentes - Tecnica Estratificada",
    dueAt: new Date(now.getTime() - 30_000),
    createdAt: new Date(now.getTime() - 90_000),
  });

  const dispatcher = await triggerFollowUpDispatcher();
  const followUps = await sql`
    SELECT reason, status
    FROM follow_ups
    WHERE lead_id = ${leadId}
    ORDER BY created_at ASC
  `;
  const messages = await listMessages(conversationId);
  const agentMessages = messages.filter((message) => message.author === "agent");

  ok(dispatcher.failed === 0, "dispatcher conclui sem falhas", JSON.stringify(dispatcher));
  ok(
    followUps.filter((followUp) => String(followUp.status) === "done").length === 1,
    "apenas um follow-up fica como done",
  );
  ok(
    followUps.filter((followUp) => String(followUp.status) === "cancelled").length === 1,
    "follow-up duplicado fica cancelado",
  );
  ok(agentMessages.length === 1, "dispatcher envia uma unica mensagem do agente", `agent=${agentMessages.length}`);
}

async function scenarioReengagementCancelsPendingFollowUp(): Promise<void> {
  section("Scenario 3 - Reengagement cancels pending follow-up");
  await cleanPhoneState(TEST_PHONE);

  const { leadId, conversationId } = await createLeadConversation({
    phone: TEST_PHONE,
    name: "BW Replay Reengagement",
  });

  const now = new Date();
  await insertFollowUp({
    leadId,
    reason: "video_sent:Lentes - Tecnica Simplificada",
    dueAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
    createdAt: now,
  });

  await postWebhook({
    phone: TEST_PHONE,
    text: "Oi, vi o vídeo e quero agendar",
    fromMe: false,
    messageId: `bw-reengage-${msgCounter++}`,
  });

  await wait(500);

  const afterInbound = await sql`
    SELECT reason, status
    FROM follow_ups
    WHERE lead_id = ${leadId}
    ORDER BY created_at ASC
  `;
  const messagesBeforeDispatcher = await listMessages(conversationId);
  const agentBeforeDispatcher = messagesBeforeDispatcher.filter((message) => message.author === "agent").length;

  const dispatcher = await triggerFollowUpDispatcher();
  const afterDispatcher = await sql`
    SELECT reason, status
    FROM follow_ups
    WHERE lead_id = ${leadId}
    ORDER BY created_at ASC
  `;
  const messagesAfterDispatcher = await listMessages(conversationId);
  const agentAfterDispatcher = messagesAfterDispatcher.filter((message) => message.author === "agent").length;

  ok(
    afterInbound.length === 1 && String(afterInbound[0]?.status) === "cancelled",
    "reengajamento cancela o follow-up pendente antes do cron",
    JSON.stringify(afterInbound),
  );
  ok(dispatcher.failed === 0, "dispatcher continua sem falhas apos reengajamento", JSON.stringify(dispatcher));
  ok(
    afterDispatcher.every((followUp) => String(followUp.status) === "cancelled"),
    "dispatcher nao reativa follow-up cancelado por reengajamento",
    JSON.stringify(afterDispatcher),
  );
  ok(
    agentAfterDispatcher === agentBeforeDispatcher,
    "dispatcher nao envia follow-up apos o lead responder",
    `antes=${agentBeforeDispatcher} depois=${agentAfterDispatcher}`,
  );
}

async function scenarioInterleavedEchoSuppression(): Promise<void> {
  section("Scenario 4 - Echo suppression for interleaved text/video parts");
  await cleanPhoneState(TEST_PHONE);

  const { conversationId } = await createLeadConversation({
    phone: TEST_PHONE,
    name: "BW Replay Echo",
  });

  const firstText = "Sobre a Tecnica Simplificada, ela entrega um resultado natural.";
  const mediaTitle = "Lentes - Tecnica Simplificada";

  await insertAgentMessage({
    conversationId,
    body: firstText,
    externalId: "echo-text-part-1",
  });
  await insertAgentMessage({
    conversationId,
    body: mediaTitle,
    externalId: "echo-media-part-1",
    mediaUrl: "https://blob.example/video.mp4",
    mediaType: "video",
  });

  const beforeMessages = await listMessages(conversationId);

  await postWebhook({
    phone: TEST_PHONE,
    text: firstText,
    fromMe: false,
    messageId: "echo-text-part-1",
  });
  await postWebhook({
    phone: TEST_PHONE,
    text: mediaTitle,
    fromMe: false,
    messageId: "echo-media-part-1",
  });

  await wait(400);

  const afterMessages = await listMessages(conversationId);
  const flags = await getConversationFlags(conversationId);
  const leadMessages = afterMessages.filter((message) => message.author === "lead");
  const clinicUserMessages = afterMessages.filter((message) => message.author === "clinic_user");

  ok(afterMessages.length === beforeMessages.length, "echo nao cria novas mensagens");
  ok(leadMessages.length === 0, "echo nao reentra como mensagem do lead");
  ok(clinicUserMessages.length === 0, "echo nao pausa a IA como operator takeover");
  ok(flags.aiPaused === false, "conversa permanece com ai_paused=false");
  ok(flags.needsAttention === false, "echo nao marca needs_attention");
}

console.log("\nBW Phase 4 Incident Replay");
console.log(`Base URL: ${BASE}`);
console.log(`Clinic:   ${BW_ID}`);
console.log(`Phone:    ${TEST_PHONE}`);

await ensureServer();
await scenarioInternalAlertSuppression();
await scenarioDuplicateVideoFollowUpSuppression();
await scenarioReengagementCancelsPendingFollowUp();
await scenarioInterleavedEchoSuppression();

console.log(`\n${"=".repeat(64)}`);
console.log(`Replay result: ${totalPass} passed, ${totalFail} failed`);
if (issues.length > 0) {
  console.log("\nIssues:");
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }
}
console.log(`${"=".repeat(64)}\n`);

process.exit(totalFail > 0 ? 1 : 0);
