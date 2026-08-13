/**
 * Decide se uma resposta já composta deve ser jogada fora porque o lead voltou
 * a escrever antes da entrega.
 *
 * A janela existe em qualquer valor de debounce: o debounce agrupa antes de o
 * trabalho começar, e o guard pós-classificação cobre a chamada do LLM. Entre
 * classificar e entregar ainda cabe uma mensagem — e é aí que nasce o
 * "respondendo uma a uma" que o debounce longo tentava esconder.
 *
 * A linha de segurança é o efeito externo: descartar texto puro não custa nada,
 * descartar um turno que reservou ou ofertou horário deixa slot preso que o lead
 * nunca viu. Por isso agenda tocada mantém a resposta — exceto na abertura
 * enlatada, que é texto fixo por construção e já era descartada antes desta
 * regra existir.
 */
export function shouldDiscardComposedReply(input: {
  isReplayOfMessage: boolean;
  replyIsCannedOpener: boolean;
  turnTouchedScheduling: boolean;
  latestLeadMessageId: string | null;
  incomingMessageId: string;
}): boolean {
  if (input.isReplayOfMessage) return false;
  if (!input.latestLeadMessageId) return false;
  if (input.latestLeadMessageId === input.incomingMessageId) return false;
  if (input.replyIsCannedOpener) return true;

  return !input.turnTouchedScheduling;
}
