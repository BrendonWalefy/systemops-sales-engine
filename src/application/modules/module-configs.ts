import type { TtsProvider } from "@/domain/entities/tts-config";

export type VoiceTtsConfig = {
  provider: TtsProvider;
  speed: number;
};

export type VoiceElevenLabsConfig = {
  voiceId: string;
  stability: number;
  similarityBoost: number;
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
