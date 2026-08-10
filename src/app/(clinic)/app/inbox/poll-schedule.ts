/**
 * Escada de backoff do poll da inbox: começa rápido (15s) e relaxa até um
 * teto de 60s enquanto a versão materializada não muda. A Fase 3B reaproveita
 * esta mesma função como fallback de polling quando o realtime falha.
 */
const LADDER_MS = [15_000, 30_000, 60_000] as const;
const TOP_RUNG_INDEX = LADDER_MS.length - 1;

export function nextPollDelayMs(consecutiveUnchanged: number): number {
  const index = Math.min(Math.max(consecutiveUnchanged, 0), TOP_RUNG_INDEX);
  return LADDER_MS[index];
}

/**
 * Teto de obsolescência.
 *
 * A versão do Inbox só muda quando alguém escreve, mas existe uma classe de
 * transições da tela SEM ESCRITA nenhuma: `isRecoveryCandidate` virando true
 * quando `hoursWaiting >= 2`, um `expiresAt` de estado ou de revisão humana
 * vencendo e tirando a linha de "Pendências", `appointments.endsAt` passando,
 * e o próprio `hoursWaiting`, que é calculado no render. Numa clínica movida
 * a próxima escrita qualquer conserta tudo isso de carona; numa clínica quiet
 * a tela congelava sem limite.
 *
 * O refresh incondicional de 60s que a Task 6 removeu cobria isso pagando
 * `router.refresh()` a cada minuto mesmo sem nada ter mudado. Aqui o poll
 * barato (uma linha indexada) continua governado pela escada; só o refresh
 * caro ganha um piso de frequência.
 */
export const TOP_RUNG_POLLS_BEFORE_FORCED_REFRESH = 4;

const UNCHANGED_POLLS_BEFORE_FORCED_REFRESH =
  TOP_RUNG_INDEX + TOP_RUNG_POLLS_BEFORE_FORCED_REFRESH;

export function shouldForceRefreshAfterUnchangedPolls(consecutiveUnchanged: number): boolean {
  return consecutiveUnchanged >= UNCHANGED_POLLS_BEFORE_FORCED_REFRESH;
}

/**
 * Streak com que o poller recomeça depois de um refresh forçado. Volta ao
 * TOPO da escada, não a zero: zerar reiniciaria o poll em 15s e desfaria o
 * barateamento numa aba ociosa — que é justamente o cenário em que o refresh
 * forçado acabou de acontecer.
 */
export function unchangedStreakAfterForcedRefresh(): number {
  return TOP_RUNG_INDEX;
}

/**
 * Enquanto `document.hidden` o poller não busca nada, então o streak não
 * cresce e o teto acima não corre. Obsolescência com a aba escondida não é
 * observável — o que precisa ser verdade é que a PRIMEIRA renderização que o
 * operador vê ao voltar esteja fresca. Um alt-tab curto não paga refresh;
 * uma aba parada além do degrau de topo paga.
 */
export function shouldForceRefreshAfterHidden(hiddenMs: number): boolean {
  return hiddenMs >= LADDER_MS[TOP_RUNG_INDEX];
}
