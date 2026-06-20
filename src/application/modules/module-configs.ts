import type { TtsProvider } from "@/domain/entities/tts-config";
import type { VoiceMode } from "@/domain/entities/voice-mode";

export type VoiceTtsConfig = {
  provider: TtsProvider;
  speed: number;
};

export type VoiceElevenLabsConfig = {
  voiceId: string;
  stability: number;
  similarityBoost: number;
  speed: number;      // 0.7–1.2; configurável pela clínica
  mode: VoiceMode;    // impact | mix | full; configurado pelo owner
};

export type ModuleConfigMap = {
  voice_tts: VoiceTtsConfig;
  voice_elevenlabs: VoiceElevenLabsConfig;
  menu_mode: null;
  concierge_mode: null;
  revenue_pipeline: null;
  team_roles: null;
  video_library: null;
  ai_co_writer: null;
};
