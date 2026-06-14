"use server";

import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import OpenAI from "openai";

export async function composeRecoveryMessageAction(
  convId: string,
): Promise<{ message: string | null; error?: string }> {
  const clinicId = await requireSessionClinicId();

  const clinic = await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  if (!clinic) return { message: null, error: "Clínica não encontrada" };

  const editorial = await resolveActiveEditorialConfig(clinicId);
  const receptionistName = inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? "Marina";
  const specialty = editorial?.specialty ?? clinic.specialty ?? "nosso serviço";

  const history = await db.execute(sql`
    SELECT author, body, sent_at
    FROM messages
    WHERE conversation_id = ${convId}
      AND author IN ('lead', 'agent', 'clinic_user')
    ORDER BY sent_at DESC
    LIMIT 20
  `);

  const recentMsgs = (
    history.rows as Array<{ author: string; body: string; sent_at: Date }>
  ).reverse();

  if (recentMsgs.length === 0) return { message: null, error: "Sem histórico suficiente" };

  const historyText = recentMsgs
    .map((m) => `${m.author === "lead" ? "LEAD" : "CLÍNICA"}: ${(m.body ?? "").slice(0, 200)}`)
    .join("\n");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Você é ${receptionistName}, recepcionista virtual da ${clinic.name}, especializada em ${specialty}.

HISTÓRICO DA CONVERSA:
${historyText}

CONTEXTO: Esta conversa ficou sem resposta por um tempo. O lead NÃO deve saber disso.

Escreva UMA mensagem curta e calorosa de retomada de conversa. Regras:
- Máximo 3 frases
- Mencione especificamente o que o lead perguntou ou demonstrou interesse
- NÃO mencione falha, demora ou problema técnico
- NÃO prometa agendamento, não confirme horários
- Seja natural, como continuação orgânica da conversa
- Tom: caloroso, profissional, conciso
- Se o lead pediu preço e não recebeu resposta, mencione que pode ajudar com os valores

Responda APENAS com o texto da mensagem, sem aspas.`,
      },
    ],
  });

  const message = resp.choices[0]?.message?.content?.trim() ?? null;
  return { message };
}

export async function sendRecoveryMessageAction(
  convId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const clinicId = await requireSessionClinicId();

  const clinic = await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  if (!clinic) return { ok: false, error: "Clínica não encontrada" };

  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, convId),
  });
  if (!conv) return { ok: false, error: "Conversa não encontrada" };

  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, conv.leadId),
  });
  if (!lead) return { ok: false, error: "Lead não encontrado" };

  const channelAddress = resolveWhatsAppChannelAddress({
    phone: lead.phone,
    whatsappLid: lead.whatsappLid,
  });
  if (!channelAddress) return { ok: false, error: "Sem endereço WhatsApp válido" };

  const channelConfig = resolveChannelConfig(clinic);
  const now = new Date();

  try {
    const msgId = await sendTextMessage(channelAddress, message, channelConfig);

    await db.insert(messages).values({
      id: randomUUID(),
      conversationId: convId,
      author: "agent",
      body: message,
      sentAt: now,
      externalId: msgId ?? null,
      intent: "reengagement" as const,
      deliveryFormat: "text",
    }).onConflictDoNothing();

    if (conv.aiPaused) {
      await db
        .update(conversations)
        .set({ aiPaused: false, takeoverExpiresAt: null, updatedAt: now })
        .where(eq(conversations.id, convId));
    }

    // Idempotência: próxima execução do cron ignora esse lead por 24h
    await db.execute(sql`
      INSERT INTO follow_ups (id, clinic_id, lead_id, due_at, status, reason, completed_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${clinicId}, ${lead.id}, NOW(), 'done', 'recovery_campaign', NOW(), NOW(), NOW())
      ON CONFLICT DO NOTHING
    `);

    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
