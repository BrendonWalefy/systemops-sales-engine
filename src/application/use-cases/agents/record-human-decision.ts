import type {
  AgentRecommendationRepository,
  HumanDecision,
} from "@/domain/repositories/agent-recommendation-repository";

export type RecordHumanDecisionDependencies = {
  agentRecommendationRepository: AgentRecommendationRepository;
};

export class RecordHumanDecision {
  constructor(private readonly deps: RecordHumanDecisionDependencies) {}

  async execute(input: {
    recommendationId: string;
    decision: HumanDecision;
    finalReply: string | null;
  }): Promise<void> {
    await this.deps.agentRecommendationRepository.recordHumanDecision(input);
  }
}

