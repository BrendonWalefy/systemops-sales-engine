import { fal } from "@fal-ai/client";
import type { TtsGateway, TtsRequest } from "@/application/ports/tts-gateway";
import { sanitizeForTts } from "./openai-tts-gateway";

const TIMEOUT_MS = 30_000;
const FAL_MODEL = "fal-ai/kokoro/brazilian-portuguese";

type FalAudioResult = {
  data: {
    audio: {
      url: string;
      content_type: string;
      file_name: string;
      file_size: number;
    };
  };
};

function isValidFalResult(v: unknown): v is FalAudioResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (typeof r.data !== "object" || r.data === null) return false;
  const d = r.data as Record<string, unknown>;
  if (typeof d.audio !== "object" || d.audio === null) return false;
  const a = d.audio as Record<string, unknown>;
  return typeof a.url === "string" && a.url.startsWith("https://");
}

export class FalKokoroTtsGateway implements TtsGateway {
  constructor() {
    const key = process.env.FAL_KEY;
    if (!key) throw new Error("FAL_KEY must be set to use Kokoro TTS");
    fal.config({ credentials: key });
  }

  async synthesize(text: string, options?: TtsRequest): Promise<ArrayBuffer> {
    const cleanText = sanitizeForTts(text);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let result: unknown;
    try {
      result = await fal.subscribe(FAL_MODEL, {
        input: {
          prompt: cleanText,
          voice: "pf_dora",
          speed: options?.speed ?? 1.05,
        } as Record<string, unknown>,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!isValidFalResult(result)) {
      throw new Error(
        `[FalKokoro] Resposta inesperada da API: ${JSON.stringify(result).slice(0, 200)}`,
      );
    }

    const audioUrl = result.data.audio.url;
    const res = await fetch(audioUrl, { signal: AbortSignal.timeout(15_000) });

    if (!res.ok) {
      throw new Error(
        `[FalKokoro] Falha ao baixar áudio (${res.status}): ${audioUrl}`,
      );
    }

    return res.arrayBuffer();
  }
}
