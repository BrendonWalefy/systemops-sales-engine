import type { OrgPlan } from "@/application/onboarding/clinic-commercial-settings";
import type { VoiceElevenLabsConfig } from "@/application/modules/module-configs";
import { MODULE_CATALOG, type ModuleKey } from "./module-catalog";

export const REDE_RECOMMENDED_TONE =
  "Profissional, consultivo e premium; acolhedor sem ser informal, seguro ao orientar o paciente e sempre claro ao conduzir para o agendamento.";

export const REDE_RECOMMENDED_BWAVE_CONFIG: VoiceElevenLabsConfig = {
  voiceId: "",
  stability: 0.58,
  similarityBoost: 0.82,
  speed: 0.96,
  mode: "mix",
};

// Fase de validação inicial (Start + Growth, ver docs/product/pricing-strategy.md):
// Growth usa B-WAVE em "impact" — voz premium nos momentos de conversão (saudação,
// preço, agendamento, confirmação, urgência). Decisão jul/2026: default "impact" em vez
// de "full", para proteger a margem (ElevenLabs é caro por caractere) e responder ao
// feedback real de cliente (áudio em excesso incomoda). "full" fica como opt-in por
// clínica no painel. Ver docs/product/pricing-strategy.md §6.2.
export const GROWTH_VALIDATION_BWAVE_CONFIG: VoiceElevenLabsConfig = {
  voiceId: "",
  stability: 0.58,
  similarityBoost: 0.82,
  speed: 0.96,
  mode: "impact",
};

const GENERIC_TONES = new Set([
  "acolhedor",
  "profissional",
  "sofisticado",
  "descontraido",
  "descontraído",
  "amigável",
  "Acolhedor",
  "Profissional",
  "Sofisticado",
  "Descontraído",
  "Acolhedor e empático",
  "Técnico e informativo",
  "Persuasivo e orientado a resultados",
  "Premium e exclusivo",
]);

function normalizeTone(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function resolvePlanModules(plan: OrgPlan): ModuleKey[] {
  if (plan === "enterprise") return [];
  return MODULE_CATALOG.filter((moduleDef) => moduleDef.plans.includes(plan)).map(
    (moduleDef) => moduleDef.key,
  );
}

export function applyPlanActivations(
  currentState: Partial<Record<ModuleKey, boolean>>,
  plan: OrgPlan,
): Partial<Record<ModuleKey, boolean>> {
  if (plan === "enterprise") return currentState;

  const nextState = { ...currentState };
  for (const key of resolvePlanModules(plan)) {
    nextState[key] = true;
  }
  return nextState;
}

export function mergeBWaveConfig(
  currentConfig: Partial<VoiceElevenLabsConfig> | null | undefined,
  base: VoiceElevenLabsConfig = REDE_RECOMMENDED_BWAVE_CONFIG,
): VoiceElevenLabsConfig {
  return {
    voiceId: currentConfig?.voiceId?.trim() ?? base.voiceId,
    stability: currentConfig?.stability ?? base.stability,
    similarityBoost: currentConfig?.similarityBoost ?? base.similarityBoost,
    speed: currentConfig?.speed ?? base.speed,
    mode: currentConfig?.mode ?? base.mode,
    voiceOutputEnabled: currentConfig?.voiceOutputEnabled ?? base.voiceOutputEnabled,
  };
}


export function shouldApplyRedeToneRecommendation(
  currentTone: string | null | undefined,
): boolean {
  const normalized = normalizeTone(currentTone);
  if (!normalized) return true;
  if (normalized === REDE_RECOMMENDED_TONE) return false;
  return GENERIC_TONES.has(normalized);
}
