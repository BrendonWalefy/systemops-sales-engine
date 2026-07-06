import { describe, expect, it } from "vitest";
import { calculateHealthScore, resolveSafetyMode } from "@/application/channel-safety/reputation-engine";

describe("Reputation Engine — calculateHealthScore", () => {
  it("retorna 100 se nenhum outbound foi enviado", () => {
    expect(calculateHealthScore({ optOutCount: 0, outboundSent: 0, inboundReceived: 0 })).toBe(100);
    expect(calculateHealthScore({ optOutCount: 5, outboundSent: 0, inboundReceived: 10 })).toBe(100);
  });

  it("retorna 100 para comportamento perfeito (inbound alto, sem opt-out)", () => {
    expect(calculateHealthScore({ optOutCount: 0, outboundSent: 10, inboundReceived: 5 })).toBe(100); // 50% response rate
  });

  it("aplica penalidade por baixa taxa de resposta", () => {
    // Menor que 30%, mas maior que 15% -> -15 pontos
    expect(calculateHealthScore({ optOutCount: 0, outboundSent: 10, inboundReceived: 2 })).toBe(85);

    // Menor que 15% -> -30 pontos
    expect(calculateHealthScore({ optOutCount: 0, outboundSent: 10, inboundReceived: 1 })).toBe(70);
  });

  it("aplica penalidade por opt-outs", () => {
    // 1 opt-out em 20 sent (5% opt-out rate) => 5% * 500 = 25 pontos de penalidade
    // InboundReceived alto para evitar penalidade de resposta
    expect(calculateHealthScore({ optOutCount: 1, outboundSent: 20, inboundReceived: 10 })).toBe(75);

    // 1 opt-out em 10 sent (10% opt-out rate) => max 50 pontos de penalidade
    expect(calculateHealthScore({ optOutCount: 1, outboundSent: 10, inboundReceived: 5 })).toBe(50);
  });

  it("acumula penalidades respeitando o limite mínimo de 0 e máximo de 100", () => {
    // Opt-out alto + resposta baixa
    expect(calculateHealthScore({ optOutCount: 10, outboundSent: 10, inboundReceived: 0 })).toBe(20); // 100 - 50 - 30 = 20
    expect(calculateHealthScore({ optOutCount: 100, outboundSent: 10, inboundReceived: 0 })).toBe(20);
  });
});

describe("Reputation Engine — resolveSafetyMode", () => {
  it("determina modo baseado no score", () => {
    expect(resolveSafetyMode(100)).toBe("normal");
    expect(resolveSafetyMode(80)).toBe("normal");
    expect(resolveSafetyMode(79)).toBe("atencao");
    expect(resolveSafetyMode(50)).toBe("atencao");
    expect(resolveSafetyMode(49)).toBe("cooling");
    expect(resolveSafetyMode(20)).toBe("cooling");
    expect(resolveSafetyMode(19)).toBe("frozen");
    expect(resolveSafetyMode(0)).toBe("frozen");
  });
});
