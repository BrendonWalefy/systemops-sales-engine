import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, messages } from "@/infrastructure/db/schema";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type UnattendedLead = {
  lead_id: string;
  name: string | null;
  phone: string | null;
  whatsapp_lid: string | null;
  lead_status: string;
  conv_id: string;
  ai_paused: boolean;
  hours_silent: number;
  last_author: string | null;
  last_body: string | null;
};

type ClinicResult = {
  clinicId: string;
  sent: number;
  skipped: number;
  failed: number;
};

async function findUnattendedLeads(clinicId: string): Promise<UnattendedLead[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT
      l.id                                                                      AS lead_id,
      l.name,
      l.phone,
      l.whatsapp_lid,
      l.status                                                                  AS lead_status,
      c.id                                                                      AS conv_id,
      c.ai_paused,
      c.takeover_expires_at,
      EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 3600                   AS hours_silent,
      (SELECT m2.author FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.sent_at DESC LIMIT 1) AS last_author,
      (SELECT m2.body   FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.sent_at DESC LIMIT 1) AS last_body
    FROM leads l
    JOIN conversations c ON c.lead_id = l.id
    WHERE l.clinic_id = ${clinicId}
      AND l.status NOT IN ('lost', 'won', 'appointment_scheduled')
      AND (l.phone IS NOT NULL OR l.whatsapp_lid IS NOT NULL)
      AND (
        -- Takeover expirado: IA foi pausada pelo humano e o prazo passou
        (c.ai_paused = true AND c.takeover_expires_at IS NOT NULL AND c.takeover_expires_at < NOW())
        OR
        -- IA ativa mas lead esperando há mais de 2h sem resposta do agente
        (c.ai_paused = false
          AND c.last_message_at < NOW() - INTERVAL '2 hours'
          AND (SELECT m2.author FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.sent_at DESC LIMIT 1) = 'lead')
      )
      -- Não reenviar para quem já recebeu campanha de recuperação
      AND NOT EXISTS (
        SELECT 1 FROM follow_ups f
        WHERE f.lead_id = l.id
          AND f.reason = 'recovery_campaign'
          AND f.status IN ('pending', 'done')
          AND f.created_at > NOW() - INTERVAL '24 hours'
      )
    ORDER BY hours_silent ASC
  `);

  return result.rows as UnattendedLead[];
}

async function composeRecoveryMessage(
  openai: OpenAI,
  receptionistName: string,
  clinicName: string,
  specialty: string,
  treatmentNames: string[],
  leadName: string | null,
  convId: string,
): Promise<string | null> {
  const history = await db.execute(sql`
    SELECT author, body, sent_at
    FROM messages
    WHERE conversation_id = ${convId}
      AND author IN ('lead', 'agent', 'clinic_user')
    ORDER BY sent_at DESC
    LIMIT 20
  `);

  const recentMsgs = (history.rows as Array<{ author: string; body: string; sent_at: Date }>).reverse();
  if (recentMsgs.length === 0) return null;

  const historyText = recentMsgs
    .map((m) => `${m.author === "lead" ? "LEAD" : "CLÍNICA"}: ${(m.body ?? "").slice(0, 200)}`)
    .join("\n");

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Você é ${receptionistName}, recepcionista virtual da ${clinicName}, especializada em ${specialty}.
${treatmentNames.length > 0 ? `\nPROCEDIMENTOS DA CLÍNICA (use EXATAMENTE esses nomes, nunca invente variações): ${treatmentNames.join(", ")}.\n` : ""}
HISTÓRICO DA CONVERSA:
${historyText}

CONTEXTO: Esta conversa ficou sem resposta por um tempo. O lead NÃO deve saber disso.

Escreva UMA mensagem curta e calorosa de retomada de conversa. Regras:
- Máximo 3 frases
- Mencione especificamente o que o lead perguntou ou demonstrou interesse
- NÃO mencione que houve falha, demora ou problema técnico
- NÃO prometa agendamento, não confirme horários, não liste datas ou horários disponíveis
- Seja natural, como se fosse uma continuação orgânica
- Use o nome ${leadName ?? "do lead"} se disponível
- Tom: caloroso, profissional, conciso
- Se o lead pediu preço e não recebeu resposta, mencione que pode ajudar com os valores
- Use APENAS os nomes exatos dos procedimentos listados acima — nunca "lentes de contato dental", "facetas de contato" ou variações não cadastradas

Responda APENAS com o texto da mensagem, sem aspas.`,
      },
    ],
  });

  return resp.choices[0]?.message?.content?.trim() ?? null;
}

