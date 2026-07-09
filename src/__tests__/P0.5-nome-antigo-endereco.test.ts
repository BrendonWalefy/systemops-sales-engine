/**
 * P0.5 — Nome antigo da clínica e mudança de endereço
 *
 * Auditoria pós-deploy P0.1-P0.6 (08/07/2026, conversas reais Vitalli em shadow
 * mode) encontrou o P0.5 completamente inoperante: 5+ leads mencionaram "Dental
 * Luxe" (nome antigo da clínica) e todos receberam a saudação genérica de
 * abertura, ignorando por completo a menção — exatamente o comportamento que
 * P0.5 deveria prevenir (Julie Dorna, Thiago Jun Saito, Jeny, Jose Mota, e um
 * lead sem nome capturado, todos com a mensagem "Olá! Tenho interesse e queria
 * mais informações sobre a Dental Luxe, por favor.").
 *
 * Causa raiz (duas falhas combinadas):
 * 1. coerceBusinessIntent nunca chamava isClinicNameOrAddressChangeQuestion —
 *    o intent permanecia "greeting" e shouldShowInitialMenu/shouldSendConciergeStarter
 *    capturavam a mensagem ANTES que o contexto de nome antigo (calculado só
 *    depois, no switch principal) tivesse qualquer chance de ser usado.
 * 2. isClinicNameOrAddressChangeQuestion exigia uma keyword de "mudança"
 *    ("mudaram", "mudou", "eram", "era", "nome", "endereço") mesmo quando o
 *    nome antigo já estava mencionado diretamente na mensagem — "queria
 *    informações sobre a Dental Luxe" não contém nenhuma dessas palavras.
 *
 * Achado secundário: Rafaela Carvalho perguntou "Vcs trocaram de endereço?"
 * e a IA respondeu "sempre esteve localizada" — afirmação categórica que a
 * política não necessariamente sustenta. A causa era a mesma: "trocaram" não
 * estava na lista de keywords (só tinha "mudaram"/"mudou").
 */

import { describe, it, expect } from "vitest";
import { coerceBusinessIntent, extractPreviousClinicInfo } from "@/core/pipeline/ConversationOrchestrator";
import type { Treatment } from "@/domain/entities/treatment";

