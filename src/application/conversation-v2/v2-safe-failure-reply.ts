import type { V2SafeFailureReason } from "@/application/conversation-v2/v2-live-conversation-handler";

/**
 * Resposta determinística para o turno que falha antes de qualquer efeito.
 *
 * O contrato da V2 previa resposta segura ou handoff quando o turno falha antes
 * de escrever; o que acontecia era silêncio — o lead mandava mensagem e não
 * recebia nada. Silêncio é pior que erro: o lead não sabe se foi recebido e a
 * operação não vê o problema.
 *
 * O texto não promete preço, horário nem retorno humano, porque nada disso foi
 * decidido. Ele confirma recebimento e convida a reenviar, que é a única ação
 * verdadeira disponível neste ponto.
 */
export const V2_SAFE_FAILURE_REPLY_TEXT =
  "Recebi sua mensagem! Tive uma instabilidade para processar agora. "
  + "Pode reenviar, por favor?";

export function shouldEnqueueSafeFailureReply(input: Readonly<{
  reason: V2SafeFailureReason;
  effectAttempted: boolean;
  replyAlreadyEnqueued: boolean;
  configurationResolved: boolean;
}>): boolean {
  // A outbox é o próprio caminho de entrega: se ela falhou, tentar de novo aqui
  // repetiria a falha e mascararia o erro que precisa subir para retry.
  if (input.reason === "outbox_failed") return false;
  // Efeito tentado significa que uma escrita real pode ter acontecido. Uma cópia
  // genérica poderia contradizer o que o sistema de fato executou.
  if (input.effectAttempted) return false;
  if (input.replyAlreadyEnqueued) return false;
  // Sem configuração resolvida não há canal, voz nem binding para entregar.
  return input.configurationResolved;
}
