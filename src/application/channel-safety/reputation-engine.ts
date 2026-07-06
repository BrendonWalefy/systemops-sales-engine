export type HealthStatsInput = {
  optOutCount: number;
  outboundSent: number;
  inboundReceived: number;
};

export type ChannelSafetyMode = "normal" | "atencao" | "cooling" | "frozen";

/**
 * Calcula o score de saúde do canal baseando-se em estatísticas de opt-out
 * e engajamento das últimas 24 horas.
 *
 * Fórmula:
 *   - Base = 100
 *   - Penalidade de opt-out: Proporcional à taxa de opt-out. 5% de taxa deduz 25 pontos,
 *     10% ou mais deduz o máximo de 50 pontos.
 *   - Penalidade de baixa resposta:
 *       * Taxa de resposta (inbound/outbound) < 15%: -30 pontos.
 *       * Taxa de resposta < 30%: -15 pontos.
 */
export function calculateHealthScore(stats: HealthStatsInput): number {
  if (stats.outboundSent === 0) return 100;

  let score = 100;

  // 1. Penalidade de Opt-out (mais crítico para bloqueios)
  const optOutRate = stats.optOutCount / stats.outboundSent;
  if (optOutRate > 0) {
    const penalty = Math.min(50, Math.round(optOutRate * 500));
    score -= penalty;
  }

  // 2. Penalidade de Engajamento / Resposta
  const responseRate = stats.inboundReceived / stats.outboundSent;
  if (responseRate < 0.15) {
    score -= 30;
  } else if (responseRate < 0.3) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Determina o modo de segurança com base no score de saúde.
 */
export function resolveSafetyMode(score: number): ChannelSafetyMode {
  if (score >= 80) return "normal";
  if (score >= 50) return "atencao";
  if (score >= 20) return "cooling";
  return "frozen";
}
