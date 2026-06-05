#!/usr/bin/env tsx

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url).pathname, "utf-8");
const sql = neon(env.match(/DATABASE_URL="([^"]+)"/)?.[1] ?? "");

const BASE = "http://localhost:3000";
const ZAPI_INSTANCE = "3F3939F113D8221F7B34C609B9308FED";
const TEST_PHONE = "5511953628848";
const BW_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

let msgCounter = Date.now();
let totalPass = 0;
let totalFail = 0;
const issues: string[] = [];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function section(title: string): void {
  console.log(`\n${"═".repeat(58)}\n  ${title}\n${"═".repeat(58)}`);
}

function ok(cond: boolean, label: string, detail = ""): boolean {
  if (cond) {
    totalPass++;
    console.log(`  ✅  ${label}`);
  } else {
    totalFail++;
    issues.push(label + (detail ? `: ${detail}` : ""));
    console.log(`  ❌  ${label}${detail ? " — " + detail : ""}`);
  }
  return cond;
}

async function webhook(input: {
  text?: string;
  audio?: { audioUrl: string; mimeType: string; seconds?: number };
  fromMe?: boolean;
}): Promise<void> {
  const payload = {
    phone: TEST_PHONE,
    instanceId: ZAPI_INSTANCE,
    messageId: `bw-extra-${msgCounter++}`,
    momment: Date.now(),
    status: "RECEIVED",
    chatName: "BW QA Lead",
    senderName: "BW QA Lead",
    ...(input.text !== undefined ? { text: { message: input.text } } : {}),
    ...(input.audio ? { audio: input.audio } : {}),
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
    fromMe: input.fromMe ?? false,
  };

  const res = await fetch(`${BASE}/api/whatsapp/zapi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook falhou: ${res.status}`);
}

async function cleanState(): Promise<void> {
  const leads = await sql`SELECT id FROM leads WHERE clinic_id = ${BW_ID} AND phone = ${TEST_PHONE}`;
  for (const lead of leads) {
    await sql`DELETE FROM appointments WHERE lead_id = ${lead.id as string}`;
    await sql`DELETE FROM slot_reservations WHERE lead_id = ${lead.id as string}`;
    const convs = await sql`SELECT id FROM conversations WHERE lead_id = ${lead.id as string}`;
    for (const conv of convs) {
      await sql`DELETE FROM messages WHERE conversation_id = ${conv.id as string}`;
      await sql`DELETE FROM conversation_states WHERE conversation_id = ${conv.id as string}`;
    }
    await sql`DELETE FROM conversations WHERE lead_id = ${lead.id as string}`;
    await sql`DELETE FROM follow_ups WHERE lead_id = ${lead.id as string}`;
    await sql`DELETE FROM leads WHERE id = ${lead.id as string}`;
  }
  await sql`DELETE FROM slot_reservations WHERE clinic_id = ${BW_ID}`;
  await sql`UPDATE clinics SET auto_reply_enabled = true WHERE id = ${BW_ID}`;
}

async function getConversation(): Promise<Record<string, unknown> | null> {
  const [conv] = await sql`
    SELECT c.id, c.ai_paused, c.takeover_expires_at, c.needs_attention, l.id AS lead_id, l.status AS lead_status
    FROM conversations c JOIN leads l ON l.id = c.lead_id
    WHERE c.clinic_id = ${BW_ID} AND l.phone = ${TEST_PHONE}
    ORDER BY c.last_message_at DESC LIMIT 1
  `;
  return conv ?? null;
}

async function waitAgent(timeoutMs = 25000): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await wait(700);
    const conv = await getConversation();
    if (!conv) continue;
    const [msg] = await sql`
      SELECT author, body, intent, sent_at FROM messages
      WHERE conversation_id = ${conv.id as string}
      ORDER BY sent_at DESC LIMIT 1
    `;
    if (msg?.author === "agent") return msg;
  }
  return null;
}

