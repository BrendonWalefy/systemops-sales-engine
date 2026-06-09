export type TtsProvider = "nova" | "neural2";
// "dora" (Kokoro/FAL) removido — latência de 30-60s inviabiliza uso em produção

export type TtsConfig = {
  provider: TtsProvider;
  speed: number;
};

export const TTS_SPEED_DEFAULTS: Record<TtsProvider, number> = {
  nova: 0.92,    // OpenAI nova — ligeiramente mais lento para PT-BR natural
  neural2: 1.0,  // Google Neural2 pt-BR-Neural2-C — soa natural em velocidade padrão
};

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  provider: "nova",
  speed: TTS_SPEED_DEFAULTS.nova,
};

export function ttsConfigFromVoice(voice: string): TtsConfig {
  const provider: TtsProvider = voice === "neural2" ? "neural2" : "nova";
  return { provider, speed: TTS_SPEED_DEFAULTS[provider] };
}
