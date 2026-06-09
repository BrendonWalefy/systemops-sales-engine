import type { TtsGateway, TtsRequest } from "@/application/ports/tts-gateway";
import { sanitizeForTts } from "./openai-tts-gateway";

// pt-BR-Neural2-C: feminina, naturalidade alta, sotaque brasileiro
const VOICE_DEFAULT = "pt-BR-Neural2-C";
const TIMEOUT_MS = 20_000;
// Neural2 soa bem em 1.0 — PT-BR não precisa de ajuste como OpenAI
const SPEED_DEFAULT = 1.0;

export class GoogleNeural2TtsGateway implements TtsGateway {
  async synthesize(text: string, options?: TtsRequest): Promise<ArrayBuffer> {
    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_TTS_API_KEY must be set");

    const cleanText = sanitizeForTts(text);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text: cleanText },
            voice: {
              languageCode: "pt-BR",
              name: options?.voice ?? VOICE_DEFAULT,
            },
            audioConfig: {
              audioEncoding: "MP3",
              speakingRate: options?.speed ?? SPEED_DEFAULT,
            },
          }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Neural2 TTS failed (${res.status}): ${err}`);
    }

    const { audioContent } = (await res.json()) as { audioContent: string };
    const binary = Buffer.from(audioContent, "base64");
    return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  }
}
