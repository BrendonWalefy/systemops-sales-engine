import type {
  TrackAiUsageInput,
  TrackTtsUsageInput,
  TrackWhatsAppCostInput,
} from "@/application/ports/usage-cost-tracker";

type AiModelPrice = {
  inputUsdMicrosPerMillionTokens: number;
  outputUsdMicrosPerMillionTokens: number;
};

const AI_MODEL_PRICES: Record<string, AiModelPrice> = {
  "gpt-4o-mini": {
    inputUsdMicrosPerMillionTokens: 150_000,
    outputUsdMicrosPerMillionTokens: 600_000,
  },
  "gpt-4.1-mini": {
    inputUsdMicrosPerMillionTokens: 400_000,
    outputUsdMicrosPerMillionTokens: 1_600_000,
  },
};

const WHATSAPP_BRAZIL_PRICE_USD_MICROS = {
  service: 0,
  utility: 7_800,
  authentication: 7_800,
  marketing: 71_900,
  unknown: 0,
} as const;

export function estimateAiCostUsdMicros(input: TrackAiUsageInput): number {
  const price = AI_MODEL_PRICES[input.model];
  if (!price) {
    return 0;
  }

  const inputCost =
    (input.inputTokens / 1_000_000) * price.inputUsdMicrosPerMillionTokens;
  const outputCost =
    (input.outputTokens / 1_000_000) * price.outputUsdMicrosPerMillionTokens;

  return Math.ceil(inputCost + outputCost);
}

// ElevenLabs Flash v2.5: ~$0.30/1000 chars (Creator plan, jun/2026).
// Atualizar se migrar de plano.
const TTS_PRICE_USD_MICROS_PER_CHAR: Record<string, number> = {
  eleven_flash_v2_5: 300,
  default: 300,
};

export function estimateTtsCostUsdMicros(input: TrackTtsUsageInput): number {
  if (input.provider === "openai_tts") return 0;
  const pricePerChar = TTS_PRICE_USD_MICROS_PER_CHAR[input.model] ?? TTS_PRICE_USD_MICROS_PER_CHAR.default;
  return Math.ceil(input.characterCount * pricePerChar);
}

export function estimateWhatsAppCostUsdMicros(input: TrackWhatsAppCostInput): number {
  if (input.direction === "inbound") {
    return 0;
  }

  return WHATSAPP_BRAZIL_PRICE_USD_MICROS[input.category];
}
