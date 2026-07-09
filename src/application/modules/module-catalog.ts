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
  "price_campaigns",
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
    plans: ["start", "growth", "scale", "enterprise"],
  },
  {
    key: "concierge_mode",
    label: "Modo Concierge",
    description: "IA conversa naturalmente, sem menu — experiência premium",
    plans: ["growth", "scale", "enterprise"],
  },
  {
    key: "voice_tts",
    label: "Resposta por Voz (básica)",
    description: "IA responde em áudio usando voz sintética OpenAI — 3 modos configuráveis pela clínica",
    // Liberado já no Start: voz robotizada (OpenAI, mais barata) como diferencial
    // real do plano, configurável em 3 modos (impact/mix/full) pelo próprio painel
    // da clínica, igual ao seletor do B-WAVE. Ver docs/product/pricing-strategy.md.
    plans: ["start", "growth", "scale", "enterprise"],
  },
  {
    key: "voice_elevenlabs",
    label: "B-WAVE Voice",
    description: "Voz hiper-realista via ElevenLabs — atendimento que soa humano no WhatsApp",
    // avancado (Growth) inclui B-WAVE em "impact" — voz premium nos momentos de
    // conversão — ver GROWTH_VALIDATION_BWAVE_CONFIG em plan-presets.ts e
    // docs/product/pricing-strategy.md §6.2. "full" fica como opt-in por clínica.
    plans: ["growth", "scale", "enterprise"],
  },
  {
    key: "revenue_pipeline",
    // Retirado do catálogo vendável: cálculo hoje é estático
    // (organizations.monthlyRevenueBrl), não receita em tempo real.
    // Reativar comercialmente só após docs/operations/billing-roadmap.md Fase 5.
    label: "Pipeline de Receita",
    description: "Dashboard financeiro com receita potencial e confirmada",
    plans: ["enterprise"],
  },
  {
    key: "team_roles",
    label: "Controle de Equipe",
    description: "Papéis por membro: admin, profissional, recepcionista",
    plans: ["growth", "scale", "enterprise"],
  },
  {
    key: "video_library",
    label: "Biblioteca de Mídia",
    description: "IA envia vídeos e áudios personalizados na conversa",
    plans: ["growth", "scale", "enterprise"],
  },
  {
    key: "ai_co_writer",
    label: "Co-escritor IA",
    description: "Assistente IA para redigir e melhorar o playbook",
    plans: ["growth", "scale", "enterprise"],
  },
  {
    key: "price_campaigns",
    label: "Campanhas de Preço",
    description: "Preço promocional com prazo por procedimento — a IA fala o valor 'de X por Y' e o dashboard usa o preço vigente",
    // plans: [] deliberado — feature nova, rollout controlado clínica a clínica
    // pelo painel do owner (não entra em resolvePlanModules/syncModulesForPlan).
    // Promover para um ou mais planos quando validada além do piloto inicial.
    plans: [],
  },
];
