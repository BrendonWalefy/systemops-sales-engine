/**
 * Default de plataforma da janela de agrupamento de rajadas. Vive aqui, e não
 * no orquestrador, porque o resolver abaixo precisa dele e o caminho inverso
 * criaria ciclo de import. O orquestrador reexporta para não quebrar quem já
 * importava de lá. Origem do número: ver MessageDebounceDefault.test.ts.
 */
export const DEFAULT_MESSAGE_DEBOUNCE_MS = 15_000;

/**
 * Quanto esperar antes de responder, agrupando a rajada do lead.
 *
 * O valor de plataforma é decisão medida e vale sempre em produção. As duas
 * únicas saídas para zero são: reprocessar uma mensagem específica (a rajada já
 * aconteceu), e o sandbox de replay — onde 15s por turno multiplicados por
 * centenas de turnos transformam uma validação de minutos em uma de horas.
 *
 * A guarda de produção é explícita e não depende da ordem das condições: se a
 * flag de replay vazar para o runtime de produção, produção vence.
 */
export function resolveMessageDebounceMs(input: {
  isReplayOfMessage: boolean;
  clinicDebounceMs: number | null | undefined;
  /** Aceita process.env e literais de teste sem cast. */
  env: Readonly<Record<string, string | undefined>>;
}): number {
  if (input.isReplayOfMessage) return 0;

  const configured = input.clinicDebounceMs ?? DEFAULT_MESSAGE_DEBOUNCE_MS;
  if (input.env.VERCEL_ENV === "production") return configured;
  if (input.env.E2E_REPLAY_MODE === "true") return 0;

  return configured;
}

/**
 * Quanto ainda falta da janela de agrupamento no momento em que o worker
 * finalmente pegou o job. A janela é medida desde o recebimento da mensagem;
 * o schedule (run_at = recebimento + janela padrão) faz a maior parte da espera
 * dormir na fila, sem prender workers vivos. Aqui apenas o resíduo escapa para
 * um setTimeout — clampado em zero para não estender além do configurado nem
 * dormir por causa de relógios diferentes entre nó de recebimento e worker.
 */
export function computeResidualDebounceMs(input: {
  debounceMs: number;
  receivedAt: Date;
  now: Date;
}): number {
  if (input.debounceMs <= 0) return 0;
  const elapsed = input.now.getTime() - input.receivedAt.getTime();
  if (elapsed <= 0) return input.debounceMs;
  return Math.max(0, input.debounceMs - elapsed);
}
