import type { AiUsageCost, WhatsAppMessageCost } from "../entities/usage-cost";

export type UsageCostRepository = {
  recordAiUsage(cost: AiUsageCost): Promise<void>;
  recordWhatsAppMessageCost(cost: WhatsAppMessageCost): Promise<void>;
};

