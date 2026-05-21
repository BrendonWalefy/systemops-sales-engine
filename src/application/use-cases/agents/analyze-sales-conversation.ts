import type { SalesAgentGateway } from "@/application/ports/sales-agent-gateway";
import type { UsageCostTracker } from "@/application/ports/usage-cost-tracker";
import type { SalesAgentRecommendation } from "@/domain/entities/agent-recommendation";
import type { Clinic } from "@/domain/entities/clinic";
import type { AgentRecommendationRepository } from "@/domain/repositories/agent-recommendation-repository";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";

export type AnalyzeSalesConversationDependencies = {
  leadRepository: LeadRepository;
  conversationRepository: ConversationRepository;
  agentRecommendationRepository: AgentRecommendationRepository;
  salesAgent: SalesAgentGateway;
  usageCostTracker: UsageCostTracker;
  idGenerator: () => string;
  now: () => Date;
};

export class AnalyzeSalesConversation {
  constructor(private readonly deps: AnalyzeSalesConversationDependencies) {}

  async execute(input: {
    clinic: Clinic;
    leadId: string;
    playbook: string;
  }) {
    const lead = await this.deps.leadRepository.findById(input.leadId);
    if (!lead) {
      throw new Error("Lead not found");
    }

    const conversation = await this.deps.conversationRepository.findByLeadId(lead.id);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const messages = await this.deps.conversationRepository.listMessages(conversation.id);

    const output = await this.deps.salesAgent.analyze({
      clinic: input.clinic,
      lead,
      conversation,
      messages,
      playbook: input.playbook,
    });

    const recommendation: SalesAgentRecommendation = {
      id: this.deps.idGenerator(),
      clinicId: input.clinic.id,
      leadId: lead.id,
      conversationId: conversation.id,
      leadTemperature: output.leadTemperature,
      stage: output.stage,
      mainObjection: output.mainObjection,
      suggestedReply: output.suggestedReply,
      nextAction: output.nextAction,
      followUp: output.followUp,
      handoffRequired: output.handoffRequired,
      riskFlags: output.riskFlags,
      confidence: output.confidence,
      model: output.model,
      promptVersion: output.promptVersion,
      createdAt: this.deps.now(),
    };

    await this.deps.agentRecommendationRepository.save(recommendation);

    if (output.usage) {
      await this.deps.usageCostTracker.trackAiUsage({
        clinicId: input.clinic.id,
        provider: "openai",
        model: output.model,
        operation: "sales_conversation_analysis",
        inputTokens: output.usage.inputTokens,
        outputTokens: output.usage.outputTokens,
      });
    }

    return recommendation;
  }
}
