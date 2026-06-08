import type { TtsGateway, TtsRequest } from "@/application/ports/tts-gateway";

const VOICE_DEFAULT = "nova";
const FORMAT_DEFAULT = "mp3";
const TIMEOUT_MS = 15_000;

export class OpenAiTtsGateway implements TtsGateway {
  async synthesize(text: string, options?: TtsRequest): Promise<ArrayBuffer> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY must be set");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          input: text,
          voice: options?.voice ?? VOICE_DEFAULT,
          response_format: options?.format ?? FORMAT_DEFAULT,
          speed: options?.speed ?? 1.0,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI TTS failed (${res.status}): ${err}`);
    }

    return res.arrayBuffer();
  }
}
