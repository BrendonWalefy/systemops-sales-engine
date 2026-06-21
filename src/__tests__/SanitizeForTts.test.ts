// Normalização de texto antes da síntese de voz (sanitizeForTts).
// Cobre a expansão de horários, valores, datas, abreviações/símbolos e
// a remoção de markdown/emojis — para o TTS não pronunciar nada errado nem em inglês.

import { describe, it, expect } from "vitest";
import { sanitizeForTts } from "@/infrastructure/adapters/ai/tts/openai-tts-gateway";

describe("sanitizeForTts", () => {
  describe("horários", () => {
    it("expande 'h' abreviado para 'horas'", () => {
      expect(sanitizeForTts("sua consulta é às 14h")).toBe("sua consulta é às 14 horas");
    });

    it("expande hora com minutos (14h30)", () => {
      expect(sanitizeForTts("às 14h30")).toBe("às 14 horas e 30 minutos");
    });

    it("expande formato com dois-pontos (9:00)", () => {
      expect(sanitizeForTts("chegue 9:00")).toBe("chegue 9 horas");
    });

    it("expande 9:30 com minutos", () => {
      expect(sanitizeForTts("9:30")).toBe("9 horas e 30 minutos");
    });

    it("usa singular para 1 hora", () => {
      expect(sanitizeForTts("1h")).toBe("1 hora");
    });

    it("não trata número fora da faixa de horas (25h)", () => {
      expect(sanitizeForTts("25h")).toBe("25h");
    });
  });

  describe("valores e datas (regressão)", () => {
    it("converte R$ por extenso", () => {
      expect(sanitizeForTts("R$2.500")).toBe("2.500 reais");
    });

    it("converte data abreviada", () => {
      expect(sanitizeForTts("dia 22/06")).toBe("dia 22 de junho");
    });
  });

  describe("abreviações e símbolos", () => {
    it("expande Dr. e Dra.", () => {
      expect(sanitizeForTts("Dr. João e Dra. Ana")).toBe("doutor João e doutora Ana");
    });

    it("não estraga nomes que começam com 'Dr' sem ponto", () => {
      expect(sanitizeForTts("Drummond")).toBe("Drummond");
    });

    it("expande porcentagem", () => {
      expect(sanitizeForTts("50% de desconto")).toBe("50 por cento de desconto");
    });

    it("expande o símbolo de número, sem afetar a palavra 'no'", () => {
      expect(sanitizeForTts("sala nº 5 no prédio")).toBe("sala número 5 no prédio");
    });

    it("expande & para 'e'", () => {
      expect(sanitizeForTts("Costa & Silva")).toBe("Costa e Silva");
    });

    it("expande ordinais masculino e feminino", () => {
      expect(sanitizeForTts("1º andar, 2ª via")).toBe("primeiro andar, segunda via");
    });
  });

  describe("markdown e emojis (regressão)", () => {
    it("remove markdown e emojis", () => {
      expect(sanitizeForTts("*Olá* 😊")).toBe("Olá");
    });
  });
});
