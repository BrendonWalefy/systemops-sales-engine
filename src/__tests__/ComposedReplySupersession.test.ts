// Descarte de resposta já composta quando o lead falou de novo.
//
// O debounce cobre a janela antes do trabalho; o guard pós-classificação cobre a
// janela do LLM. Sobra a janela entre classificar e entregar. Descartar aí é
// seguro para resposta de texto puro e PERIGOSO quando o turno mexeu em agenda:
// uma oferta descartada deixa slot reservado que o lead nunca viu.

import { describe, expect, it } from "vitest";
import { shouldDiscardComposedReply } from "@/core/pipeline/composed-reply-supersession";

const base = {
  isReplayOfMessage: false,
  replyIsCannedOpener: false,
  turnTouchedScheduling: false,
  latestLeadMessageId: "msg-2",
  incomingMessageId: "msg-1",
};

describe("shouldDiscardComposedReply", () => {
  it("descarta resposta de texto puro quando o lead mandou outra mensagem", () => {
    expect(shouldDiscardComposedReply(base)).toBe(true);
  });

  it("mantém a resposta quando o turno reservou ou ofertou horário", () => {
    // Descartar aqui deixaria a reserva órfã: o slot fica preso e o lead nunca
    // soube que existia.
    expect(shouldDiscardComposedReply({ ...base, turnTouchedScheduling: true })).toBe(false);
  });

  it("descarta a abertura enlatada mesmo com agenda tocada", () => {
    // Comportamento que já existia: o starter é texto puro por construção.
    expect(shouldDiscardComposedReply({
      ...base,
      replyIsCannedOpener: true,
      turnTouchedScheduling: true,
    })).toBe(true);
  });

  it("não descarta nada quando não chegou mensagem nova", () => {
    expect(shouldDiscardComposedReply({ ...base, latestLeadMessageId: "msg-1" })).toBe(false);
    expect(shouldDiscardComposedReply({ ...base, latestLeadMessageId: null })).toBe(false);
  });

  it("nunca descarta ao reprocessar uma mensagem específica", () => {
    // O reprocesso é deliberado: a rajada já aconteceu e o operador quer a saída.
    expect(shouldDiscardComposedReply({ ...base, isReplayOfMessage: true })).toBe(false);
  });
});
