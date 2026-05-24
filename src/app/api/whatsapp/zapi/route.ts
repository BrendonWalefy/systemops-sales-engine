import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { LlmSalesAgentGateway } from "@/infrastructure/adapters/agents/llm-sales-agent-gateway";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import type { Clinic } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { SalesAgentOutput } from "@/application/ports/sales-agent-gateway";
import type { Message } from "@/domain/entities/conversation";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null) as ZApiInboundPayload | null;
  if (!body) return new NextResponse("Bad Request", { status: 400 });

  // Ignore group messages, status replies, and messages sent by the bot itself
  if (body.isGroupMsg || body.isStatusReply || body.fromMe) {
    return new NextResponse("OK", { status: 200 });
  }

  // Ignore non-text messages
  if (!body.text?.message) {
    return new NextResponse("OK", { status: 200 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) {
    console.error("PILOT_CLINIC_ID is not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  try {
    // Check auto-reply toggle
    const clinicRow = await db.query.clinics.findFirst({
      where: eq(clinics.id, clinicId),
    });

    if (!clinicRow?.autoReplyEnabled) {
      return new NextResponse("OK", { status: 200 });
    }

    const leadRepo = new DrizzleLeadRepository();
    const conversationRepo = new DrizzleConversationRepository();
    const usageCostRepo = new DrizzleUsageCostRepository();
    const usageCostTracker = new DefaultUsageCostTracker({
      usageCostRepository: usageCostRepo,
      idGenerator: randomUUID,
      now: () => new Date(),
    });

    const { lead, conversation } = await new RegisterIncomingMessage({
      leadRepository: leadRepo,
      conversationRepository: conversationRepo,
      usageCostTracker,
      idGenerator: randomUUID,
      now: () => new Date(),
    }).execute({
      clinicId,
      message: {
        channel: "whatsapp",
        externalContactId: body.phone,
        externalThreadId: body.phone,
        externalMessageId: body.messageId,
        name: body.senderName || null,
        phone: body.phone,
        email: null,
        body: body.text.message,
        receivedAt: body.momment ? new Date(body.momment) : new Date(),
        campaignId: null,
      },
    });

    const history = await conversationRepo.listMessages(conversation.id);
    const clinic = buildClinicFromRow(clinicRow);
    const decision = await new LlmSalesAgentGateway().analyze({
      clinic,
      lead,
      conversation,
      messages: history,
      playbook: buildPlaybook(clinicRow.name),
    });

    const agentMessage: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      author: "agent",
      body: decision.suggestedReply,
      sentAt: new Date(),
      externalId: null,
    };
    await conversationRepo.appendMessage(agentMessage);
    await leadRepo.save(applyDecisionToLead(lead, decision));

    if (decision.usage) {
      await usageCostTracker.trackAiUsage({
        clinicId,
        provider: "openai",
        model: decision.model,
        operation: "sales_conversation_analysis",
        inputTokens: decision.usage.inputTokens,
        outputTokens: decision.usage.outputTokens,
      });
    }

    await sendTextMessage(body.phone, decision.suggestedReply);

    if (decision.handoffRequired) {
      await notifyHandoff({ phone: body.phone, lead, decision, clinicName: clinicRow.name });
    }

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("Z-API webhook error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

function buildClinicFromRow(row: typeof clinics.$inferSelect): Clinic {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    city: row.city,
    toneOfVoice: row.toneOfVoice,
    commercialPolicy: row.commercialPolicy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function applyDecisionToLead(lead: Lead, decision: SalesAgentOutput): Lead {
  return {
    ...lead,
    temperature: decision.leadTemperature,
    status: decision.stage === "ready_to_schedule" ? "appointment_scheduled" : "in_conversation",
    updatedAt: new Date(),
  };
}

async function notifyHandoff(params: {
  phone: string;
  lead: Lead;
  decision: SalesAgentOutput;
  clinicName: string;
}) {
  const receptionistPhone = process.env.RECEPTIONIST_PHONE_NUMBER;
  if (!receptionistPhone) return;

  const leadName = params.lead.name ?? "Lead sem nome";
  const preview = params.decision.suggestedReply.slice(0, 120);

  const text =
    `⚠️ *Handoff — ${params.clinicName}*\n\n` +
    `👤 ${leadName}\n📱 ${params.lead.phone ?? params.phone}\n` +
    `💬 "${preview}${params.decision.suggestedReply.length > 120 ? "…" : ""}"\n` +
    `📋 ${params.decision.nextAction}` +
    (params.decision.riskFlags.length > 0
      ? `\n⚠️ ${params.decision.riskFlags.join(", ")}`
      : "");

  await sendTextMessage(receptionistPhone, text).catch((err) => {
    console.error("Failed to send handoff notification:", err);
  });
}

function buildPlaybook(clinicName: string): string {
  return `
Clínica: ${clinicName}
Oferta principal: Avaliação gratuita com o dentista.
Especialidades: implantes, próteses, alinhadores, clareamento, harmonização orofacial.
Horário: segunda a sexta 8h–18h, sábado 8h–13h.

1. Acolher pelo nome, mencionar a clínica na primeira mensagem.
2. Entender o interesse ou dor do lead.
3. Redirecionar para avaliação gratuita como primeiro passo.
4. Oferecer até 3 horários disponíveis.
5. Confirmar agendamento e informar que a equipe vai confirmar.

Objeções: preço → avaliação gratuita primeiro. "Preciso pensar" → sem compromisso.
`.trim();
}
