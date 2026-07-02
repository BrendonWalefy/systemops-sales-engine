export type OrgPlan = "essencial" | "avancado" | "rede" | "custom";

// Valores oficiais em docs/product/pricing-strategy.md.
// Mapeamento comercial: essencial = Start, avancado = Growth, rede = Scale
// (mono-unidade de alto volume — "rede" aqui NÃO significa multi-unidade, ver
// docs/operations/billing-roadmap.md).
export const PLAN_PRICE_BRL_CENTS: Record<OrgPlan, number> = {
  essencial: 130000,
  avancado: 210000,
  rede: 350000,
  custom: 0,
};

export function resolveClinicCommercialSettings(input: {
  plan: OrgPlan;
  billingActive: boolean;
  monthlyRevenueBrl?: number;
  billingStartedAt?: string;
  isTest: boolean;
}) {
  if (input.isTest || !input.billingActive) {
    return {
      plan: input.plan,
      monthlyRevenueBrl: 0,
      billingStartedAt: null,
      isTest: input.isTest,
    };
  }

  const manualRevenueCents =
    typeof input.monthlyRevenueBrl === "number" && Number.isFinite(input.monthlyRevenueBrl)
      ? Math.max(0, Math.round(input.monthlyRevenueBrl * 100))
      : null;

  return {
    plan: input.plan,
    monthlyRevenueBrl: manualRevenueCents ?? PLAN_PRICE_BRL_CENTS[input.plan],
    billingStartedAt: input.billingStartedAt ? new Date(`${input.billingStartedAt}T00:00:00`) : new Date(),
    isTest: false,
  };
}
