import type { TtsGateway, TtsRequest } from "@/application/ports/tts-gateway";

// nova: voz feminina calorosa, ótima para PT-BR conversacional
// shimmer: alternativa mais leve/expressiva
const VOICE_DEFAULT = "nova";
const FORMAT_DEFAULT = "mp3";
const TIMEOUT_MS = 20_000;
// 0.92 soa mais natural em português brasileiro do que o padrão 1.0
const SPEED_DEFAULT = 0.92;

/**
 * Remove formatação markdown e emojis antes de enviar ao TTS.
 * WhatsApp usa *negrito*, _itálico_ e emojis — o modelo TTS lê esses caracteres
 * literalmente ou produz pausas indesejadas.
 */
export function sanitizeForTts(text: string): string {
  return text
    // Remove emojis (blocos Unicode de símbolos e pictogramas)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]/gu, "")
    // Remove marcação WhatsApp: *negrito*, _itálico_, ~tachado~, `código`
    .replace(/[*_~`]/g, "")
    // Remove bullet points (• e variantes) — lidos literalmente pelo TTS
    .replace(/[•·–—]/g, "")
    // Parágrafo duplo → pausa de frase (ponto)
    .replace(/\n{2,}/g, ". ")
    // Quebra simples → espaço; vírgula causaria "dois ponto cinco vírgula um ponto Seg..."
    .replace(/\n/g, " ")
    // Colapsa espaços múltiplos
    .replace(/  +/g, " ")
    // Ponto duplicado que pode surgir da transformação acima
    .replace(/\.\s*\./g, ".")
    .trim();
}

export class OpenAiTtsGateway implements TtsGateway {
  async synthesize(text: string, options?: TtsRequest): Promise<ArrayBuffer> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY must be set");

    const cleanText = sanitizeForTts(text);

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
          model: "tts-1-hd",
          input: cleanText,
          voice: options?.voice ?? VOICE_DEFAULT,
          response_format: options?.format ?? FORMAT_DEFAULT,
          speed: options?.speed ?? SPEED_DEFAULT,
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
