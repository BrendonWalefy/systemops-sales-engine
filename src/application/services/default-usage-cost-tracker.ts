import type { UsageCostTracker } from "@/application/ports/usage-cost-tracker";
import {
  estimateAiCostUsdMicros,
  estimateTtsCostUsdMicros,
  estimateWhatsAppCostUsdMicros,
} from "@/application/services/cost-estimator";
import type { UsageCostRepository } from "@/domain/repositories/usage-cost-repository";

export type DefaultUsageCostTrackerDependencies = {
  usageCostRepository: UsageCostRepository;
  idGenerator: () => string;
  now: () => Date;
};

export class DefaultUsageCostTracker implements UsageCostTracker {
  constructor(private readonly deps: DefaultUsageCostTrackerDependencies) {}

  async trackAiUsage(input: Parameters<UsageCostTracker["trackAiUsage"]>[0]) {
    await this.deps.usageCostRepository.recordAiUsage({
      id: this.deps.idGenerator(),
      clinicId: input.clinicId,
      provider: input.provider,
      model: input.model,
      operation: input.operation,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostUsdMicros: estimateAiCostUsdMicros(input),
      createdAt: this.deps.now(),
    });
  }

  async trackTtsUsage(input: Parameters<UsageCostTracker["trackTtsUsage"]>[0]) {
    await this.deps.usageCostRepository.recordTtsUsage({
      id: this.deps.idGenerator(),
      clinicId: input.clinicId,
      provider: input.provider,
      model: input.model,
      characterCount: input.characterCount,
      estimatedCostUsdMicros: estimateTtsCostUsdMicros(input),
      createdAt: this.deps.now(),
    });
  }

  async trackWhatsAppCost(input: Parameters<UsageCostTracker["trackWhatsAppCost"]>[0]) {
    await this.deps.usageCostRepository.recordWhatsAppMessageCost({
      id: this.deps.idGenerator(),
      clinicId: input.clinicId,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      direction: input.direction,
      category: input.category,
      estimatedCostUsdMicros: estimateWhatsAppCostUsdMicros(input),
      createdAt: this.deps.now(),
    });
  }
}