function shouldSkip(lead: UnattendedLead): string | null {
  if (!lead.phone && !lead.whatsapp_lid) return "sem telefone";

  const lastBodyTrim = (lead.last_body ?? "").trim();
  const isIsolatedEmoji = /^[\p{Emoji}\s]+$/u.test(lastBodyTrim) && lastBodyTrim.length < 10;
  if (isIsolatedEmoji) return "última msg é emoji isolado";

  return null;
}

async function processClinic(clinicId: string, openai: OpenAI): Promise<ClinicResult> {
  const clinic = await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  if (!clinic) return { clinicId, sent: 0, skipped: 0, failed: 0 };

  if (!shouldSendAutomatedClinicOutbound(clinic)) {
    console.log(`[RecoveryCampaign] outbound pausado para clinic=${clinicId}`);
    return { clinicId, sent: 0, skipped: 0, failed: 0 };
  }

  const editorial = await resolveActiveEditorialConfig(clinicId);
  const channelConfig = resolveChannelConfig(clinic);
  const receptionistName = inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? "Marina";
  const specialty = editorial?.specialty ?? clinic.specialty ?? "odontologia estética";
  const treatmentNames = (editorial?.procedures ?? []).map((p) => p.name);
  const now = new Date();

  const unattended = await findUnattendedLeads(clinicId);
  console.log(`[RecoveryCampaign] clinic=${clinicId} elegíveis=${unattended.length}`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const lead of unattended) {
    const skipReason = shouldSkip(lead);
    if (skipReason) {
      console.log(`[RecoveryCampaign] SKIP lead=${lead.lead_id} motivo="${skipReason}"`);
      skipped++;
      continue;
    }

    const channelAddress = resolveWhatsAppChannelAddress({
      phone: lead.phone,
      whatsappLid: lead.whatsapp_lid,
    });
    if (!channelAddress) {
      skipped++;
      continue;
    }

    try {
      const message = await composeRecoveryMessage(
        openai,
        receptionistName,
        clinic.name,
        specialty,
        treatmentNames,
        lead.name,
        lead.conv_id,
      );

      if (!message) {
        console.log(`[RecoveryCampaign] SKIP lead=${lead.lead_id} motivo="sem histórico"`);
        skipped++;
        continue;
      }

      const msgId = await sendTextMessage(channelAddress, message, channelConfig);

      await db.insert(messages).values({
        id: randomUUID(),
        conversationId: lead.conv_id,
        author: "agent",
        body: message,
        sentAt: now,
        externalId: msgId ?? null,
        intent: "reengagement" as const,
        deliveryFormat: "text",
      }).onConflictDoNothing();

      if (lead.ai_paused) {
        await db
          .update(conversations)
          .set({ aiPaused: false, takeoverExpiresAt: null })
          .where(eq(conversations.id, lead.conv_id));
      }

      // Registra no follow_ups para garantir idempotência: próxima execução ignora esse lead por 24h
      await db.execute(sql`
        INSERT INTO follow_ups (id, clinic_id, lead_id, due_at, status, reason, completed_at, created_at, updated_at)
        VALUES (gen_random_uuid(), ${clinicId}, ${lead.lead_id}, NOW(), 'done', 'recovery_campaign', NOW(), NOW(), NOW())
        ON CONFLICT DO NOTHING
      `);

      console.log(`[RecoveryCampaign] SENT lead=${lead.lead_id} name="${lead.name}" hours=${Number(lead.hours_silent).toFixed(0)}h`);
      sent++;
    } catch (err: unknown) {
      console.error(`[RecoveryCampaign] ERRO lead=${lead.lead_id}:`, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  return { clinicId, sent, skipped, failed };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const clinicIds = await listAllClinicIds();
  const results: ClinicResult[] = [];

  for (const id of clinicIds) {
    const r = await processClinic(id, openai);
    results.push(r);
  }

  const totals = results.reduce(
    (acc, r) => ({ sent: acc.sent + r.sent, skipped: acc.skipped + r.skipped, failed: acc.failed + r.failed }),
    { sent: 0, skipped: 0, failed: 0 },
  );

  console.log(`[RecoveryCampaign] clinics=${results.length} sent=${totals.sent} skipped=${totals.skipped} failed=${totals.failed}`);
  return NextResponse.json({ clinics: results.length, ...totals, perClinic: results });
}
