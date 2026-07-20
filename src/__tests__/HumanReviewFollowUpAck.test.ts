// Replay de validação 20/07 (lead Simone): com uma revisão clínica pendente, o
// aviso completo "Recebi sua foto… a automação fica pausada…" foi reenviado a
// CADA mensagem dela — 4 vezes na mesma conversa, incluindo depois de perguntar
// o endereço e o preço da avaliação. Spam num lead de altíssima intenção.
//
// A trava em si está correta e não muda: mensagens posteriores não passam pelo
// classificador nem reabrem agenda/pipeline antes da decisão humana. O que muda
// é só o texto devolvido ao lead a partir da segunda vez.

import { describe, it, expect } from "vitest";
import { shouldSendShortReviewAck } from "@/core/pipeline/ConversationOrchestrator";
import type { Message } from "@/domain/entities/conversation";

let seq = 0;
const msg = (author: Message["author"], intent?: string | null): Message => ({
  id: `m${++seq}`,
  conversationId: "conv-1",
  author,
  body: "…",
  sentAt: new Date(2026, 6, 20, 12, seq),
  externalId: null,
  intent: intent ?? null,
});

describe("shouldSendShortReviewAck", () => {
  it("manda o texto completo quando o agente ainda não avisou", () => {
    const history = [msg("lead"), msg("agent", "general_question"), msg("lead")];
    expect(shouldSendShortReviewAck(history)).toBe(false);
  });

  it("manda ack curto quando a última fala do agente já foi o aviso", () => {
    const history = [msg("lead"), msg("agent", "needs_human"), msg("lead")];
    expect(shouldSendShortReviewAck(history)).toBe(true);
  });

  it("segue com ack curto nas mensagens seguintes do lead", () => {
    // Sequência real da Simone: foto → aviso → "Boa tarde" → "Qual o endereço?"
    const history = [
      msg("lead"),
      msg("agent", "needs_human"),
      msg("lead"),
      msg("agent", "needs_human"),
      msg("lead"),
    ];
    expect(shouldSendShortReviewAck(history)).toBe(true);
  });

  it("volta ao texto completo se o agente falou outra coisa depois do aviso", () => {
    // Ex.: revisão decidida, conversa retomada, e mais tarde uma nova foto abre
    // outra revisão — o lead merece a explicação de novo.
    const history = [
      msg("agent", "needs_human"),
      msg("lead"),
      msg("agent", "slots_found"),
      msg("lead"),
    ];
    expect(shouldSendShortReviewAck(history)).toBe(false);
  });

  it("ignora mensagens do lead e do operador ao procurar a última fala do agente", () => {
    const history = [
      msg("agent", "needs_human"),
      msg("lead"),
      msg("clinic_user"),
      msg("lead"),
    ];
    expect(shouldSendShortReviewAck(history)).toBe(true);
  });

  it("manda o texto completo numa conversa sem nenhuma fala do agente", () => {
    expect(shouldSendShortReviewAck([msg("lead")])).toBe(false);
    expect(shouldSendShortReviewAck([])).toBe(false);
  });
});
