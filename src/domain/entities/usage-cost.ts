export type AiUsageCost = {
  id: string;
  clinicId: string;
  provider: "openai" | "anthropic";
  model: string;
  operation:
    | "conversation_reply"
    | "conversation_summary"
    | "follow_up_suggestion"
    | "manual_analysis"
    | "playbook_analysis"
    | "lead_outcome_classification"
    | "reactivation_draft";
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsdMicros: number;
  createdAt: Date;
};

export type TtsUsageCost = {
  id: string;
  clinicId: string;
  provider: "elevenlabs" | "openai_tts";
  model: string;
  characterCount: number;
  estimatedCostUsdMicros: number;
  createdAt: Date;
};

export type WhatsAppMessageCost = {
  id: string;
  clinicId: string;
  provider: "meta_cloud_api";
  providerMessageId: string | null;
  direction: "inbound" | "outbound";
  category: "service" | "utility" | "marketing" | "authentication" | "unknown";
  estimatedCostUsdMicros: number;
  createdAt: Date;
};
