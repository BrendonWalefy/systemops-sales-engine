"use server";

import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/infrastructure/db/client";
import { organizations, conversations, leads, messages } from "@/infrastructure/db/schema";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import OpenAI from "openai";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { validateManualRecoveryRecipient } from "@/application/conversations/manual-recovery-policy";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";

export async function composeRecoveryMessageAction(
  convId: string,
): Promise<{ message: string | null; error?: string }> {
  const clinicId = await requireSessionClinicId();

  const clinic = await db.query.organizations.findFirst({ where: eq(organizations.id, clinicId) });
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

  // Esta chamada sempre gastou token e nunca foi registrada — o gasto de
  // composição da recuperação era invisível em `ai_usage_costs`, o que dava a
  // impressão de que a aba Recuperação não custa nada. Registrar aqui não muda
  // o custo, só o torna visível ao lado das demais operações.
  const usage = resp.usage;
  if (usage) {
    try {
      await new DefaultUsageCostTracker({
        usageCostRepository: new DrizzleUsageCostRepository(),
        idGenerator: () => randomUUID(),
        now: () => new Date(),
      }).trackAiUsage({
        clinicId,
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "follow_up_suggestion",
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
      });
    } catch (err) {
      // Contabilidade não pode derrubar a composição já paga.
      console.error("[Recovery] custo não registrado:", err);
    }
  }

  const message = resp.choices[0]?.message?.content?.trim() ?? null;
  return { message };
}

export async function sendRecoveryMessageAction(
  convId: string,
  message: string,
  operationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const clinicId = await requireSessionClinicId();

  if (!UUID_PATTERN.test(operationId)) {
    return { ok: false, error: "Identificador de envio inválido" };
  }

  const clinic = await db.query.organizations.findFirst({ where: eq(organizations.id, clinicId) });
  if (!clinic) return { ok: false, error: "Clínica não encontrada" };

  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, convId), eq(conversations.clinicId, clinicId)),
  });
  if (!conv) return { ok: false, error: "Conversa não encontrada" };

  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, conv.leadId),
  });
  if (!lead) return { ok: false, error: "Lead não encontrado" };

  // A action bloqueia cedo para feedback imediato; o sender repete o gate no
  // instante da entrega, cobrindo revogação ocorrida depois do clique.
  const recipientPolicy = validateManualRecoveryRecipient(lead);
  if (!recipientPolicy.ok) return recipientPolicy;

  const channelAddress = resolveWhatsAppChannelAddress({
    phone: lead.phone,
    whatsappLid: lead.whatsappLid,
  });
  if (!channelAddress) return { ok: false, error: "Sem endereço WhatsApp válido" };

  const now = new Date();
  const [inserted] = await db
    .insert(messages)
    .values({
      id: operationId,
      conversationId: convId,
      author: "agent",
      body: message,
      sentAt: now,
      externalId: null,
      intent: "reengagement" as const,
      deliveryFormat: null,
    })
    .onConflictDoNothing({ target: messages.id })
    .returning({ id: messages.id });
  if (!inserted) {
    const existing = await db.query.messages.findFirst({
      where: and(eq(messages.id, operationId), eq(messages.conversationId, convId)),
    });
    if (!existing || existing.body !== message) {
      return { ok: false, error: "Identificador de envio já utilizado" };
    }
  }
  bumpInboxVersion(clinicId);

  await enqueueOutboundMessage({
    clinicId,
    conversationId: convId,
    channel: "whatsapp",
    deliveryKind: "text",
    category: "recovery",
    dedupeKey: `manual-recovery:${operationId}`,
    payload: {
      version: 1,
      kind: "automation",
      to: channelAddress,
      text: message,
      leadId: lead.id,
      conversationId: convId,
      agentMessageId: operationId,
      useVoice: false,
    },
  }, {
    outboundMessageStore: new DrizzleOutboundMessageStore(),
    jobQueue: new DrizzleJobQueue(),
  });

  revalidatePath("/app/inbox");
  return { ok: true };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
