import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_AI_BUDGET_USD_MICROS,
  evaluateBudget,
  resolveDailyBudgetUsdMicros,
} from "@/application/reactivation/cost-guard";
import { estimateAiCostUsdMicros } from "@/application/services/cost-estimator";

const originalBudget = process.env.REACTIVATION_DAILY_BUDGET_USD_MICROS;

afterEach(() => {
  if (originalBudget === undefined) {
    delete process.env.REACTIVATION_DAILY_BUDGET_USD_MICROS;
  } else {
    process.env.REACTIVATION_DAILY_BUDGET_USD_MICROS = originalBudget;
  }
});

describe("Motor de Reativação — teto de custo diário", () => {
  it("libera enquanto o gasto está abaixo do teto", () => {
    expect(evaluateBudget(0, 200_000).allowed).toBe(true);
    expect(evaluateBudget(199_999, 200_000).allowed).toBe(true);
  });

  it("bloqueia ao atingir o teto", () => {
    expect(evaluateBudget(200_000, 200_000).allowed).toBe(false);
    expect(evaluateBudget(500_000, 200_000).allowed).toBe(false);
  });

  it("usa o default quando a env não está definida", () => {
    delete process.env.REACTIVATION_DAILY_BUDGET_USD_MICROS;
    expect(resolveDailyBudgetUsdMicros()).toBe(DEFAULT_DAILY_AI_BUDGET_USD_MICROS);
  });

  it("ignora env inválida em vez de rodar sem teto", () => {
    process.env.REACTIVATION_DAILY_BUDGET_USD_MICROS = "abacaxi";
    expect(resolveDailyBudgetUsdMicros()).toBe(DEFAULT_DAILY_AI_BUDGET_USD_MICROS);

    process.env.REACTIVATION_DAILY_BUDGET_USD_MICROS = "-1";
    expect(resolveDailyBudgetUsdMicros()).toBe(DEFAULT_DAILY_AI_BUDGET_USD_MICROS);
  });

  it("respeita env válida", () => {
    process.env.REACTIVATION_DAILY_BUDGET_USD_MICROS = "50000";
    expect(resolveDailyBudgetUsdMicros()).toBe(50_000);
  });
});

describe("Motor de Reativação — custo estimado por classificação", () => {
  // Sem preço cadastrado, o estimador devolve 0 e o teto nunca é atingido:
  // o motor rodaria sem freio nenhum. Este teste é o alarme contra isso.
  it("estima custo não-zero para o modelo Claude usado pelo motor", () => {
    const custo = estimateAiCostUsdMicros({
      clinicId: "c1",
      provider: "anthropic",
      model: "claude-sonnet-5",
      operation: "lead_outcome_classification",
      inputTokens: 1_500,
      outputTokens: 200,
    });

    // 1500/1M * 3_000_000 + 200/1M * 15_000_000 = 4500 + 3000
    expect(custo).toBe(7_500);
  });

  it("mantém o teto padrão dimensionado para dezenas de leads por dia", () => {
    const custoPorLead = estimateAiCostUsdMicros({
      clinicId: "c1",
      provider: "anthropic",
      model: "claude-sonnet-5",
      operation: "lead_outcome_classification",
      inputTokens: 1_500,
      outputTokens: 200,
    });

    const leadsPorDia = Math.floor(
      DEFAULT_DAILY_AI_BUDGET_USD_MICROS / custoPorLead,
    );
    expect(leadsPorDia).toBeGreaterThanOrEqual(20);
  });
});
