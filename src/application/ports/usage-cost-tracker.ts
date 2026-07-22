export type TrackAiUsageInput = {
  clinicId: string;
  provider: "openai" | "anthropic";
  model: string;
  operation:
    | "sales_conversation_analysis"
    | "conversation_summary"
    | "follow_up_suggestion"
    | "manual_analysis"
    | "playbook_analysis"
    | "lead_outcome_classification";
  inputTokens: number;
  outputTokens: number;
};

export type TrackTtsUsageInput = {
  clinicId: string;
  provider: "elevenlabs" | "openai_tts";
  model: string;
  characterCount: number;
};

export type TrackWhatsAppCostInput = {
  clinicId: string;
  provider: "meta_cloud_api";
  providerMessageId: string | null;
  direction: "inbound" | "outbound";
  category: "service" | "utility" | "marketing" | "authentication" | "unknown";
};

export type UsageCostTracker = {
  trackAiUsage(input: TrackAiUsageInput): Promise<void>;
  trackTtsUsage(input: TrackTtsUsageInput): Promise<void>;
  trackWhatsAppCost(input: TrackWhatsAppCostInput): Promise<void>;
};

