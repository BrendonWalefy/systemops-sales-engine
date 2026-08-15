import type { IntentType } from "@/core/intelligence/IntentClassifier";
import type { ProducedUnderstanding } from "@/application/corpus/eval-understanding";

/**
 * Adaptador da V1 para o eval de Understanding.
 *
 * A V1 produz **um** eixo: o intent do classificador. O adaptador o converte
 * para o vocabulário `request` do corpus e não preenche mais nada — nenhum
 * movimento de diálogo, nenhuma entidade, nenhum sinal, nenhuma ambiguidade.
 * Preencher qualquer um deles aqui seria medir este arquivo, não a V1.
 *
 * O sentido da tradução é do corpus **para** a V1, e não o contrário. O
 * vocabulário do corpus é mais fino que os 17 intents (30 `request` distintos em
 * 66 casos), e traduzir para o lado fino obrigaria a V1 a distinguir coisas que
 * ela nunca teve como distinguir — o número sairia baixo por um motivo errado.
 * Da forma como está, a V1 é medida na régua dela.
 */
export const CORPUS_REQUEST_TO_V1_INTENT: Readonly<Record<string, IntentType>> = {
  "price-of-service": "price_inquiry",
  "price-objection": "price_inquiry",
  "installment-terms": "price_inquiry",
  "discount-request": "needs_human",
  "challenge-claim": "price_inquiry",
  "evaluation-cost": "price_inquiry",
  "book-appointment": "book_appointment",
  "check-availability": "check_availability",
  "confirm-slot": "confirm_slot",
  "confirm-appointment": "confirm_slot",
  "service-information": "general_question",
  "service-availability": "general_question",
  "compare-services": "general_question",
  "procedure-duration": "general_question",
  "procedure-safety": "general_question",
  "treatment-timeline": "general_question",
  "clinic-address": "general_question",
  "clinic-city": "general_question",
  "see-media": "general_question",
  "clinical-suitability": "clinical_urgency",
  "clinical-advice": "clinical_urgency",
  "reach-person": "needs_human",
  "send-media": "needs_human",
  "chitchat": "acknowledgment",
  "confirm-intent": "acknowledgment",
  "defer-answer": "acknowledgment",
  "postpone": "acknowledgment",
  "future-interest": "acknowledgment",
  "referral-intro": "general_question",
  "reengage": "acknowledgment",
};

export function v1Understanding(intent: IntentType | null): ProducedUnderstanding {
  if (!intent) return {};
  return { request: intent };
}

/**
 * O esperado, na régua da V1. `null` quando o `request` do corpus não tem
 * correspondente — que é, por si, um achado sobre a taxonomia antiga.
 */
export function expectedV1Intent(request: string): IntentType | null {
  return CORPUS_REQUEST_TO_V1_INTENT[request] ?? null;
}
