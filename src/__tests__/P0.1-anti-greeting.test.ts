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
import { coerceBusinessIntent } from "@/core/pipeline/ConversationOrchestrator";
import type { Treatment } from "@/domain/entities/treatment";

describe("P0.1 — Guard Anti-Saudação-Genérica", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockTreatments: Treatment[] = [
    { id: "1", name: "Lentes de Resina", aliases: ["lentes", "facetas"], basePrice: 1500000 } as unknown as Treatment,
    { id: "2", name: "Manutenção", aliases: ["manutencao"], basePrice: 40000 } as unknown as Treatment,
    { id: "3", name: "Agendamento", aliases: [], basePrice: 0 } as unknown as Treatment,
  ];

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

    it("deve converter 'Qual seu horário de atendimento?' de greeting → price_inquiry ou book_appointment", () => {
      const result = coerceBusinessIntent({
        message: "Qual seu horário de atendimento?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
      });
      // Pode ser book_appointment (contém "horario")
      expect(["book_appointment", "price_inquiry"]).toContain(result);
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
