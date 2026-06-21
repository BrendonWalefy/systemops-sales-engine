import type { TtsGateway, TtsRequest } from "@/application/ports/tts-gateway";
import { sanitizeForTts } from "./tts-text-normalizer";

/**
 * Decorator que normaliza o texto para fala antes de delegar a qualquer gateway de TTS.
 *
 * É o ponto único onde "tornar o texto falável" acontece: a fábrica embrulha todo
 * provider neste decorator, então é estruturalmente impossível um gateway receber
 * texto não-normalizado — sem cada gateway precisar lembrar de sanitizar.
 */
export class NormalizingTtsGateway implements TtsGateway {
  constructor(private readonly inner: TtsGateway) {}

  synthesize(text: string, options?: TtsRequest): Promise<ArrayBuffer> {
    return this.inner.synthesize(sanitizeForTts(text), options);
  }
}
