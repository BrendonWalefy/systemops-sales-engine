// Default de plataforma para a janela de agrupamento de rajadas.
//
// Rajada (2+ mensagens do lead em sequência) é comportamento do canal, não política
// de clínica: o gap mediano dentro de uma rajada é 10s tanto na Vitalli quanto na
// Ximendes, com distribuições quase idênticas (n=1.174 pares, produção).
//
// Antes o valor era `?? 5000` repetido em 4 pontos do ConversationOrchestrator —
// default global de fato, mas duplicado e sem origem documentada. Este teste existe
// para que a origem não se perca de novo.
//
// Ver docs/architecture/current.md.

import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_DEBOUNCE_MS } from "@/core/pipeline/ConversationOrchestrator";

// Gap mediano medido entre mensagens consecutivas dentro de uma rajada.
const MEDIAN_BURST_GAP_MS = 10_000;

describe("default de plataforma do debounce de mensagens", () => {
  it("cobre o gap mediano real da rajada", () => {
    // Abaixo disso o agrupamento perde mais da metade dos pares — era o caso do
    // valor antigo (5s) e do override da Vitalli (7s), que cobriam ~40%.
    expect(DEFAULT_MESSAGE_DEBOUNCE_MS).toBeGreaterThanOrEqual(MEDIAN_BURST_GAP_MS);
  });

  it("não passa de 30s, para não somar demais à latência de processamento", () => {
    // A mensagem já espera o tick do message-worker (até 60s). O debounce soma a
    // essa espera; 30s seria metade de um ciclo só agrupando.
    expect(DEFAULT_MESSAGE_DEBOUNCE_MS).toBeLessThanOrEqual(30_000);
  });

  it("está no valor decidido pela medição (15s ≈ 67% de cobertura)", () => {
    expect(DEFAULT_MESSAGE_DEBOUNCE_MS).toBe(15_000);
  });
});
