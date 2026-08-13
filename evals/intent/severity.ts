import type { IntentType } from "@/core/intelligence/IntentClassifier";
import type { SeverityLevel } from "./types";

// Custo de negócio de cada confusão, não distância semântica. Editar aqui é a
// única forma de mudar o peso — o runner nunca decide severidade.
//
// Crítica  → dano regulatório, ou dor e presença física ignoradas.
// Alta     → a conversa entra no trilho errado e o lead se perde.
// Média    → atrito recuperável, ou ruído na recepção.
// Baixa    → praticamente inócuo.
const CONFUSION_SEVERITY: { expected: IntentType; got: IntentType; level: SeverityLevel }[] = [
  // Crítica: opt-out perdido é risco de compliance.
  { expected: "stop_contact", got: "farewell", level: "critical" },
  { expected: "stop_contact", got: "acknowledgment", level: "critical" },
  { expected: "stop_contact", got: "reject_slots", level: "critical" },
  { expected: "stop_contact", got: "unclear", level: "critical" },
  // Crítica: dor tratada como pergunta comum.
  { expected: "clinical_urgency", got: "general_question", level: "critical" },
  { expected: "clinical_urgency", got: "book_appointment", level: "critical" },
  { expected: "clinical_urgency", got: "acknowledgment", level: "critical" },
  { expected: "clinical_urgency", got: "unclear", level: "critical" },
  // Crítica: paciente na recepção sem ninguém atender (caso Carla).
  { expected: "patient_arrived", got: "acknowledgment", level: "critical" },
  { expected: "patient_arrived", got: "greeting", level: "critical" },
  { expected: "patient_arrived", got: "unclear", level: "critical" },

  // Alta: pergunta de negócio engolida pela saudação (casos Tania, Julllys).
  { expected: "price_inquiry", got: "greeting", level: "high" },
  { expected: "price_inquiry", got: "acknowledgment", level: "high" },
  { expected: "price_inquiry", got: "unclear", level: "high" },
  { expected: "book_appointment", got: "greeting", level: "high" },
  { expected: "book_appointment", got: "acknowledgment", level: "high" },
  { expected: "general_question", got: "greeting", level: "high" },
  { expected: "general_question", got: "unclear", level: "high" },
  // Alta: agenda errada.
  { expected: "confirm_slot", got: "reject_slots", level: "high" },
  { expected: "reject_slots", got: "confirm_slot", level: "high" },
  // Alta: pedido que só humano resolve, ignorado.
  { expected: "needs_human", got: "general_question", level: "high" },
  { expected: "needs_human", got: "price_inquiry", level: "high" },
  { expected: "needs_human", got: "greeting", level: "high" },

  // Média: recepção recebe ruído.
  { expected: "general_question", got: "needs_human", level: "medium" },
  { expected: "price_inquiry", got: "needs_human", level: "medium" },
  { expected: "general_question", got: "book_appointment", level: "medium" },
  { expected: "book_appointment", got: "general_question", level: "medium" },

  // Baixa: cortesia trocada por cortesia.
  { expected: "greeting", got: "acknowledgment", level: "low" },
  { expected: "acknowledgment", got: "greeting", level: "low" },
  { expected: "farewell", got: "acknowledgment", level: "low" },
  { expected: "acknowledgment", got: "farewell", level: "low" },
];

const SEVERITY_INDEX = new Map<string, SeverityLevel>(
  CONFUSION_SEVERITY.map((entry) => [`${entry.expected}>${entry.got}`, entry.level]),
);

/**
 * Nível de uma confusão. Acerto é "none". Par não catalogado cai em "medium":
 * o default é assumir que errar importa, para que esquecer de catalogar não
 * transforme um erro real em ruído invisível.
 */
export function classifyConfusion(expected: IntentType, got: IntentType | null): SeverityLevel {
  if (got === null) return "medium";
  if (expected === got) return "none";
  return SEVERITY_INDEX.get(`${expected}>${got}`) ?? "medium";
}
