// Testa a classificação da resposta do lead ao lembrete D-1 (detectAppointmentConfirmation).
// Cobre os quatro sinais: confirmar presença (yes), remarcar (reschedule),
// cancelar/não comparecer (no) e resposta inconclusiva (ambiguous).

import { describe, it, expect } from "vitest";
import { detectAppointmentConfirmation } from "@/core/pipeline/ConversationOrchestrator";

describe("detectAppointmentConfirmation", () => {
  describe("confirmação de presença (yes)", () => {
    const yesCases = [
      "sim",
      "Sim!",
      "confirmo",
      "Confirmado, estarei lá",
      "ok",
      "beleza",
      "com certeza",
      "vou sim",
      "perfeito, te vejo amanhã",
    ];
    for (const msg of yesCases) {
      it(`classifica "${msg}" como yes`, () => {
        expect(detectAppointmentConfirmation(msg)).toBe("yes");
      });
    }
  });

  describe("remarcação (reschedule)", () => {
    const rescheduleCases = [
      "preciso remarcar",
      "Quero remarcar para outro dia",
      "podemos reagendar?",
      "dá pra mudar o horário?",
      "não posso nesse dia, dá pra remarcar?",
      "infelizmente preciso remarcar",
      "tem outro dia disponível?",
      "consigo trocar o dia?",
      "precisamos adiar a consulta",
    ];
    for (const msg of rescheduleCases) {
      it(`classifica "${msg}" como reschedule`, () => {
        expect(detectAppointmentConfirmation(msg)).toBe("reschedule");
      });
    }
  });

  describe("cancelamento / não comparece (no)", () => {
    const noCases = [
      "não",
      "Não vou poder ir",
      "preciso cancelar",
      "quero cancelar",
      "infelizmente não poderei comparecer",
      "não consigo ir",
      "desmarcar por favor",
    ];
    for (const msg of noCases) {
      it(`classifica "${msg}" como no`, () => {
        expect(detectAppointmentConfirmation(msg)).toBe("no");
      });
    }
  });

  describe("respostas inconclusivas (ambiguous)", () => {
    const ambiguousCases = [
      "oi tudo bem?",
      "qual o endereço da clínica?",
      "obrigado pelo lembrete",
      "vocês atendem convênio?",
    ];
    for (const msg of ambiguousCases) {
      it(`classifica "${msg}" como ambiguous`, () => {
        expect(detectAppointmentConfirmation(msg)).toBe("ambiguous");
      });
    }
  });

  it("prioriza remarcação quando a mensagem combina negativa e pedido de remarcar", () => {
    // 'não posso ir' isolado seria 'no', mas o pedido explícito de remarcar deve vencer
    // para manter o lead no fluxo self-service de rebooking.
    expect(detectAppointmentConfirmation("não vou poder ir, podemos remarcar?")).toBe("reschedule");
  });
});
