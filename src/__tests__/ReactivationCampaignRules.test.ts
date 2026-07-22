import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_SEND_CAP,
  MAX_DAILY_SEND_CAP,
  MIN_DAILY_SEND_CAP,
} from "@/application/reactivation/create-campaign";
import {
  DEFAULT_CAMPAIGN_DRAFT_BUDGET_USD_MICROS,
  DEFAULT_DAILY_AI_BUDGET_USD_MICROS,
  evaluateBudget,
  resolveCampaignDraftBudgetUsdMicros,
  resolveDailyBudgetUsdMicros,
} from "@/application/reactivation/cost-guard";
import { MAX_AUDIENCE_SIZE } from "@/application/reactivation/audience-resolver";
import { estimateAiCostUsdMicros } from "@/application/services/cost-estimator";

const originalCampaign = process.env.REACTIVATION_CAMPAIGN_BUDGET_USD_MICROS;

describe("Motor de Reativação — cap diário de envio da campanha", () => {
  it("mantém o default dentro da faixa permitida", () => {
    expect(DEFAULT_DAILY_SEND_CAP).toBeGreaterThanOrEqual(MIN_DAILY_SEND_CAP);
    expect(DEFAULT_DAILY_SEND_CAP).toBeLessThanOrEqual(MAX_DAILY_SEND_CAP);
  });

  it("o teto por campanha é menor que a audiência máxima — o ramp precisa existir", () => {
    // Se o cap diário pudesse cobrir a audiência inteira, uma campanha grande
    // sairia num único dia e o ramp seria decorativo.
    expect(MAX_DAILY_SEND_CAP).toBeLessThan(MAX_AUDIENCE_SIZE);
  });
});

describe("Motor de Reativação — orçamentos separados", () => {
  it("o orçamento de campanha cobre a audiência máxima inteira", () => {
    // Este é o teste da regressão que apareceu na validação ponta a ponta:
    // com orçamento único (o diário), redigir uma campanha grande parava no meio
    // e a clínica recebia parte dos rascunhos sem entender por quê.
    const custoPorRascunho = estimateAiCostUsdMicros({
      clinicId: "c1",
      provider: "anthropic",
      model: "claude-sonnet-5",
      operation: "reactivation_draft",
      inputTokens: 1_000,
      outputTokens: 150,
    });

    const custoCampanhaCheia = custoPorRascunho * MAX_AUDIENCE_SIZE;
    expect(DEFAULT_CAMPAIGN_DRAFT_BUDGET_USD_MICROS).toBeGreaterThan(custoCampanhaCheia);
  });

  it("o orçamento de campanha é maior que o diário de fundo", () => {
    expect(DEFAULT_CAMPAIGN_DRAFT_BUDGET_USD_MICROS).toBeGreaterThan(
      DEFAULT_DAILY_AI_BUDGET_USD_MICROS,
    );
  });

  it("cada orçamento lê a própria env", () => {
    process.env.REACTIVATION_CAMPAIGN_BUDGET_USD_MICROS = "123456";
    expect(resolveCampaignDraftBudgetUsdMicros()).toBe(123_456);
    expect(resolveDailyBudgetUsdMicros()).toBe(DEFAULT_DAILY_AI_BUDGET_USD_MICROS);

    if (originalCampaign === undefined) {
      delete process.env.REACTIVATION_CAMPAIGN_BUDGET_USD_MICROS;
    } else {
      process.env.REACTIVATION_CAMPAIGN_BUDGET_USD_MICROS = originalCampaign;
    }
  });

  it("bloqueia exatamente ao atingir o teto, não depois", () => {
    expect(evaluateBudget(99, 100).allowed).toBe(true);
    expect(evaluateBudget(100, 100).allowed).toBe(false);
  });
});
