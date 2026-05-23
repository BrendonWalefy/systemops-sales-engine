"use server";

import type { Message } from "@/domain/entities/conversation";
import {
  decideAutonomousReceptionistReply,
  estimateReceptionistUsage,
  type ReceptionistDecision,
} from "@/application/services/autonomous-receptionist";
import { estimateAiCostUsdMicros } from "@/application/services/cost-estimator";

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
    status:
      | "waiting_response"
      | "in_conversation"
      | "appointment_scheduled"
      | "handoff_required";
  };
  messages: Array<{
    author: "lead" | "agent";
    body: string;
  }>;
  decision: ReceptionistDecision;
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
  const hour = input.simulatedHour ?? 10;
  const now = new Date(`2026-05-22T${String(hour).padStart(2, "0")}:00:00`);
  const domainMessages = input.messages.map<Message>((message, index) => ({
    id: `message-${index + 1}`,
    conversationId: "demo-conversation",
    author: message.author === "lead" ? "lead" : "agent",
    body: message.body,
    sentAt: now,
    externalId: null,
  }));

  const decision = decideAutonomousReceptionistReply(domainMessages, {
    leadName: input.leadName,
    clinicName: input.clinicName,
    now,
  });
  const usage = estimateReceptionistUsage(domainMessages, decision.message);
  const aiCost = estimateAiCostUsdMicros({
    clinicId: "clinic-demo-sorriso",
    provider: "openai",
    model: "gpt-4o-mini",
    operation: "sales_conversation_analysis",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  const whatsappCost = decision.action === "send_message" || decision.action === "offer_slots"
    ? 0
    : 0;

  return {
    lead: {
      name: input.leadName,
      phone: input.phone,
      channel: "whatsapp",
      status: decision.handoffRequired
        ? "handoff_required"
        : decision.appointment.status === "scheduled"
          ? "appointment_scheduled"
          : "in_conversation",
    },
    messages: [...input.messages, { author: "agent", body: decision.message }],
    decision,
    costs: {
      aiUsd: formatUsdMicros(aiCost),
      whatsappUsd: formatUsdMicros(whatsappCost),
      totalUsd: formatUsdMicros(aiCost + whatsappCost),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  };
}

function formatUsdMicros(value: number): string {
  return `$${(value / 1_000_000).toFixed(6)}`;
}
