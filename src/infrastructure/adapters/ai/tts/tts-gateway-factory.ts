import type { TtsGateway } from "@/application/ports/tts-gateway";
import type { TtsConfig } from "@/domain/entities/tts-config";
import { OpenAiTtsGateway } from "./openai-tts-gateway";
import { GoogleNeural2TtsGateway } from "./google-neural2-tts-gateway";
import { ElevenLabsTtsGateway } from "./elevenlabs-tts-gateway";
import { NormalizingTtsGateway } from "./normalizing-tts-gateway";

export type TtsProviderResult = {
  gateway: TtsGateway;
  format: "mp3" | "ogg" | "wav";
  contentType: string;
  speed: number;
};

// Todo gateway sai daqui embrulhado no NormalizingTtsGateway: a normalização de
// texto para fala é garantida no ponto de criação, não delegada a cada provider.
export function createTtsProvider(config: TtsConfig): TtsProviderResult {
  if (config.provider === "elevenlabs") {
    return {
      gateway: new NormalizingTtsGateway(
        new ElevenLabsTtsGateway(
          config.elevenLabsVoiceId,
          config.elevenLabsStability,
          config.elevenLabsSimilarityBoost,
        ),
      ),
      // OGG/OPUS: nota de voz nativa no WhatsApp
      format: "ogg",
      contentType: "audio/ogg",
      speed: config.speed,
    };
  }
  if (config.provider === "neural2") {
    return {
      gateway: new NormalizingTtsGateway(new GoogleNeural2TtsGateway()),
      format: "mp3",
      contentType: "audio/mpeg",
      speed: config.speed,
    };
  }
  return {
    gateway: new NormalizingTtsGateway(new OpenAiTtsGateway()),
    format: "mp3",
    contentType: "audio/mpeg",
    speed: config.speed,
  };
}
