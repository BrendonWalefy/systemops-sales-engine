/**
 * Política de pausa de reengajamento proativo da clínica.
 *
 * "Reengajamento" = follow-up e recovery — mensagens iniciadas pela clínica
 * para contatos que não responderam ou ficaram silenciosos.
 *
 * Quando `automatedReengagementPaused = true`:
 *   - follow-up-dispatcher NÃO enfileira mensagens.
 *   - recovery-campaign NÃO enfileira mensagens.
 *   - appointment-reminder NÃO é afetado — é aviso de compromisso que o próprio
 *     lead marcou; suprimi-lo seria prejudicial ao lead (e à clínica), não
 *     proteção de canal. O reminder já é agendado para a hora certa e é isento
 *     de quiet hours e opt-out pelo Safety Gate.
 *   - Respostas a inbound (reply) NÃO são afetadas — o lead acabou de falar,
 *     bloquear silenciaria o atendimento conversational-first.
 *
 * Uso típico: clínicas novas em risco (ex: Vitalli) entram em modo reply-only
 * durante as primeiras semanas, depois o dono ou o owner desbloqueiam gradualmente.
 */

export type ClinicReengagementToggle = {
  automatedReengagementPaused: boolean;
};

/**
 * Retorna `true` quando o reengajamento proativo está pausado para a clínica.
 *
 * Função pura — sem side-effects, testável sem mock de banco.
 */
export function isReengagementPaused(clinic: ClinicReengagementToggle): boolean {
  return clinic.automatedReengagementPaused === true;
}
