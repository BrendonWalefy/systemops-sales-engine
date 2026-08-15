import type { Logger } from "@/infrastructure/logging/logger";

/**
 * Relata a falha do catch de topo do turno para o canal de erro do app.
 *
 * `log.error` é o único canal que encaminha para o Sentry
 * (`infrastructure/logging/logger.ts`), já com `scrubEvent` redigindo telefone,
 * CPF e e-mail e com agrupamento estável por (escopo, evento). Chamar
 * `Sentry.captureException` direto daqui pularia essa redação e criaria um
 * segundo caminho de telemetria para manter.
 *
 * A assinatura é a proteção de privacidade: a função só aceita identificadores.
 * Não existe parâmetro por onde o corpo da conversa, o nome ou o telefone do
 * lead possam entrar — nem por engano de quem chamar depois.
 */
export function buildTurnFailureReport(input: {
  clinicId: string;
  conversationId: string;
  leadId: string;
  messageId: string;
  error: unknown;
  log: Logger;
}): void {
  input.log.error("turn processing failed — silent handoff", input.error, {
    leadId: input.leadId,
    messageId: input.messageId,
  });
}
