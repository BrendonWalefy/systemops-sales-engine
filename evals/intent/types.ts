import type { IntentType } from "@/core/intelligence/IntentClassifier";

// "incident": texto real de lead, com o erro do modelo documentado em produção.
// "prompt_rule": frase que a própria regra do system prompt nomeia. Mede
// aderência à regra escrita, não generalização. Os dois nunca somam.
export type EvalStratum = "incident" | "prompt_rule";

export type SeverityLevel = "none" | "low" | "medium" | "high" | "critical";

export type EvalCaseHistoryEntry = {
  author: "lead" | "agent";
  body: string;
};

export type EvalCase = {
  id: string;
  stratum: EvalStratum;
  message: string;
  expected: IntentType;
  // O intent que o modelo devolveu em produção, quando o caso de origem registra.
  // Habilita a pergunta "o modelo novo ainda erra isto?".
  observedLlmIntent?: IntentType | null;
  source: string;
  context: {
    hasPendingSlotOffer: boolean;
    isClinicSegment: boolean;
    treatments: string[];
  };
  history: EvalCaseHistoryEntry[];
};

export type CaseOutcome = {
  caseId: string;
  stratum: EvalStratum;
  expected: IntentType;
  got: IntentType | null;
  severity: SeverityLevel;
  // true quando a chamada falhou (rede, 429, timeout). Nunca conta como acerto
  // nem como erro de classificação.
  executionError: string | null;
};
