import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { LlmSalesAgentGateway } from "@/infrastructure/adapters/agents/llm-sales-agent-gateway";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { db } from "@/infrastructure/db/client";
import { clinics, messages } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import type { Clinic } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { SalesAgentOutput } from "@/application/ports/sales-agent-gateway";
import type { Message } from "@/domain/entities/conversation";
import type { CalendarSlot } from "@/domain/entities/calendar-slot";

// System message marker for pending slot offers
const SLOT_OFFER_MARKER = "__calendar_slots__:";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as ZApiInboundPayload | null;
  if (!body) return new NextResponse("Bad Request", { status: 400 });

  if (body.isGroupMsg || body.isStatusReply || body.fromMe) {
    return new NextResponse("OK", { status: 200 });
  }

  if (!body.text?.message) {
    return new NextResponse("OK", { status: 200 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) {
    console.error("PILOT_CLINIC_ID is not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  // Idempotency: skip if this messageId was already processed
  const alreadyProcessed = await db.query.messages.findFirst({
    where: eq(messages.externalId, body.messageId),
  });
  if (alreadyProcessed) {
    return new NextResponse("OK", { status: 200 });
  }

  try {
    const clinicRow = await fetchClinicSafe(clinicId);

    if (!clinicRow) {
      console.error("Clinic not found for id:", clinicId);
      return new NextResponse("Server misconfigured", { status: 500 });
    }

    const leadRepo = new DrizzleLeadRepository();
    const conversationRepo = new DrizzleConversationRepository();
    const usageCostRepo = new DrizzleUsageCostRepository();
    const appointmentRepo = new DrizzleAppointmentRepository();
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

    if (!clinicRow.autoReplyEnabled) {
      return new NextResponse("OK", { status: 200 });
    }

    const incomingText = body.text.message.trim();

    // --- Slot selection flow ---
    // If lead has appointment_scheduled status and sends "1", "2", or "3"
    if (lead.status === "appointment_scheduled" && /^[123]$/.test(incomingText)) {
      const handled = await handleSlotSelection({
        phone: body.phone,
        choice: parseInt(incomingText, 10) as 1 | 2 | 3,
        lead,
        conversationId: conversation.id,
        clinicId,
        conversationRepo,
        appointmentRepo,
        calendarId: clinicRow.googleCalendarId,
      });
      if (handled) return new NextResponse("OK", { status: 200 });
    }

    // --- Normal AI flow ---
    const history = await conversationRepo.listMessages(conversation.id);
    const clinic = buildClinicFromRow(clinicRow);
    const decision = await new LlmSalesAgentGateway().analyze({
      clinic,
      lead,
      conversation,
      messages: history,
      playbook: clinicRow.playbook ?? "",
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

    // --- Slot offer flow ---
    if (decision.stage === "ready_to_schedule") {
      await handleSlotOffer({
        phone: body.phone,
        lead,
        conversationId: conversation.id,
        clinicId,
        agentReply: decision.suggestedReply,
        conversationRepo,
        calendarId: clinicRow.googleCalendarId,
      });
    } else {
      await sendTextMessage(body.phone, decision.suggestedReply);
    }

    if (decision.handoffRequired) {
      await notifyHandoff({ phone: body.phone, lead, decision, clinicName: clinicRow.name });
    }

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("Z-API webhook error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

// Fetch slots and send options to lead
async function handleSlotOffer(params: {
  phone: string;
  lead: Lead;
  conversationId: string;
  clinicId: string;
  agentReply: string;
  conversationRepo: DrizzleConversationRepository;
  calendarId: string | null;
}) {
  const { phone, lead, conversationId, clinicId, agentReply, conversationRepo, calendarId } =
    params;

  const calendar = new GoogleCalendarGateway(calendarId);
  const now = new Date();
  const to = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // next 5 days

  let slots: CalendarSlot[] = [];
  try {
    slots = await calendar.listAvailableSlots({ clinicId, from: now, to });
  } catch (err) {
    console.error("Failed to fetch calendar slots:", err);
    // Fall back to just sending the IA reply without slot options
    await sendTextMessage(phone, agentReply);
    return;
  }

  const top3 = slots.slice(0, 3);
  if (top3.length === 0) {
    await sendTextMessage(phone, agentReply);
    return;
  }

  // Send IA reply first, then slot options
  await sendTextMessage(phone, agentReply);

  const options = top3.map((s, i) => `${i + 1}. ${formatSlot(s.startsAt)}`).join("\n");
  const slotsMessage =
    `Tenho os seguintes horários disponíveis para você:\n\n${options}\n\n` +
    `Responda com *1*, *2* ou *3* para confirmar o horário de sua preferência. 😊`;

  await sendTextMessage(phone, slotsMessage);

  // Persist slot offer as a system message so we can recover it on the next interaction
  const systemMsg: Message = {
    id: randomUUID(),
    conversationId,
    author: "system",
    body:
      SLOT_OFFER_MARKER +
      JSON.stringify(
        top3.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
      ),
    sentAt: new Date(),
    externalId: null,
  };
  await conversationRepo.appendMessage(systemMsg);

  const agentSlotsMsg: Message = {
    id: randomUUID(),
    conversationId,
    author: "agent",
    body: slotsMessage,
    sentAt: new Date(),
    externalId: null,
  };
  await conversationRepo.appendMessage(agentSlotsMsg);
}

// Confirm slot choice, create calendar event and appointment
async function handleSlotSelection(params: {
  phone: string;
  choice: 1 | 2 | 3;
  lead: Lead;
  conversationId: string;
  clinicId: string;
  conversationRepo: DrizzleConversationRepository;
  appointmentRepo: DrizzleAppointmentRepository;
  calendarId: string | null;
}): Promise<boolean> {
  const { phone, choice, lead, conversationId, clinicId, conversationRepo, appointmentRepo, calendarId } =
    params;

  const history = await conversationRepo.listMessages(conversationId);
  // Find the last system message containing slot data
  const slotMessage = [...history]
    .reverse()
    .find((m) => m.author === "system" && m.body.startsWith(SLOT_OFFER_MARKER));

  if (!slotMessage) return false;

  type SlotData = { startsAt: string; endsAt: string };
  let slotData: SlotData[];
  try {
    slotData = JSON.parse(slotMessage.body.slice(SLOT_OFFER_MARKER.length)) as SlotData[];
  } catch {
    return false;
  }

  const selected = slotData[choice - 1];
  if (!selected) return false;

  const startsAt = new Date(selected.startsAt);
  const endsAt = new Date(selected.endsAt);
  const title = `${lead.name ?? "Lead"} — Avaliação`;

  const calendar = new GoogleCalendarGateway(calendarId);
  let appointment;
  try {
    appointment = await calendar.createAppointment({
      clinicId,
      leadId: lead.id,
      startsAt,
      endsAt,
      title,
    });
  } catch (err) {
    console.error("Failed to create calendar event:", err);
    await sendTextMessage(
      phone,
      "Desculpe, tive um problema ao confirmar o horário. Nossa equipe entrará em contato em breve. 🙏",
    );
    return true;
  }

  await appointmentRepo.save(appointment);

  const confirmation =
    `✅ Perfeito! Seu agendamento está confirmado:\n\n` +
    `📅 ${formatSlot(startsAt)}\n\n` +
    `Qualquer dúvida, é só chamar! Até lá. 😊`;

  await sendTextMessage(phone, confirmation);

  const agentConfirmMsg: Message = {
    id: randomUUID(),
    conversationId,
    author: "agent",
    body: confirmation,
    sentAt: new Date(),
    externalId: null,
  };
  await conversationRepo.appendMessage(agentConfirmMsg);

  return true;
}

function formatSlot(date: Date): string {
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const dow = weekdays[date.getDay()] ?? "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${dow} ${day}/${month} às ${hour}h`;
}

type ClinicRow = Omit<typeof clinics.$inferSelect, "googleCalendarId"> & {
  googleCalendarId: string | null;
};

async function fetchClinicSafe(clinicId: string): Promise<ClinicRow | undefined> {
  try {
    return await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  } catch {
    // Fallback: explicit columns excluding google_calendar_id (migration 0003 may not be applied)
    const [row] = await db
      .select({
        id: clinics.id,
        name: clinics.name,
        specialty: clinics.specialty,
        city: clinics.city,
        toneOfVoice: clinics.toneOfVoice,
        commercialPolicy: clinics.commercialPolicy,
        playbook: clinics.playbook,
        businessHours: clinics.businessHours,
        autoReplyEnabled: clinics.autoReplyEnabled,
        createdAt: clinics.createdAt,
        updatedAt: clinics.updatedAt,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
    if (!row) return undefined;
    return { ...row, googleCalendarId: null };
  }
}

function buildClinicFromRow(row: ClinicRow): Clinic {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    city: row.city,
    toneOfVoice: row.toneOfVoice,
    commercialPolicy: row.commercialPolicy,
    playbook: row.playbook,
    businessHours: row.businessHours,
    googleCalendarId: row.googleCalendarId,
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
