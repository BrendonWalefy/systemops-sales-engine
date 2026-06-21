import type { TtsGateway, TtsRequest } from "@/application/ports/tts-gateway";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1/text-to-speech";
// Nina M. — voz PT-BR feminina, calorosa e profissional
const DEFAULT_VOICE_ID = "GM2UA3fbsIaLHcswCDX9";
const MODEL_ID = "eleven_flash_v2_5";
const TIMEOUT_MS = 25_000;
// OPUS em container OGG: formato suportado pela ElevenLabs e aceito como nota de voz no WhatsApp.
const OUTPUT_FORMAT = "opus_48000_128";

export class ElevenLabsTtsGateway implements TtsGateway {
  constructor(
    private readonly voiceId = DEFAULT_VOICE_ID,
    private readonly stability = 0.5,
    private readonly similarityBoost = 0.75,
  ) {}

  async synthesize(text: string, options?: TtsRequest): Promise<ArrayBuffer> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY must be set");

    // speed: 0.7 (lento) a 1.2 (rápido); Flash v2.5 suporta via voice_settings
    const speed = Math.min(1.2, Math.max(0.7, options?.speed ?? 1.0));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(
        `${ELEVENLABS_API}/${this.voiceId}?output_format=${OUTPUT_FORMAT}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: MODEL_ID,
            // Fixa português para evitar code-switch (siglas/nomes lidos com sotaque inglês).
            language_code: "pt",
            voice_settings: {
              stability: this.stability,
              similarity_boost: this.similarityBoost,
              speed,
            },
          }),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElevenLabs TTS failed (${res.status}): ${err}`);
    }

    return res.arrayBuffer();
  }
}
