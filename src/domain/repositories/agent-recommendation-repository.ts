import type { SalesAgentRecommendation } from "../entities/agent-recommendation";

export type HumanDecision = "accepted" | "edited" | "rejected";

export type AgentRecommendationRepository = {
  save(recommendation: SalesAgentRecommendation): Promise<void>;
  recordHumanDecision(input: {
    recommendationId: string;
    decision: HumanDecision;
    finalReply: string | null;
  }): Promise<void>;
};

