import type { AiUsageCost, WhatsAppMessageCost } from "@/domain/entities/usage-cost";
import type { UsageCostRepository } from "@/domain/repositories/usage-cost-repository";
import { db } from "@/infrastructure/db/client";
import { aiUsageCosts, whatsappMessageCosts } from "@/infrastructure/db/schema";

export class DrizzleUsageCostRepository implements UsageCostRepository {
  async recordAiUsage(cost: AiUsageCost): Promise<void> {
    await db.insert(aiUsageCosts).values({
      id: cost.id,
      clinicId: cost.clinicId,
      provider: cost.provider,
      model: cost.model,
      operation: cost.operation,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      estimatedCostUsdMicros: cost.estimatedCostUsdMicros,
      createdAt: cost.createdAt,
    });
  }

  async recordWhatsAppMessageCost(cost: WhatsAppMessageCost): Promise<void> {
    await db.insert(whatsappMessageCosts).values({
      id: cost.id,
      clinicId: cost.clinicId,
      provider: cost.provider,
      providerMessageId: cost.providerMessageId,
      direction: cost.direction,
      category: cost.category,
      estimatedCostUsdMicros: cost.estimatedCostUsdMicros,
      createdAt: cost.createdAt,
    });
  }
}
