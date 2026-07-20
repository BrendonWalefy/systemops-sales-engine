/**
 * Replay da etapa de fechamento do pipeline (config-driven, clínicas com sinal).
 * Valida a cadeia inteira contra o branch Neon isolado:
 *   1. operador aciona a etapa "book" escolhendo um horário (rota autenticada)
 *   2. lead recebe o pedido de sinal + slot fica reservado PROVISORIAMENTE
 *   3. lead envia o comprovante
 *   4. responsável recebe os botões de validação e o estado vira deposit_proof_received
 */
import { db } from "../src/infrastructure/db/client";
import { conversations, messages, leads, slotReservations, conversationStates } from "../src/infrastructure/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { signToken } from "../src/lib/session";

const BASE = "http://localhost:3411";
const INSTANCE = "3F5B7D6043D871F185FB66427513BEA4";
const SECRET = process.env.ZAPI_WEBHOOK_SECRET!;
const CRON = process.env.CRON_SECRET!;
const CLINIC_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const LENS_TREATMENT_ID = "39b29140-f356-4a0c-aa36-be533aa58c8e";
const BOOK_STEP_INDEX = 6; // "Confirmar agendamento" no pipeline de lentes
const PHONE = "5500000970001";
const PROOF_IMAGE = "https://wdambmfza8itfgaf.public.blob.vercel-storage.com/lead-media/858b14f7-e9af-4dae-b3bb-137d442f18eb-8hqaBTIMiY7AHD6kaRuhgy5btQAnyt.jpg";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pump() {
  await fetch(`${BASE}/api/cron/message-worker`, { headers: { Authorization: `Bearer ${CRON}` } }).catch(() => {});
  await fetch(`${BASE}/api/cron/sender-worker`, { headers: { Authorization: `Bearer ${CRON}` } }).catch(() => {});
}
async function postWebhook(payload: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/whatsapp/zapi?secret=${SECRET}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, instanceId: INSTANCE, messageId: randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20), momment: Date.now(), status: "RECEIVED", chatName: "Deposit W4", senderName: "Deposit W4", isGroupMsg: false, isStatusReply: false, isEdit: false, fromMe: false, ...payload }),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${await res.text()}`);
}
async function findConv() {
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.clinicId, CLINIC_ID), eq(leads.phone, PHONE))).limit(1);
  if (!lead) return null;
  const [conv] = await db.select().from(conversations).where(eq(conversations.leadId, lead.id)).limit(1);
  return conv ? { leadId: lead.id, conv } : null;
}
async function agentCount(): Promise<number> {
  const c = await findConv();
  if (!c) return 0;
  const rows = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, c.conv.id), eq(messages.author, "agent")));
  return rows.length;
}
async function waitReply(before: number, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let grownAt: number | null = null; let last = before;
  while (Date.now() < deadline) {
    await pump(); await sleep(1500);
    let c = last;
    try { c = await agentCount(); } catch { continue; }
    if (c > last) { last = c; grownAt = Date.now(); }
    if (grownAt && Date.now() - grownAt > 7000) return;
  }
}

async function main() {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND !== "true") throw new Error("DISABLE_REAL_WHATSAPP_SEND!=true");

  console.log("1) Lead chega pelo anúncio");
  await postWebhook({ text: { message: "Olá! Quero saber como posso transformar meu sorriso com as lentes  de resina?" } });
  await waitReply(0);

  const ctx = await findConv();
  if (!ctx) throw new Error("conversa não criada");

  console.log("2) Operador aciona a etapa de fechamento escolhendo o horário");
  const token = await signToken({ email: process.env.OWNER_EMAIL ?? "owner@systemops.ai", role: "owner", memberRole: "owner", professionalId: null });
  const cookie = `sops_session=${token}; sops_active_clinic=${CLINIC_ID}`;
  const target = new Date(Date.now() + 5 * 24 * 3600_000); // daqui a 5 dias
  const date = target.toISOString().slice(0, 10);
  const res = await fetch(`${BASE}/api/conversations/${ctx.conv.id}/pipeline-actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      treatmentId: LENS_TREATMENT_ID,
      action: "start_pipeline_rails",
      stepIndex: BOOK_STEP_INDEX,
      date,
      time: "16:00",
      durationMinutes: 60,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  console.log("   → rota:", res.status, JSON.stringify(payload));
  if (!res.ok) throw new Error("ação de fechamento falhou");

  const beforeProof = await agentCount();
  await pump(); await sleep(3000); await pump();

  // Estado após pedir o sinal
  const [stAfterRequest] = await db.select().from(conversationStates).where(eq(conversationStates.conversationId, ctx.conv.id)).orderBy(desc(conversationStates.createdAt)).limit(1);
  const reservations = await db.select().from(slotReservations).where(and(eq(slotReservations.clinicId, CLINIC_ID), eq(slotReservations.leadId, ctx.leadId)));
  console.log(`   → estado="${stAfterRequest?.state}" | reservas=${reservations.map(r => `${r.status}@${r.startsAt.toISOString().slice(0,16)}`).join(", ")}`);

  console.log("3) Lead envia o comprovante do Pix");
  await postWebhook({ image: { imageUrl: PROOF_IMAGE, caption: "", mimeType: "image/jpeg" } });
  await waitReply(beforeProof);

  const [stAfterProof] = await db.select().from(conversationStates).where(eq(conversationStates.conversationId, ctx.conv.id)).orderBy(desc(conversationStates.createdAt)).limit(1);
  const after = await findConv();
  console.log(`   → estado="${stAfterProof?.state}" | needsAttention=${after?.conv.needsAttention} | reason=${after?.conv.attentionReason ?? "-"}`);

  console.log("\n████ TRANSCRIPT");
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, ctx.conv.id)).orderBy(asc(messages.sentAt));
  for (const m of msgs) console.log(`  [${m.author}${m.intent ? ` (${m.intent})` : ""}]${m.mediaUrl ? ` {${m.mediaType}}` : ""} ${(m.body ?? "").replace(/\n/g, " ⏎ ").slice(0, 190)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
