import type { TtsProvider } from "@/domain/entities/tts-config";
import type { VoiceMode } from "@/domain/entities/voice-mode";

export type VoiceTtsConfig = {
  provider: TtsProvider;
  speed: number;
  voiceOutputEnabled?: boolean; // default true; false = envia só texto mesmo com módulo ativo
  mode?: VoiceMode; // sem config, a voz básica (Start) cai em "greeting_only" (só a saudação) — ver ConversationOrchestrator e pricing-strategy §6.1
};

export type VoiceElevenLabsConfig = {
  voiceId: string;
  stability: number;
  similarityBoost: number;
  speed: number;      // 0.7–1.2; configurável pela clínica
  mode: VoiceMode;    // impact | mix | full; configurado pelo owner
  voiceOutputEnabled?: boolean; // default true; false = envia só texto mesmo com módulo ativo
};

export type ConciergeVerbosity = "concisa" | "equilibrada" | "detalhada";
export type ConciergeDrive =
  | "responder_e_parar"
  | "sempre_proximo_passo"
  | "direto_ao_agendamento";

export type ConciergeModeConfig = {
  verbosity?: ConciergeVerbosity;
  drive?: ConciergeDrive;
};

// Padrões que preservam o comportamento histórico do modo concierge quando a
// clínica não configura nada (config = null): verbosidade equilibrada e
// condução ativa para o próximo passo.
export const DEFAULT_CONCIERGE_VERBOSITY: ConciergeVerbosity = "equilibrada";
export const DEFAULT_CONCIERGE_DRIVE: ConciergeDrive = "sempre_proximo_passo";

// Rótulos/descrições para a UI do painel owner — fonte única para não divergir
// entre o formulário e o prompt.
export const CONCIERGE_VERBOSITY_OPTIONS: {
  value: ConciergeVerbosity;
  label: string;
  description: string;
}[] = [
  { value: "concisa", label: "Concisa", description: "Respostas curtas e diretas, sem rodeios." },
  { value: "equilibrada", label: "Equilibrada", description: "Padrão: responde com contexto sem alongar." },
  { value: "detalhada", label: "Detalhada", description: "Explicação consultiva e aprofundada do procedimento." },
];

export const CONCIERGE_DRIVE_OPTIONS: {
  value: ConciergeDrive;
  label: string;
  description: string;
}[] = [
  { value: "responder_e_parar", label: "Responder e parar", description: "Só responde a dúvida — nunca termina com pergunta." },
  { value: "sempre_proximo_passo", label: "Sempre próximo passo", description: "Padrão: encerra conduzindo ao próximo passo natural." },
  { value: "direto_ao_agendamento", label: "Direto ao agendamento", description: "Sempre oferta ativamente a avaliação/agendamento." },
];

export type ModuleConfigMap = {
  voice_tts: VoiceTtsConfig;
  voice_elevenlabs: VoiceElevenLabsConfig;
  menu_mode: null;
  concierge_mode: ConciergeModeConfig | null;
  revenue_pipeline: null;
  team_roles: null;
  video_library: null;
  ai_co_writer: null;
};

export function preserveVoiceOutputEnabled<T extends object>(
  nextConfig: T,
  currentConfig: unknown,
): T & { voiceOutputEnabled?: boolean } {
  if (Object.prototype.hasOwnProperty.call(nextConfig, "voiceOutputEnabled")) {
    return nextConfig;
  }

  if (!currentConfig || typeof currentConfig !== "object" || Array.isArray(currentConfig)) {
    return nextConfig;
  }

  const currentVoiceOutputEnabled = (currentConfig as { voiceOutputEnabled?: unknown }).voiceOutputEnabled;
  if (typeof currentVoiceOutputEnabled !== "boolean") return nextConfig;

  return { ...nextConfig, voiceOutputEnabled: currentVoiceOutputEnabled };
}
