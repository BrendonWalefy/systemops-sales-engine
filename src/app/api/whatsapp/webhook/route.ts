import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { LlmSalesAgentGateway } from "@/infrastructure/adapters/agents/llm-sales-agent-gateway";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { sendWhatsAppTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-channel-adapter";
import type { Clinic } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { SalesAgentOutput } from "@/application/ports/sales-agent-gateway";
import type { Message } from "@/domain/entities/conversation";

// GET — Meta webhook verification
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// POST — incoming message from Meta Cloud API
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  if (!body) return new NextResponse("Bad Request", { status: 400 });

  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const messageObj = value?.messages?.[0];

  // Ignore non-text messages and status updates
  if (!messageObj || messageObj.type !== "text") {
    return new NextResponse("OK", { status: 200 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  const clinicName = process.env.PILOT_CLINIC_NAME ?? "a clínica";

  if (!clinicId) {
    console.error("PILOT_CLINIC_ID is not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const from: string = messageObj.from;
  const messageText: string = messageObj.text?.body ?? "";
  const messageId: string = messageObj.id;
  const contactName: string | null = value?.contacts?.[0]?.profile?.name ?? null;
  const receivedAt = new Date(Number(messageObj.timestamp) * 1000);

  try {
    const leadRepo = new DrizzleLeadRepository();
    const conversationRepo = new DrizzleConversationRepository();
    const usageCostRepo = new DrizzleUsageCostRepository();
    const usageCostTracker = new DefaultUsageCostTracker({
      usageCostRepository: usageCostRepo,
      idGenerator: randomUUID,
      now: () => new Date(),
    });

    const registerIncoming = new RegisterIncomingMessage({
      leadRepository: leadRepo,
      conversationRepository: conversationRepo,
      usageCostTracker,
      idGenerator: randomUUID,
      now: () => new Date(),
    });

    const { lead, conversation } = await registerIncoming.execute({
      clinicId,
      message: {
        channel: "whatsapp",
        externalContactId: from,
        externalThreadId: from,
        externalMessageId: messageId,
        name: contactName,
        phone: from,
        email: null,
        body: messageText,
        receivedAt,
        campaignId: null,
      },
    });

    const history = await conversationRepo.listMessages(conversation.id);

    const clinic = buildPilotClinic(clinicId, clinicName);
    const salesAgent = new LlmSalesAgentGateway();
    const decision = await salesAgent.analyze({
      clinic,
      lead,
      conversation,
      messages: history,
      playbook: PILOT_PLAYBOOK,
    });

    // Persist agent reply
    const agentMessage: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      author: "agent",
      body: decision.suggestedReply,
      sentAt: new Date(),
      externalId: null,
    };
    await conversationRepo.appendMessage(agentMessage);

    // Update lead from decision
    const updatedLead = applyDecisionToLead(lead, decision);
    await leadRepo.save(updatedLead);

    // Track costs
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
    await usageCostTracker.trackWhatsAppCost({
      clinicId,
      provider: "meta_cloud_api",
      providerMessageId: null,
      direction: "outbound",
      category: "service",
    });

    // Send reply
    await sendWhatsAppTextMessage(from, decision.suggestedReply);

    // Handoff notification
    if (decision.handoffRequired) {
      await notifyHandoff({ from, lead: updatedLead, decision, clinicName });
    }

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

function buildPilotClinic(id: string, name: string): Clinic {
  return {
    id,
    name,
    specialty: "odontologia",
    city: null,
    toneOfVoice: "Informal, acolhedor e consultivo. Nunca pressionar o lead.",
    commercialPolicy: "Oferecer sempre a avaliação gratuita como primeiro passo. Nunca informar valores por mensagem.",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function applyDecisionToLead(lead: Lead, decision: SalesAgentOutput): Lead {
  return {
    ...lead,
    temperature: decision.leadTemperature,
    status:
      decision.stage === "ready_to_schedule"
        ? "appointment_scheduled"
        : "in_conversation",
    updatedAt: new Date(),
  };
}

async function notifyHandoff(params: {
  from: string;
  lead: Lead;
  decision: SalesAgentOutput;
  clinicName: string;
}) {
  const receptionistPhone = process.env.RECEPTIONIST_PHONE_NUMBER;
  if (!receptionistPhone) return;

  const leadName = params.lead.name ?? "Lead sem nome";
  const leadPhone = params.lead.phone ?? params.from;
  const reply = params.decision.suggestedReply;
  const preview = reply.length > 120 ? `${reply.slice(0, 120)}…` : reply;

  const text =
    `⚠️ *Handoff solicitado — ${params.clinicName}*\n\n` +
    `👤 Lead: ${leadName}\n` +
    `📱 Telefone: ${leadPhone}\n` +
    `💬 Último contato: "${preview}"\n` +
    `📋 Motivo: ${params.decision.nextAction}\n` +
    (params.decision.riskFlags.length > 0
      ? `⚠️ Flags: ${params.decision.riskFlags.join(", ")}\n`
      : "") +
    `\nAcesse o admin para responder.`;

  await sendWhatsAppTextMessage(receptionistPhone, text).catch((err) => {
    console.error("Failed to send handoff notification:", err);
  });
}

const PILOT_PLAYBOOK = `
Clínica Ximendes Odontologia — Playbook do piloto

Oferta principal: Avaliação gratuita com o Dr. Ximendes.
Especialidades principais: implantes, próteses, alinhadores, clareamento, harmonização orofacial.
Horário de atendimento: segunda a sexta, 8h às 18h. Sábado 8h às 13h.
Número para agendamento: WhatsApp desta conversa.

Abordagem recomendada:
1. Acolher o lead pelo nome e mencionar a clínica na primeira mensagem.
2. Entender rapidamente o interesse/dor do lead.
3. Redirecionar para a avaliação gratuita como "o melhor primeiro passo".
4. Oferecer horários disponíveis (máximo 3 opções).
5. Confirmar o agendamento e informar que a equipe vai confirmar os dados.

Objeções comuns:
- "Quanto custa?" → "O valor varia conforme a avaliação. A consulta é gratuita e o Dr. Ximendes vai te orientar pessoalmente."
- "Fica longe?" → Confirmar endereço e facilidade de acesso.
- "Preciso pensar" → Reforçar que a avaliação é gratuita e sem compromisso.
`.trim();
