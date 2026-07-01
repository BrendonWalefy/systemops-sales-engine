export type OrgPlan = "essencial" | "avancado" | "rede" | "custom";

export const PLAN_PRICE_BRL_CENTS: Record<OrgPlan, number> = {
  essencial: 89700,
  avancado: 149700,
  rede: 299700,
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
