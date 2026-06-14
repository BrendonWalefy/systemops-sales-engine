#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// Campanha de recuperação de leads que ficaram sem atendimento.
// Uso: npx dotenv -e .env.local -- npx tsx scripts/recovery-campaign.ts [--send]
//
// Sem --send: dry-run, apenas exibe as mensagens que seriam enviadas.
// Com --send: envia de verdade via Z-API e registra no banco.

import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import OpenAI from "openai";
import { readFileSync } from "fs";

const DRY_RUN = !process.argv.includes("--send");
if (DRY_RUN) console.log("DRY-RUN: nenhuma mensagem será enviada. Use --send para enviar.\n");

const env = readFileSync(new URL("../.env.local", import.meta.url).pathname, "utf-8");
const dbUrlMatch = env.match(/DATABASE_URL="([^"]+)"/);
if (!dbUrlMatch) throw new Error("DATABASE_URL não encontrado em .env.local");
const dbUrl = dbUrlMatch[1];;

// 1. Buscar clínica Ximendes
const clinic = await db.query.clinics.findFirst({
  where: (c, { or, ilike }) => or(ilike(c.name, "%ximendes%"), ilike(c.slug, "%ximendes%")),
});
if (!clinic) throw new Error("Clínica Ximendes não encontrada");

const clinicId = clinic.id;
const editorial = await resolveActiveEditorialConfig(clinicId);
const channelConfig = resolveChannelConfig(clinic);
const receptionistName = inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? "Marina";
const timezone = new ClinicTimezone(clinic.timezone);
const now = new Date();

// 2. Leads elegíveis: takeover expirado OU IA ativa mas sem resposta por 2h
//    Exclui: lost, won, e leads sem phone/whatsappLid
const unattended = await db.execute(`
  SELECT DISTINCT
    l.id as lead_id,
    l.name,
    l.phone,
    l.whatsapp_lid,
    l.temperature,
    l.status as lead_status,
    c.id as conv_id,
    c.ai_paused,
    c.takeover_expires_at,
    EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 3600 as hours_silent,
    (SELECT m2.author FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.sent_at DESC LIMIT 1) as last_author,
    (SELECT m2.body FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.sent_at DESC LIMIT 1) as last_body
  FROM leads l
  JOIN conversations c ON c.lead_id = l.id
  WHERE l.clinic_id = '${clinicId}'
    AND l.status NOT IN ('lost', 'won')
    AND (l.phone IS NOT NULL OR l.whatsapp_lid IS NOT NULL)
    AND (
      -- Takeover expirado
      (c.ai_paused = true AND c.takeover_expires_at IS NOT NULL AND c.takeover_expires_at < NOW())
      OR
      -- IA ativa mas lead esperando há mais de 2h
      (c.ai_paused = false AND c.last_message_at < NOW() - INTERVAL '2 hours'
       AND (SELECT m2.author FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.sent_at DESC LIMIT 1) = 'lead')
    )
    -- Não enviar para quem já tem follow-up de recuperação pendente
    AND NOT EXISTS (
      SELECT 1 FROM follow_ups f
      WHERE f.lead_id = l.id AND f.reason = 'recovery_campaign' AND f.status = 'pending'
    )
  ORDER BY hours_silent ASC
`) as { rows: Array<Record<string, any>> };

