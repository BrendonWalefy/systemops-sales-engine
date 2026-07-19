/**
 * P0.1 — Guard Anti-Saudação-Genérica
 *
 * Testa que quando um lead pergunta sobre algo de negócio (preço, agendamento, etc),
 * a IA não responde com saudação genérica ("me conta o que você gostaria de ver hoje").
 *
 * Casos reais da auditoria Vitalli (10 ocorrências de F1):
 * 1. "Olá! Posso ter mais informações sobre custo?" → intent=greeting, mas deve converter para price_inquiry
 * 2. "E qual seria os valores?" → intent=greeting, mas deve converter para price_inquiry
 * 3. "Posso ter mais informações sobre isso?" → vago, mas se tem "informações" = handoff
 * 4. "estou aqui na frente mas ninguém atende" → intent=acknowledgment, mas deve converter para patient_arrived
 *
 * Fix: coerceBusinessIntent já funciona para price_inquiry + patient_arrived.
 * P0.1 expande para outros business contexts: agendamento, serviços mencionados, etc.
 */

import { describe, it, expect } from "vitest";
import {
  buildEvaluationDepositClarification,
  coerceBusinessIntent,
  didAgentAskToShowAvailability,
  extractExplicitPreferredDateFromText,
  findLeadMessageRepeat,
  isEvaluationPriceRequest,
  isShortAffirmativeReply,
  normalizeSchedulingIntentForMissingPendingOffer,
  shouldResumeManualTakeoverForScheduling,
  withDeterministicSlotPreferenceFallback,
} from "@/core/pipeline/ConversationOrchestrator";
import type { SlotPreference } from "@/core/intelligence/IntentClassifier";
import type { Treatment } from "@/domain/entities/treatment";