async function countAgentMessagesSince(conversationId: string, since: Date): Promise<number> {
  const [row] = await sql`
    SELECT count(*)::int AS total FROM messages
    WHERE conversation_id = ${conversationId} AND author = 'agent' AND sent_at >= ${since}
  `;
  return Number(row?.total ?? 0);
}

async function createLeadConversation(): Promise<{ leadId: string; conversationId: string }> {
  await webhook({ text: "Oi" });
  await waitAgent();
  const conv = await getConversation();
  if (!conv?.id || !conv.lead_id) throw new Error("Conversa não criada");
  return { leadId: String(conv.lead_id), conversationId: String(conv.id) };
}

async function createAppointment(leadId: string, startsAt: Date, status = "scheduled"): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO appointments (id, clinic_id, lead_id, starts_at, ends_at, status, source, created_at, updated_at)
    VALUES (${id}, ${BW_ID}, ${leadId}, ${startsAt}, ${new Date(startsAt.getTime() + 60 * 60_000)}, ${status}, 'app', now(), now())
  `;
  return id;
}

console.log("\n🧪 BW Odontologia — Cenários E2E Extras");

try {
  const ping = await fetch(`${BASE}/api/health`).catch(() => ({ ok: false }));
  if (!(ping as Response).ok) throw new Error("server not reachable");
} catch {
  console.log("⚠️  Servidor não acessível em " + BASE);
  process.exit(1);
}

section("T-AUDIO-01 — áudio com autoReply=true");
await cleanState();
await webhook({
  audio: {
    audioUrl: "https://www2.cs.uic.edu/~i101/SoundFiles/StarWars3.wav",
    mimeType: "audio/wav",
    seconds: 3,
  },
});
const audioAgent = await waitAgent(35000);
const convAudio = await getConversation();
const [audioLead] = convAudio?.id
  ? await sql`SELECT body FROM messages WHERE conversation_id = ${convAudio.id as string} AND author='lead' ORDER BY sent_at DESC LIMIT 1`
  : [];
ok(!!audioLead, "mensagem de áudio salva como lead");
ok(String(audioLead?.body ?? "") !== "[áudio recebido]", "body contém transcrição, não fallback literal", String(audioLead?.body ?? ""));
ok(!!audioAgent, "IA respondeu ao áudio transcrito");

section("T-AUDIO-02 — áudio com autoReply=false");
await cleanState();
await sql`UPDATE clinics SET auto_reply_enabled = false WHERE id = ${BW_ID}`;
await webhook({
  audio: {
    audioUrl: "https://www2.cs.uic.edu/~i101/SoundFiles/StarWars3.wav",
    mimeType: "audio/wav",
    seconds: 3,
  },
});
await wait(2500);
const convAudioOff = await getConversation();
const [audioOffLead] = convAudioOff?.id
  ? await sql`SELECT body FROM messages WHERE conversation_id = ${convAudioOff.id as string} AND author='lead' ORDER BY sent_at DESC LIMIT 1`
  : [];
const [audioOffAgent] = convAudioOff?.id
  ? await sql`SELECT id FROM messages WHERE conversation_id = ${convAudioOff.id as string} AND author='agent' LIMIT 1`
  : [];
ok(String(audioOffLead?.body ?? "") === "[áudio recebido]", "body salvo como [áudio recebido]");
ok(!audioOffAgent, "nenhuma resposta da IA com autoReply=false");
await sql`UPDATE clinics SET auto_reply_enabled = true WHERE id = ${BW_ID}`;

section("T-DUPLA-MENSAGEM — duas mensagens rápidas");
await cleanState();
const startedAt = new Date();
await Promise.all([
  webhook({ text: "Boa tarde" }),
  webhook({ text: "Aqui é o Bruno" }),
]);
await wait(8000);
const convDouble = await getConversation();
const doubleCount = convDouble?.id ? await countAgentMessagesSince(String(convDouble.id), startedAt) : 0;
ok(doubleCount === 1, "exatamente 1 mensagem agent em 8s", `agent=${doubleCount}`);

section("T-STATUS-STALE — appointment_scheduled no passado");
await cleanState();
const stale = await createLeadConversation();
const pastStart = new Date(Date.now() - 2 * 24 * 60 * 60_000);
await createAppointment(stale.leadId, pastStart, "scheduled");
await sql`UPDATE leads SET status='appointment_scheduled' WHERE id=${stale.leadId}`;
await webhook({ text: "quero agendar uma avaliacao" });
const staleAgent = await waitAgent();
const staleBody = String(staleAgent?.body ?? "");
ok(!!staleAgent, "agente respondeu");
ok(!staleBody.toLowerCase().includes("problema técnico"), "não retornou problema técnico");
ok(staleBody.includes("1.") || staleBody.toLowerCase().includes("horários"), "ofereceu slots normalmente", staleBody.slice(0, 160));

section("T-NUMBER-LIST — número após lista de procedimentos");
await cleanState();
await webhook({ text: "quais procedimentos voces fazem" });
await waitAgent();
await webhook({ text: "8" });
const numberAgent = await waitAgent();
const numberBody = String(numberAgent?.body ?? "");
ok(!!numberAgent, "agente respondeu ao número");
ok(!numberBody.toLowerCase().includes("problema técnico"), "não retornou problema técnico");

section("T-FOLLOWUP — follow-up após completed");
await cleanState();
const follow = await createLeadConversation();
const apptStart = new Date(Date.now() + 24 * 60 * 60_000);
const apptId = await createAppointment(follow.leadId, apptStart, "scheduled");
await sql`UPDATE appointments SET status='completed', updated_at=now() WHERE id=${apptId}`;
await wait(1000);
const [followUp] = await sql`
  SELECT reason, due_at FROM follow_ups
  WHERE clinic_id=${BW_ID} AND lead_id=${follow.leadId}
  ORDER BY created_at DESC LIMIT 1