describe("P0.5 — Nome antigo da clínica / mudança de endereço", () => {
  const mockTreatments: Treatment[] = [
    { id: "1", name: "Lentes de Resina", aliases: ["lentes", "facetas"], basePrice: 1500000 } as unknown as Treatment,
  ];

  // Política comercial REAL em produção (após correção do endereço antigo —
  // a clínica mudou de bairro, não só de nome: Sabará/Interlagos → Santo Amaro).
  const VITALLI_POLICY = `Éramos Dental Luxe, hoje somos Clínica Vitalli. Antes ficávamos no bairro Sabará, próximo a Interlagos; hoje estamos na Avenida Adolfo Pinheiro, em Santo Amaro.`;

  describe("extractPreviousClinicInfo — endereço antigo vs. atual", () => {
    it("extrai o endereço ANTIGO (Sabará), não o atual (Adolfo Pinheiro)", () => {
      // Bug real: a regex de fallback pega o PRIMEIRO "Avenida/Av." do texto,
      // que é o endereço ATUAL ("hoje estamos na Avenida Adolfo Pinheiro") —
      // sem o padrão "ficávamos", isso capturava "Adolfo Pinheiro" como se
      // fosse o endereço anterior, quando na verdade a clínica ficava em
      // outro bairro (Sabará, próximo a Interlagos) antes da mudança.
      const info = extractPreviousClinicInfo(VITALLI_POLICY);
      expect(info.previousClinicName).toBe("Dental Luxe");
      expect(info.previousAddress).toContain("Sabará");
      expect(info.previousAddress).not.toContain("Adolfo Pinheiro");
    });

    it("fallback para padrão 'Avenida/Av.' quando não há 'ficávamos' no texto", () => {
      const info = extractPreviousClinicInfo(
        "Éramos Dental Luxe. Ficamos na Avenida Antiga, 123.",
      );
      expect(info.previousAddress).toBe("Antiga");
    });

    it("retorna vazio quando a política não menciona nome nem endereço antigo", () => {
      const info = extractPreviousClinicInfo("Trabalhamos com lentes de resina.");
      expect(info.previousClinicName).toBeUndefined();
      expect(info.previousAddress).toBeUndefined();
    });
  });

  describe("Menção direta ao nome antigo (sem palavra de 'mudança')", () => {
    const casosReais = [
      "Olá! Tenho interesse e queria mais informações sobre a Dental Luxe, por favor.",
      "Vim através da Dental Luxe",
      "Vocês são a Dental Luxe?",
    ];

    for (const message of casosReais) {
      it(`converte "${message}" de greeting → general_question (não fica preso em greeting)`, () => {
        const result = coerceBusinessIntent({
          message,
          intent: "greeting",
          treatments: mockTreatments,
          isClinicSegment: false,
          commercialPolicy: VITALLI_POLICY,
        });
        expect(result).toBe("general_question");
      });
    }

    it("também converte quando o intent classificado foi acknowledgment", () => {
      const result = coerceBusinessIntent({
        message: "Tenho interesse na Dental Luxe",
        intent: "acknowledgment",
        treatments: mockTreatments,
        isClinicSegment: false,
        commercialPolicy: VITALLI_POLICY,
      });
      expect(result).toBe("general_question");
    });
  });

  describe("Pergunta sobre mudança de endereço", () => {
    it('converte "Vcs trocaram de endereço? Ou sempre foi esse mesmo?" (caso real Rafaela)', () => {
      const result = coerceBusinessIntent({
        message: "Vcs trocaram de endereço? Ou sempre foi esse mesmo?",
        intent: "general_question",
        treatments: mockTreatments,
        isClinicSegment: false,
        commercialPolicy: VITALLI_POLICY,
      });
      // Já não era greeting/acknowledgment/unclear, então coerceBusinessIntent
      // não altera — o teste real de detecção fica em isClinicNameOrAddressChangeQuestion,
      // mas via greeting confirmamos que o guard reconhece "trocaram" como keyword.
      expect(result).toBe("general_question");
    });

    it('reconhece "trocaram de endereço" partindo de greeting', () => {
      const result = coerceBusinessIntent({
        message: "Boa tarde, vocês trocaram de endereço?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
        commercialPolicy: VITALLI_POLICY,
      });
      expect(result).toBe("general_question");
    });

    it('reconhece "mudaram de endereço" (keyword original)', () => {
      const result = coerceBusinessIntent({
        message: "Vocês mudaram de endereço?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
        commercialPolicy: VITALLI_POLICY,
      });
      expect(result).toBe("general_question");
    });
  });

  describe("Não deve disparar em mensagens sem relação com nome antigo/endereço", () => {
    it('"Olá! Posso ter mais informações sobre isso?" continua greeting genérico', () => {
      const result = coerceBusinessIntent({
        message: "Olá! Posso ter mais informações sobre isso?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
        commercialPolicy: VITALLI_POLICY,
      });
      expect(result).toBe("greeting");
    });

    it("sem commercialPolicy, não quebra e mantém greeting", () => {
      const result = coerceBusinessIntent({
        message: "Olá! Tenho interesse na Dental Luxe",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
        commercialPolicy: null,
      });
      expect(result).toBe("greeting");
    });

    it('"Qual o endereço de vocês?" sozinho (sem keyword de mudança) não força general_question via este guard', () => {
      // Nota: isso já cai em general_question por outros caminhos do pipeline
      // (pergunta geral padrão), mas o guard específico de P0.5 exige sinal de
      // mudança para não disparar em toda pergunta simples de endereço.
      const result = coerceBusinessIntent({
        message: "Qual o endereço de vocês?",
        intent: "greeting",
        treatments: mockTreatments,
        isClinicSegment: false,
        commercialPolicy: VITALLI_POLICY,
      });
      expect(result).toBe("greeting");
    });
  });
});
