import type { IntentType } from "@/core/intelligence/IntentClassifier";

export type VoiceMode = "greeting_only" | "impact" | "mix" | "full";

// Intents onde a voz tem alto impacto em conversão e experiência
const IMPACT_INTENTS = new Set<IntentType>([
  "greeting",           // primeiro contato — impressão inicial define tudo
  "book_appointment",   // momento de conversão
  "confirm_slot",       // confirmação cria confiança
  "price_inquiry",      // lead quente discutindo investimento
  "clinical_urgency",   // empatia em momento de dor
  "reschedule_appointment", // retenção de paciente
  "check_availability", // lead ativo buscando horário
  "general_question",   // interesse genuíno na clínica
]);

// No modo Mix, apenas esses intents ficam em texto (muito curtos ou operacionais)
const SKIP_IN_MIX = new Set<IntentType>([
  "needs_human",    // vai para humano de qualquer forma
  "farewell",       // encerramento — voz aqui é waste de crédito
  "patient_arrived",// mensagem operacional curta
  "acknowledgment", // "ok", "blz" — resposta trivial
  "unclear",        // lead confuso — voz pode confundir mais
]);

export function shouldUseBWaveForMessage(
  mode: VoiceMode,
  intent: IntentType,
  responseText: string,
  inputWasAudio: boolean,
): boolean {
  // Simetria natural: lead mandou áudio → resposta em voz
  if (inputWasAudio) return true;

  // Respostas muito curtas não justificam crédito de síntese
  if (responseText.trim().length < 50) return false;

  switch (mode) {
    case "full":          return true;
    case "impact":        return IMPACT_INTENTS.has(intent);
    case "mix":           return !SKIP_IN_MIX.has(intent);
    // Teaser comercial do plano Start: só a saudação vem em voz, o resto em texto.
    // Cria desejo de upgrade sem dar a
    // experiência completa de graça.
    case "greeting_only": return intent === "greeting";
  }
}

export const VOICE_MODE_LABELS: Record<VoiceMode, { label: string; description: string }> = {
  greeting_only: {
    label: "Voz na saudação",
    description: "Só a primeira mensagem (saudação) vem em áudio. Teaser do plano Start.",
  },
  impact: {
    label: "B-WAVE Impact",
    description: "Voz nos momentos certos: saudação, agendamento, confirmação, preços. Economiza créditos.",
  },
  mix: {
    label: "B-WAVE Mix",
    description: "Quase toda a conversa em voz, exceto mensagens operacionais curtas.",
  },
  full: {
    label: "B-WAVE Full",
    description: "Toda conversa em voz. Experiência 100% humanizada.",
  },
};
