"use server";

import { AnalyzeSalesConversation } from "@/application/use-cases/agents/analyze-sales-conversation";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import type { Clinic } from "@/domain/entities/clinic";
import type { Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import type { SalesAgentRecommendation } from "@/domain/entities/agent-recommendation";
import { MockSalesAgentGateway } from "@/infrastructure/adapters/agents/mock-sales-agent-gateway";
import { InMemoryDemoStore } from "@/infrastructure/repositories/in-memory-demo-repositories";

export type DemoFlowResult = {
  lead: Lead;
  messages: Message[];
  recommendation: SalesAgentRecommendation;
  costs: {
    aiUsd: string;
    whatsappUsd: string;
    totalUsd: string;
    inputTokens: number;
    outputTokens: number;
  };
};

const demoClinic: Clinic = {
  id: "clinic-demo-sorriso",
  name: "Clinica Sorriso Demo",
  specialty: "odontology",
  city: "Sao Paulo",
  toneOfVoice: "Acolhedor, claro, profissional e sem pressionar o paciente.",
  commercialPolicy:
    "Nao informar preco fechado sem avaliacao. Conduzir para avaliacao e evitar descontos fora da politica da clinica.",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const playbook = `
Clinica odontologica focada em avaliacao consultiva.
Objetivo comercial: transformar conversas em avaliacoes agendadas.
Quando o lead perguntar preco, explicar que depende da avaliacao e conduzir para agenda.
Quando houver dor, inchaco, sangramento ou urgencia, acionar humano.
Tom: cuidadoso, objetivo e profissional.
`;

export async function runDemoFlow(input: {
  leadName: string;
  phone: string;
  message: string;
}): Promise<DemoFlowResult> {
  const store = new InMemoryDemoStore();
  let sequence = 0;
  const idGenerator = () => `demo-${++sequence}`;
  const now = () => new Date("2026-05-21T12:00:00.000Z");
  const usageCostTracker = new DefaultUsageCostTracker({
    usageCostRepository: store,
    idGenerator,
    now,
  });

  const registerIncomingMessage = new RegisterIncomingMessage({
    leadRepository: store,
    conversationRepository: store,
    usageCostTracker,
    idGenerator,
    now,
  });

  const analyzeSalesConversation = new AnalyzeSalesConversation({
    leadRepository: store,
    conversationRepository: store,
    agentRecommendationRepository: store,
    salesAgent: new MockSalesAgentGateway(),
    usageCostTracker,
    idGenerator,
    now,
  });

  const incoming = await registerIncomingMessage.execute({
    clinicId: demoClinic.id,
    message: {
      channel: "whatsapp",
      externalContactId: input.phone,
      externalThreadId: `whatsapp:${input.phone}`,
      externalMessageId: `wamid.demo.${Date.now()}`,
      name: input.leadName || null,
      phone: input.phone || null,
      email: null,
      body: input.message,
      receivedAt: now(),
      campaignId: "instagram-bio",
    },
  });

  const recommendation = await analyzeSalesConversation.execute({
    clinic: demoClinic,
    leadId: incoming.lead.id,
    playbook,
  });

  const messages = await store.listMessages(incoming.conversation.id);
  const aiUsage = store.aiUsageCosts.at(-1);
  const whatsappCost = store.whatsappMessageCosts.reduce(
    (total, cost) => total + cost.estimatedCostUsdMicros,
    0,
  );
  const aiCost = store.aiUsageCosts.reduce(
    (total, cost) => total + cost.estimatedCostUsdMicros,
    0,
  );

  return {
    lead: incoming.lead,
    messages,
    recommendation,
    costs: {
      aiUsd: formatUsdMicros(aiCost),
      whatsappUsd: formatUsdMicros(whatsappCost),
      totalUsd: formatUsdMicros(aiCost + whatsappCost),
      inputTokens: aiUsage?.inputTokens ?? 0,
      outputTokens: aiUsage?.outputTokens ?? 0,
    },
  };
}

function formatUsdMicros(value: number): string {
  return `$${(value / 1_000_000).toFixed(6)}`;
}

