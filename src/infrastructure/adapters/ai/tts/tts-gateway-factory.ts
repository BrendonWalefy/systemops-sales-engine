import type { TtsGateway } from "@/application/ports/tts-gateway";
import type { TtsConfig } from "@/domain/entities/tts-config";
import { OpenAiTtsGateway } from "./openai-tts-gateway";
import { FalKokoroTtsGateway } from "./fal-kokoro-tts-gateway";

export type TtsProviderResult = {
  gateway: TtsGateway;
  format: "mp3" | "wav";
  contentType: string;
  speed: number;
};

export function createTtsProvider(config: TtsConfig): TtsProviderResult {
  if (config.provider === "dora") {
    return {
      gateway: new FalKokoroTtsGateway(),
      format: "wav",
      contentType: "audio/wav",
      speed: config.speed,
    };
  }
  return {
    gateway: new OpenAiTtsGateway(),
    format: "mp3",
    contentType: "audio/mpeg",
    speed: config.speed,
  };
}