describe("P0.1 — Guard Anti-Saudação-Genérica", () => {
  const mockTreatments: Treatment[] = [
    { id: "1", name: "Lentes de Resina", aliases: ["lentes", "facetas"], basePrice: 1500000 } as unknown as Treatment,
    { id: "2", name: "Manutenção", aliases: ["manutencao"], basePrice: 40000 } as unknown as Treatment,
    { id: "3", name: "Agendamento", aliases: [], basePrice: 0 } as unknown as Treatment,
  ];

  describe("A9 — reset limpa memória de repetição", () => {
    it("não trata mensagem como repetida quando o histórico pós-reset só contém a mensagem atual", () => {
      const current = {
        author: "lead" as const,
        body: "Olá! Quero saber como posso transformar meu sorriso com as lentes de resina?",
        sentAt: new Date("2026-07-18T08:38:05.000Z"),
      };

      expect(
        findLeadMessageRepeat({
          currentBody: current.body,
          history: [current],
          now: new Date("2026-07-18T08:38:10.000Z").getTime(),
        }),
      ).toBeNull();
    });
  });

  describe("F1 — Pergunta de preço com greeting", () => {
    it("deve converter 'Olá! Posso ter mais informações sobre custo?' de greeting → price_inquiry", () => {
      const result = coerceBusinessIntent({
        message: "Olá! Posso ter mais informações sobre custo?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("price_inquiry");
    });

    it("deve converter 'E qual seria os valores?' de greeting → price_inquiry", () => {
      const result = coerceBusinessIntent({
        message: "E qual seria os valores?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("price_inquiry");
    });

    it("deve converter 'Quanto custa uma lente?' de greeting → price_inquiry", () => {
      const result = coerceBusinessIntent({
        message: "Quanto custa uma lente?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("price_inquiry");
    });
  });

  describe("F8 — Lead na porta com acknowledgment", () => {
    it("deve converter 'estou aqui na frente mas ninguém atende' de acknowledgment → patient_arrived", () => {
      const result = coerceBusinessIntent({
        message: "estou aqui na frente mas ninguém atende",
        intent: "acknowledgment",
        treatments: mockTreatments,
        isClinicSegment: true,
      });
      expect(result).toBe("patient_arrived");
    });

    it("deve converter 'cheguei' de acknowledgment → patient_arrived", () => {
      const result = coerceBusinessIntent({
        message: "cheguei",
        intent: "acknowledgment",
        treatments: mockTreatments,
        isClinicSegment: true,
      });
      expect(result).toBe("patient_arrived");
    });
  });

  describe("Pergunta de agendamento (P0.1 EXPANSÃO)", () => {
    it("deve converter 'quero agendar uma consulta' de greeting → book_appointment", () => {
      const result = coerceBusinessIntent({
        message: "quero agendar uma consulta",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("book_appointment");
    });

    it("deve converter 'Posso agendar um horário?' de greeting → book_appointment", () => {
      const result = coerceBusinessIntent({
        message: "Posso agendar um horário?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("book_appointment");
    });

    it("deve converter 'Qual seu horário de atendimento?' de greeting → general_question", () => {
      const result = coerceBusinessIntent({
        message: "Qual seu horário de atendimento?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("general_question");
    });
  });

  describe("Preferência de data explícita", () => {
    const emptyPreference: SlotPreference = {
      preferredDate: null,
      preferredPeriod: null,
      preferredTime: null,
      slotChoice: null,
      identifiedTreatment: null,
      ambiguousTreatmentMatches: null,
    };

    it("extrai 'dia 29' de forma determinística quando o LLM não preencher preferredDate", () => {
      expect(extractExplicitPreferredDateFromText("Dia 29")).toBe("dia 29");
      expect(extractExplicitPreferredDateFromText("Pode ser 29/07")).toBe("29/07");
      expect(
        withDeterministicSlotPreferenceFallback("Quero agendar dia 29", emptyPreference).preferredDate,
      ).toBe("dia 29");
    });

    it("normaliza preferredDate numérico retornado pelo LLM", () => {
      expect(
        withDeterministicSlotPreferenceFallback("Quero agendar dia 29", {
          ...emptyPreference,
          preferredDate: "29",
        }).preferredDate,
      ).toBe("dia 29");
    });

    it("normaliza preferredDate com ponto retornado pelo LLM", () => {
      expect(
        withDeterministicSlotPreferenceFallback("Dia 29", {
          ...emptyPreference,
          preferredDate: "29.07",
        }).preferredDate,
      ).toBe("29/07");
    });

    it("não trata confirm_slot sem oferta pendente como confirmação quando a mensagem tem data", () => {
      const preference = withDeterministicSlotPreferenceFallback("Dia 29", emptyPreference);
      expect(
        normalizeSchedulingIntentForMissingPendingOffer("confirm_slot", preference, "Dia 29", false),
      ).toBe("check_availability");
    });

    it("mantém confirm_slot quando há oferta pendente ativa", () => {
      const preference = withDeterministicSlotPreferenceFallback("Dia 29", emptyPreference);
      expect(
        normalizeSchedulingIntentForMissingPendingOffer("confirm_slot", preference, "Dia 29", true),
      ).toBe("confirm_slot");
    });

    it("não deixa confirm_slot sem oferta pendente virar pergunta circular quando há pedido de reserva", () => {
      expect(
        normalizeSchedulingIntentForMissingPendingOffer(
          "confirm_slot",
          emptyPreference,
          "quero reservar um horario",
          false,
        ),
      ).toBe("check_availability");
    });

    it("transforma 'sim' após pergunta de horários em busca de disponibilidade", () => {
      expect(
        normalizeSchedulingIntentForMissingPendingOffer(
          "confirm_slot",
          emptyPreference,
          "Sim",
          false,
          "Posso te mostrar os horários disponíveis agora?",
        ),
      ).toBe("check_availability");
    });

    it("não transforma confirmação curta quando o agente não perguntou por horários", () => {
      expect(
        normalizeSchedulingIntentForMissingPendingOffer(
          "confirm_slot",
          emptyPreference,
          "Bl2",
          false,
          "Qual das técnicas chamou mais a sua atenção?",
        ),
      ).toBe("confirm_slot");
    });

    it("detecta pergunta anterior de disponibilidade e resposta afirmativa curta", () => {
      expect(didAgentAskToShowAvailability("Posso ver os horários disponíveis para sua avaliação?")).toBe(true);
      expect(isShortAffirmativeReply("sim")).toBe(true);
      expect(isShortAffirmativeReply("BL2")).toBe(false);
    });

    it("mantém número órfão fora do fluxo de slots para o fallback de menu lidar", () => {
      expect(
        normalizeSchedulingIntentForMissingPendingOffer(
          "confirm_slot",
          { ...emptyPreference, slotChoice: 1 },
          "1",
          false,
        ),
      ).toBe("confirm_slot");
    });
  });

  describe("Sinal de reserva não é preço de avaliação", () => {
    it("detecta pergunta sobre valor da avaliação", () => {
      expect(isEvaluationPriceRequest("Qual valor da avaliação?")).toBe(true);
      expect(isEvaluationPriceRequest("Ver valores das lentes")).toBe(false);
    });

    it("responde R$30 como sinal de reserva, não como preço da consulta", () => {
      const reply = buildEvaluationDepositClarification(3000);
      expect(reply).toContain("sinal de R$ 30");
      expect(reply).toContain("garante a reserva");
      expect(reply).not.toContain("custa");
    });
  });

  describe("F4 — Pausa manual não engole pedido explícito de agenda", () => {
    it("retoma pausa manual quando o lead pede reserva", () => {
      expect(shouldResumeManualTakeoverForScheduling("quero reservar um horario", null)).toBe(true);
    });

    it("não retoma takeover com TTL ainda vigente", () => {
      expect(
        shouldResumeManualTakeoverForScheduling(
          "quero reservar um horario",
          new Date("2026-07-18T18:00:00.000Z"),
        ),
      ).toBe(false);
    });

    it("não retoma pausa manual por mensagem genérica", () => {
      expect(shouldResumeManualTakeoverForScheduling("ok, obrigado", null)).toBe(false);
    });
  });

  describe("F5 — Pergunta de manutenção (P0.2)", () => {
    it("deve converter 'Quanto custa manutenção?' de greeting → needs_human", () => {
      const result = coerceBusinessIntent({
        message: "Quanto custa manutenção?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("needs_human");
    });

    it("deve converter 'Quanto é o reparo?' de greeting → needs_human", () => {
      const result = coerceBusinessIntent({
        message: "Quanto é o reparo?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("needs_human");
    });

    it("deve converter 'Qual o preço do polimento?' de greeting → needs_human", () => {
      const result = coerceBusinessIntent({
        message: "Qual o preço do polimento?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("needs_human");
    });
  });

  describe("Saudação pura (não deve converter)", () => {
    it("deve manter 'Oi tudo bem?' como greeting", () => {
      const result = coerceBusinessIntent({
        message: "Oi tudo bem?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("greeting");
    });

    it("deve manter 'Olá!' como greeting", () => {
      const result = coerceBusinessIntent({
        message: "Olá!",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      expect(result).toBe("greeting");
    });
  });
});
