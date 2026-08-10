/**
 * Escada de backoff do poll da inbox: começa rápido (15s) e relaxa até um
 * teto de 60s enquanto a versão materializada não muda. A Fase 3B reaproveita
 * esta mesma função como fallback de polling quando o realtime falha.
 */
const LADDER_MS = [15_000, 30_000, 60_000] as const;

export function nextPollDelayMs(consecutiveUnchanged: number): number {
  const index = Math.min(Math.max(consecutiveUnchanged, 0), LADDER_MS.length - 1);
  return LADDER_MS[index];
}