`;
const due = followUp?.due_at ? new Date(String(followUp.due_at)) : null;
const expectedDue = new Date(apptStart);
expectedDue.setMonth(expectedDue.getMonth() + 6);
const dueDiffDays = due ? Math.abs(due.getTime() - expectedDue.getTime()) / (24 * 60 * 60_000) : Infinity;
ok(followUp?.reason === "Retorno de rotina", "follow_up reason=Retorno de rotina");
ok(dueDiffDays < 2, "follow_up dueAt ~ 6 meses");

section("T-RETOMADA-TTL — IA retoma após TTL expirado");
await cleanState();
const ttl = await createLeadConversation();
await sql`
  UPDATE conversations
  SET ai_paused=true, takeover_expires_at=${new Date(Date.now() - 60_000)}, updated_at=now()
  WHERE id=${ttl.conversationId}
`;
await webhook({ text: "Boa tarde, podemos continuar?" });
const ttlAgent = await waitAgent();
const ttlBody = String(ttlAgent?.body ?? "");
ok(!!ttlAgent, "agente respondeu após TTL expirado");
ok(!ttlBody.toLowerCase().includes("problema técnico"), "sem problema técnico na retomada");
ok(/continu|retom|por aqui|seguir|ajudar/i.test(ttlBody), "resposta contém contexto de retomada", ttlBody.slice(0, 160));

await sql`UPDATE clinics SET auto_reply_enabled = true WHERE id = ${BW_ID}`;

console.log(`\n${"═".repeat(58)}`);
console.log(`  RESULTADO EXTRAS: ${totalPass} ✅  ${totalFail} ❌  (${totalPass + totalFail} total)`);
if (issues.length > 0) {
  console.log("\n  Falhas:");
  issues.forEach((issue) => console.log(`    • ${issue}`));
}
console.log(`${"═".repeat(58)}\n`);

process.exit(totalFail > 0 ? 1 : 0);
