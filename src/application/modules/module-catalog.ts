import type { OrgPlan } from "@/application/onboarding/clinic-commercial-settings";

export const MODULE_KEYS = [
  "menu_mode",
  "concierge_mode",
  "voice_tts",
  "voice_elevenlabs",
  "revenue_pipeline",
  "team_roles",
  "video_library",
  "ai_co_writer",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  description: string;
  plans: OrgPlan[];
};

export const MODULE_CATALOG: ModuleDefinition[] = [
  {
    key: "menu_mode",
    label: "Modo Menu",
    description: "IA responde com opções numeradas para guiar o lead",
    plans: ["essencial", "avancado", "rede", "custom"],
  },
  {
    key: "concierge_mode",
    label: "Modo Concierge",
    description: "IA conversa naturalmente, sem menu — experiência premium",
    plans: ["avancado", "rede", "custom"],
  },
  {
    key: "voice_tts",
    label: "Resposta por Voz (básica)",
    description: "IA responde em áudio usando voz sintética OpenAI",
    plans: ["avancado", "rede", "custom"],
  },
  {
    key: "voice_elevenlabs",
    label: "B-WAVE Voice",
    description: "Voz hiper-realista via ElevenLabs — atendimento que soa humano no WhatsApp",
    plans: ["rede", "custom"],
  },
  {
    key: "revenue_pipeline",
    label: "Pipeline de Receita",
    description: "Dashboard financeiro com receita potencial e confirmada",
    plans: ["avancado", "rede", "custom"],
  },
  {
    key: "team_roles",
    label: "Controle de Equipe",
    description: "Papéis por membro: admin, profissional, recepcionista",
    plans: ["avancado", "rede", "custom"],
  },
  {
    key: "video_library",
    label: "Biblioteca de Mídia",
    description: "IA envia vídeos e áudios personalizados na conversa",
    plans: ["avancado", "rede", "custom"],
  },
  {
    key: "ai_co_writer",
    label: "Co-escritor IA",
    description: "Assistente IA para redigir e melhorar o playbook",
    plans: ["avancado", "rede", "custom"],
  },
];
