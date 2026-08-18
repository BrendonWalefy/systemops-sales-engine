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
  "gpt-4o": {
    inputUsdMicrosPerMillionTokens: 2_500_000,
    outputUsdMicrosPerMillionTokens: 10_000_000,
  },
  "gpt-4.1-mini": {
    inputUsdMicrosPerMillionTokens: 400_000,
    outputUsdMicrosPerMillionTokens: 1_600_000,
  },
  "gpt-5.4-mini": {
    inputUsdMicrosPerMillionTokens: 750_000,
    outputUsdMicrosPerMillionTokens: 4_500_000,
  },
  // Candidatos medidos no benchmark de classificador de 13/08/2026
  // (docs/superpowers/plans/2026-08-13-classifier-model-comparison.md).
  // Atenção: estes números são o preço de input NÃO cacheado. O prompt do
  // classificador tem ~2 mil tokens estáticos e atinge 87-94% de cache, então o
  // custo real por chamada é bem menor que o que esta tabela estima — ela
  // superestima, nunca subestima, o que é o lado seguro para margem.
  "gpt-4.1-nano": {
    inputUsdMicrosPerMillionTokens: 100_000,
    outputUsdMicrosPerMillionTokens: 400_000,
  },
  "gpt-5.4-nano": {
    inputUsdMicrosPerMillionTokens: 200_000,
    outputUsdMicrosPerMillionTokens: 1_250_000,
  },
  "gpt-5.6-luna": {
    inputUsdMicrosPerMillionTokens: 200_000,
    outputUsdMicrosPerMillionTokens: 1_200_000,
  },
  "gpt-5.6-terra": {
    inputUsdMicrosPerMillionTokens: 2_000_000,
    outputUsdMicrosPerMillionTokens: 12_000_000,
  },
  "gpt-5.6-sol": {
    inputUsdMicrosPerMillionTokens: 5_000_000,
    outputUsdMicrosPerMillionTokens: 30_000_000,
  },
  "gpt-5.4": {
    inputUsdMicrosPerMillionTokens: 2_500_000,
    outputUsdMicrosPerMillionTokens: 15_000_000,
  },
  "gpt-5.5": {
    inputUsdMicrosPerMillionTokens: 5_000_000,
    outputUsdMicrosPerMillionTokens: 30_000_000,
  },
  // Modelos Anthropic (advisor-llm roteia "claude-*" para a Anthropic).
  // Sem estas linhas, toda chamada Claude — setup study (ADR-002) e Motor de
  // Reativação (ADR-009) — era estimada como custo zero.
  // Preços de jul/2026, USD por milhão de tokens.
  // claude-sonnet-5 está em preço introdutório ($2/$10) até 31/08/2026;
  // registramos o preço cheio ($3/$15) para não subestimar a margem.
  "claude-sonnet-5": {
    inputUsdMicrosPerMillionTokens: 3_000_000,
    outputUsdMicrosPerMillionTokens: 15_000_000,
  },
  "claude-opus-4-8": {
    inputUsdMicrosPerMillionTokens: 5_000_000,
    outputUsdMicrosPerMillionTokens: 25_000_000,
  },
  "claude-haiku-4-5": {
    inputUsdMicrosPerMillionTokens: 1_000_000,
    outputUsdMicrosPerMillionTokens: 5_000_000,
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

// ElevenLabs Flash v2.5 = ~0,5 crédito/caractere. No plano Pro ($99/600k créditos,
// jul/2026) isso equivale a ~$0,12/1000 chars (overage Pro $0,24/1k crédito × 0,5).
// Antes assumíamos $0,30/1k (Creator, 1 crédito/char) — superestimava ~2,5x. Atualizar
// ao migrar de plano (Scale $0,18/1k crédito → ~$0,09/1k chars).
const TTS_PRICE_USD_MICROS_PER_CHAR: Record<string, number> = {
  eleven_flash_v2_5: 120,
  default: 120,
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
