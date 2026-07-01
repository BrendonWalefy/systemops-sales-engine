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
// clientes Growth recebem B-WAVE completo (mode "full") para validar o produto com
// os primeiros casos reais, antes de restringir a régua definitiva por plano.
export const GROWTH_VALIDATION_BWAVE_CONFIG: VoiceElevenLabsConfig = {
  voiceId: "",
  stability: 0.58,
  similarityBoost: 0.82,
  speed: 0.96,
  mode: "full",
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
  if (plan === "custom") return [];
  return MODULE_CATALOG.filter((moduleDef) => moduleDef.plans.includes(plan)).map(
    (moduleDef) => moduleDef.key,
  );
}

export function applyPlanActivations(
  currentState: Partial<Record<ModuleKey, boolean>>,
  plan: OrgPlan,
): Partial<Record<ModuleKey, boolean>> {
  if (plan === "custom") return currentState;

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
