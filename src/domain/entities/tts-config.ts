export type TtsProvider = "nova" | "dora" | "neural2";

export type TtsConfig = {
  provider: TtsProvider;
  speed: number;
};

export const TTS_SPEED_DEFAULTS: Record<TtsProvider, number> = {
  nova: 0.92,    // OpenAI nova — ligeiramente mais lento para PT-BR natural
  dora: 1.05,    // Kokoro PT-BR — mais ágil, sotaque brasileiro
  neural2: 1.0,  // Google Neural2 pt-BR-Neural2-C — soa natural em velocidade padrão
};

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  provider: "nova",
  speed: TTS_SPEED_DEFAULTS.nova,
};

export function ttsConfigFromVoice(voice: string): TtsConfig {
  const provider: TtsProvider = voice === "dora" ? "dora" : "nova";
  return { provider, speed: TTS_SPEED_DEFAULTS[provider] };
}
