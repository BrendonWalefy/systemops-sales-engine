import { describe, expect, it } from "vitest";
import {
  InMemoryDecisionTraceSink,
  recordPredicateEvaluation,
} from "@/core/observability/DecisionTrace";
import { coerceBusinessIntent } from "@/core/pipeline/ConversationOrchestrator";
import type { KeywordPredicateEvaluation } from "@/core/observability/KeywordPredicateEvaluation";

/**
 * Ciclo D — a camada de keyword precisa contar quantas vezes cada predicado
 * dispara e quantas dessas vezes ele *contraria* o classificador. Sem isso, a
 * decisão de remover ou manter cada predicado no Ciclo J seria opinião.
 *
 * A instrumentação é aditiva: `coerceBusinessIntent` continua devolvendo
 * exatamente o mesmo intent, com ou sem observador.
 */
describe("trace de override por predicado de keyword", () => {
  it("registra o predicado que sobrescreveu o classificador", () => {
    const seen: KeywordPredicateEvaluation[] = [];

    const finalIntent = coerceBusinessIntent({
      message: "bom dia, vocês abrem que horário?",
      intent: "greeting",
      treatments: [],
      isClinicSegment: true,
      onPredicateEvaluated: (evaluation) => seen.push(evaluation),
    });

    // Comportamento preservado: o predicado de expediente vence a saudação.
    expect(finalIntent).toBe("general_question");

    const hours = seen.find((e) => e.predicateName === "isBusinessHoursQuestion");
    expect(hours).toBeDefined();
    expect(hours?.predicateFired).toBe(true);
    expect(hours?.classifiedIntent).toBe("greeting");
    expect(hours?.predicateIntent).toBe("general_question");
    expect(hours?.divergedFromClassifier).toBe(true);
  });

  it("registra o predicado que foi consultado e não disparou", () => {
    const seen: KeywordPredicateEvaluation[] = [];

    coerceBusinessIntent({
      message: "bom dia, vocês abrem que horário?",
      intent: "greeting",
      treatments: [],
      isClinicSegment: true,
      onPredicateEvaluated: (evaluation) => seen.push(evaluation),
    });

    // A garantia é consultada antes do expediente e não casa nesta mensagem.
    const warranty = seen.find((e) => e.predicateName === "isWarrantyQuestion");
    expect(warranty).toBeDefined();
    expect(warranty?.predicateFired).toBe(false);
    expect(warranty?.divergedFromClassifier).toBe(false);
  });

  it("não observa nada quando o classificador já decidiu um intent de negócio", () => {
    const seen: KeywordPredicateEvaluation[] = [];

    // `price_inquiry` não é greeting/acknowledgment/unclear: a coerção sai
    // antes de consultar qualquer predicado, e o trace precisa refletir isso.
    const finalIntent = coerceBusinessIntent({
      message: "bom dia, vocês abrem que horário?",
      intent: "price_inquiry",
      treatments: [],
      isClinicSegment: true,
      onPredicateEvaluated: (evaluation) => seen.push(evaluation),
    });

    expect(finalIntent).toBe("price_inquiry");
    expect(seen).toEqual([]);
  });

  it("o intent devolvido é idêntico com e sem observador", () => {
    const withoutObserver = coerceBusinessIntent({
      message: "bom dia, vocês abrem que horário?",
      intent: "greeting",
      treatments: [],
      isClinicSegment: true,
    });
    const withObserver = coerceBusinessIntent({
      message: "bom dia, vocês abrem que horário?",
      intent: "greeting",
      treatments: [],
      isClinicSegment: true,
      onPredicateEvaluated: () => {},
    });

    expect(withObserver).toBe(withoutObserver);
  });

  it("grava a avaliação no trace sem carregar o texto do lead", async () => {
    const sink = new InMemoryDecisionTraceSink();

    await recordPredicateEvaluation(sink, {
      turnId: "turn-1",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      evaluation: {
        predicateName: "isBusinessHoursQuestion",
        predicateFired: true,
        classifiedIntent: "greeting",
        predicateIntent: "general_question",
        divergedFromClassifier: true,
      },
    });

    const [event] = sink.getEvents("turn-1");
    expect(event.stage).toBe("intent.predicate_evaluated");
    expect(event.metadata).toMatchObject({
      predicateName: "isBusinessHoursQuestion",
      predicateFired: true,
      divergedFromClassifier: true,
      classifiedIntent: "greeting",
      predicateIntent: "general_question",
    });
    // O estágio tem allowlist: nada além das chaves declaradas atravessa.
    expect(event.metadata).not.toHaveProperty("leadMessage");
  });
});
