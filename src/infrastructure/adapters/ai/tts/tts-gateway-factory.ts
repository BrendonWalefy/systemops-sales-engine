import type { TtsGateway } from "@/application/ports/tts-gateway";
import { OpenAiTtsGateway } from "./openai-tts-gateway";
import { FalKokoroTtsGateway } from "./fal-kokoro-tts-gateway";

export type TtsVoice = "nova" | "dora";

type TtsProvider = {
  gateway: TtsGateway;
  format: "mp3" | "wav";
  contentType: string;
};

export function createTtsProvider(voice: string): TtsProvider {
  if (voice === "dora") {
    return {
      gateway: new FalKokoroTtsGateway(),
      format: "wav",
      contentType: "audio/wav",
    };
  }
  return {
    gateway: new OpenAiTtsGateway(),
    format: "mp3",
    contentType: "audio/mpeg",
  };
}
