"use server";

import type { Message } from "@/domain/entities/conversation";
import { IntentClassifier } from "@/core/intelligence/IntentClassifier";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { estimateAiCostUsdMicros } from "@/application/services/cost-estimator";

const DEMO_CLINIC = {
  name: "Clínica Sorriso Premium",
  plan: "essencial" as const,
  specialty: "odontologia",
  toneOfVoice: "Informal, acolhedor e consultivo.",
  playbook: "Oferecer sempre a avaliação gratuita como primeiro passo.",
  commercialPolicy: "Nunca informar valores por mensagem. Redirecionar para avaliação gratuita.",
};

// Slots simulados para o demo (próximos dias úteis)
function generateDemoSlots() {
  const now = new Date();
  const slots = [];
  let day = new Date(now);
  day.setHours(10, 0, 0, 0);

  while (slots.length < 3) {
    day = new Date(day.getTime() + 24 * 60 * 60_000);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;

    const tz = new ClinicTimezone("America/Sao_Paulo");
    slots.push({
      index: slots.length + 1,
      startsAt: day.toISOString(),
      endsAt: new Date(day.getTime() + 60 * 60_000).toISOString(),
      label: tz.formatForHuman(day),
    });
  }
  return slots;
}

export type DemoConversationInput = {
  leadName: string;
  phone: string;
  clinicName?: string;
  simulatedHour?: number;
  messages: Array<{
    author: "lead" | "agent";
    body: string;
  }>;
};

export type AutonomousDemoResult = {
  lead: {
    name: string;
    phone: string;
    channel: "whatsapp";
    status: "waiting_response" | "in_conversation" | "appointment_scheduled" | "handoff_required";
  };
  messages: Array<{
    author: "lead" | "agent";
    body: string;
  }>;
  decision: {
    message: string;
    intent: string;
    action: string;
    handoffRequired: boolean;
    appointment: { status: string };
    leadTemperature: "cold" | "warm" | "hot";
    stage: string;
    followUp: string | null;
    reason: string | null;
  };
  costs: {
    aiUsd: string;
    whatsappUsd: string;
    totalUsd: string;
    inputTokens: number;
    outputTokens: number;
  };
};

export async function runAutonomousReceptionistTurn(
  input: DemoConversationInput,
): Promise<AutonomousDemoResult> {
  const classifier = new IntentClassifier();
  const composer = new ResponseComposer();
  const timezone = new ClinicTimezone("America/Sao_Paulo");

  const domainMessages = input.messages.map<Message>((m, i) => ({
    id: `demo-msg-${i}`,
    conversationId: "demo-conversation",
    author: m.author === "lead" ? "lead" : "agent",
    body: m.body,
    sentAt: new Date(),
    externalId: null,
  }));

  const latestLeadMsg = [...domainMessages].reverse().find((m) => m.author === "lead");
  const latestText = latestLeadMsg?.body ?? input.messages[input.messages.length - 1]?.body ?? "";

  const demoSlots = generateDemoSlots();
  const hasPendingOffer = domainMessages.some(
    (m) => m.author === "agent" && /opção 1|opção 2|opção 3/i.test(m.body),
  );

  const classification = await classifier.classify(latestText, domainMessages, hasPendingOffer);

  let actionResult: Parameters<ResponseComposer["compose"]>[0]["actionResult"];
  let appointmentStatus = "none";
  let handoffRequired = false;

  switch (classification.intent) {
    case "confirm_slot": {
      const choice = classification.slotPreference.slotChoice ?? 1;
      const slot = demoSlots.find((s) => s.index === choice) ?? demoSlots[0];
      if (slot) {
        actionResult = { type: "appointment_confirmed", slot, clinicName: input.clinicName ?? DEMO_CLINIC.name };
        appointmentStatus = "scheduled";
      } else {
        actionResult = { type: "slots_found", slots: demoSlots, askedForPreference: false };
      }
      break;
    }
    case "check_availability":
    case "book_appointment":
      actionResult = { type: "slots_found", slots: demoSlots, askedForPreference: false };
      break;
    case "price_inquiry":
      actionResult = { type: "price_inquiry" };
      break;
    case "clinical_urgency":
      actionResult = { type: "clinical_urgency" };
      handoffRequired = true;
      break;
    case "greeting":
      actionResult = { type: "greeting" };
      break;
    case "unclear":
      actionResult = {
        type: "clarification_needed",
        question: classification.clarificationQuestion ?? "Como posso te ajudar?",
      };
      break;
    default:
      actionResult = {
        type: "general_question",
        clinicContext: `${input.clinicName ?? DEMO_CLINIC.name} — ${DEMO_CLINIC.specialty}`,
      };
  }

  const clinic = { ...DEMO_CLINIC, name: input.clinicName ?? DEMO_CLINIC.name };
  const composed = await composer.compose({
    actionResult,
    conversationHistory: domainMessages,
    clinic,
    leadName: input.leadName,
    timezone,
    isFirstMessage: domainMessages.filter((m) => m.author === "agent").length === 0,
  });

  const aiCost = estimateAiCostUsdMicros({
    clinicId: "demo",
    provider: "openai",
    model: composed.model,
    operation: "sales_conversation_analysis",
    inputTokens: composed.inputTokens,
    outputTokens: composed.outputTokens,
  });

  return {
    lead: {
      name: input.leadName,
      phone: input.phone,
      channel: "whatsapp",
      status: handoffRequired
        ? "handoff_required"
        : appointmentStatus === "scheduled"
          ? "appointment_scheduled"
          : "in_conversation",
    },
    messages: [...input.messages, { author: "agent", body: composed.text }],
    decision: {
      message: composed.text,
      intent: classification.intent,
      action: actionResult.type,
      handoffRequired,
      appointment: { status: appointmentStatus },
      leadTemperature: handoffRequired ? "cold" : appointmentStatus === "scheduled" ? "hot" : "warm",
      stage: classification.intent,
      followUp: null,
      reason: null,
    },
    costs: {
      aiUsd: formatUsdMicros(aiCost),
      whatsappUsd: "$0.000000",
      totalUsd: formatUsdMicros(aiCost),
      inputTokens: composed.inputTokens,
      outputTokens: composed.outputTokens,
    },
  };
}

function formatUsdMicros(value: number): string {
  return `$${(value / 1_000_000).toFixed(6)}`;
}
