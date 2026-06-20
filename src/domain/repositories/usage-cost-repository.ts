import type { AiUsageCost, TtsUsageCost, WhatsAppMessageCost } from "../entities/usage-cost";

export type UsageCostRepository = {
  recordAiUsage(cost: AiUsageCost): Promise<void>;
  recordTtsUsage(cost: TtsUsageCost): Promise<void>;
  recordWhatsAppMessageCost(cost: WhatsAppMessageCost): Promise<void>;
};