// 3. Buscar histórico recente de cada lead para contextualizar a mensagem
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function composeRecoveryMessage(leadName: string | null, convId: string): Promise<string | null> {
  const history = await db.execute(`
    SELECT author, body, sent_at
    FROM messages
    WHERE conversation_id = '${convId}'
      AND author IN ('lead', 'agent', 'clinic_user')
    ORDER BY sent_at DESC
    LIMIT 20
  `) as { rows: Array<{ author: string; body: string; sent_at: Date }> };

  const recentMsgs = history.rows.reverse();
  if (recentMsgs.length === 0) return null;

  const historyText = recentMsgs
    .map((m) => `${m.author === "lead" ? "LEAD" : "CLÍNICA"}: ${m.body?.slice(0, 200)}`)
    .join("\n");

  const prompt = `Você é ${receptionistName}, recepcionista virtual da ${clinic.name}, uma clínica especializada em ${editorial?.specialty ?? "odontologia estética"}.

HISTÓRICO DA CONVERSA:
${historyText}

CONTEXTO: Esta conversa ficou sem resposta por alguns dias por um problema técnico/operacional. O lead NÃO deve saber disso.

Escreva UMA mensagem curta e calorosa de retomada de conversa. Regras:
- Máximo 3 frases
- Mencione especificamente o que o lead perguntou ou demonstrou interesse
- NÃO mencione que houve falha, demora ou problema técnico
- NÃO prometa agendamento, não confirme horários
- Seja natural, como se fosse uma continuação orgânica
- Use o nome ${leadName ?? "do lead"} se disponível
- Tom: caloroso, profissional, conciso
- Se a última mensagem do lead foi uma emoji/saudação isolada, retome com o tópico de interesse anterior
- Se o lead pediu preço e não recebeu resposta, mencione que pode ajudar com os valores

Responda APENAS com o texto da mensagem, sem aspas.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  return resp.choices[0]?.message?.content?.trim() ?? null;
}

// 4. Processar cada lead
console.log("=".repeat(70));
console.log(`CAMPANHA DE RECUPERAÇÃO — ${now.toLocaleString("pt-BR", { timeZone: clinic.timezone })}`);
console.log(`Clínica: ${clinic.name} | Modo: ${DRY_RUN ? "DRY-RUN" : "ENVIANDO"}`);
console.log("=".repeat(70));

const results: { name: string; status: "skip" | "ok" | "error"; msg?: string; reason?: string }[] = [];

for (const row of unattended.rows) {
  const leadName = row.name as string | null;
  const display = leadName ?? row.phone ?? "sem nome";
  const lastBody = row.last_body as string | null;
  const hoursStr = Number(row.hours_silent).toFixed(0);

  // Pular leads com nome inválido ou sem identificador de contato
  if (!row.phone && !row.whatsapp_lid) {
    results.push({ name: display, status: "skip", reason: "sem telefone" });
    continue;
  }

  // Pular leads com consulta agendada cujo último contato foi casual (não precisam de sales)
  if (row.lead_status === "appointment_scheduled") {
    const body = (lastBody ?? "").toLowerCase();
    const isCasualMsg = ["como posso", "blz", "blzzz", "tranquilo", "👍", "blz"].some((p) => body.includes(p));
    if (isCasualMsg) {
      results.push({ name: display, status: "skip", reason: "consulta agendada, contato foi casual" });
      continue;
    }
  }

  // Janaína: contexto da conversa truncado, mensagem inválida gerada no dry-run
  if ((leadName ?? "").toLowerCase().startsWith("jana")) {
    results.push({ name: display, status: "skip", reason: "contexto de conversa insuficiente para mensagem de qualidade" });
    continue;
  }

  // Pular emoji isolado sem contexto anterior relevante
  const lastBodyTrim = (lastBody ?? "").trim();
  const isIsolatedEmoji = /^[\p{Emoji}\s]+$/u.test(lastBodyTrim) && lastBodyTrim.length < 10;
  const isThumb = lastBodyTrim === "👍🏼" || lastBodyTrim === "👍";
  if (isIsolatedEmoji || isThumb) {
    results.push({ name: display, status: "skip", reason: "última msg é emoji isolado sem contexto relevante" });
    continue;
  }

  console.log(`\n── ${display} (${hoursStr}h, ${row.lead_status})`);
  console.log(`   Última msg (${row.last_author}): "${(lastBody ?? "").slice(0, 100)}"`);

  try {
    const message = await composeRecoveryMessage(leadName, row.conv_id as string);
    if (!message) {
      results.push({ name: display, status: "skip", reason: "sem histórico suficiente" });
      console.log(`   → SKIP: sem histórico`);
      continue;
    }

    console.log(`   → MENSAGEM: "${message}"`);

    if (!DRY_RUN) {
      const channelAddress = resolveWhatsAppChannelAddress({
        phone: row.phone as string | null,
        whatsappLid: row.whatsapp_lid as string | null,
      });
      if (!channelAddress) {
        results.push({ name: display, status: "skip", reason: "sem endereço WhatsApp resolvível" });
        continue;
      }

      const msgId = await sendTextMessage(channelAddress, message, channelConfig);

      await db.insert(messages).values({
        id: randomUUID() as any,
        conversationId: row.conv_id as string,
        author: "agent",
        body: message,
        sentAt: now,
        externalId: msgId ?? null,
        intent: "reengagement" as any,
        deliveryFormat: "text",
      }).onConflictDoNothing();

      // Desbloqueia IA se estava pausada
      if (row.ai_paused) {
        await db
          .update(conversations)
          .set({ aiPaused: false, takeoverExpiresAt: null })
          .where(eq(conversations.id, row.conv_id as string));
      }

      // Marca que recebeu campanha para não duplicar
      await db.execute(`
        INSERT INTO follow_ups (id, clinic_id, lead_id, due_at, status, reason, completed_at, created_at, updated_at)
        VALUES (gen_random_uuid(), '${clinicId}', '${row.lead_id}', NOW(), 'done', 'recovery_campaign', NOW(), NOW(), NOW())
        ON CONFLICT DO NOTHING
      `);
    }

    results.push({ name: display, status: "ok", msg: message });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`   → ERRO: ${msg}`);
    results.push({ name: display, status: "error", reason: msg });
  }
}

// 5. Sumário
console.log("\n" + "=".repeat(70));
console.log("RESUMO");
const sent = results.filter((r) => r.status === "ok");
const skipped = results.filter((r) => r.status === "skip");
const errors = results.filter((r) => r.status === "error");
console.log(`Enviados${DRY_RUN ? " (dry-run)" : ""}: ${sent.length}`);
console.log(`Pulados: ${skipped.length}`);
if (errors.length) console.log(`Erros: ${errors.length}`);
skipped.forEach((r) => console.log(`  SKIP ${r.name}: ${r.reason}`));
