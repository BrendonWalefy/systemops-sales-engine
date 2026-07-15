import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { priceCampaigns } from "@/infrastructure/db/schema";

/**
 * FONTE ÚNICA DA VERDADE PARA PREÇO PROMOCIONAL.
 *
 * `treatments.priceCents` é o preço de lista (âncora). Uma campanha em
 * `price_campaigns` é um OVERRIDE temporário do mesmo fato — nunca um segundo
 * preço digitado à mão em playbook/commercialPolicy. Quando ativa, o preço que
 * a IA fala, o dashboard e o snapshot do agendamento devem ler o valor
 * EFETIVO (`resolveEffectivePrice`), nunca `treatments.priceCents` direto.
 */
export type PriceCampaignRow = {
  id: string;
  treatmentId: string;
  name: string;
  priceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  priceKind: "from" | "fixed";
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
};

export type TreatmentPriceBase = {
  priceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  priceKind: "from" | "fixed";
};

export type EffectivePrice = {
  priceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  priceKind: "from" | "fixed";
  /** Preço de lista, presente só quando uma campanha ativa o substitui e ele difere. */
  originalPriceCents: number | null;
  campaignName: string | null;
  campaignEndsAt: Date | null;
};

export function isCampaignCurrentlyActive(
  campaign: Pick<PriceCampaignRow, "isActive" | "startsAt" | "endsAt">,
  now: Date = new Date(),
): boolean {
  if (!campaign.isActive) return false;
  if (campaign.startsAt && now < campaign.startsAt) return false;
  if (campaign.endsAt && now > campaign.endsAt) return false;
  return true;
}

function baseValue(base: TreatmentPriceBase): number | null {
  return base.priceKind === "fixed"
    ? (base.priceCents ?? base.minPriceCents)
    : (base.minPriceCents ?? base.priceCents);
}

function campaignValue(campaign: PriceCampaignRow): number | null {
  return campaign.priceKind === "fixed"
    ? (campaign.priceCents ?? campaign.minPriceCents)
    : (campaign.minPriceCents ?? campaign.priceCents);
}

/**
 * Resolve o preço EFETIVO de um tratamento: campanha ativa (se houver e válida
 * na janela de datas) sobrepõe o preço de lista. `originalPriceCents` só vem
 * preenchido quando há campanha ativa E o valor dela difere do preço de lista
 * — é o que permite a IA falar "de X por Y" sem duplicar o fato em dois lugares.
 */
export function resolveEffectivePrice(
  base: TreatmentPriceBase,
  campaign: PriceCampaignRow | null,
  now: Date = new Date(),
): EffectivePrice {
  if (!campaign || !isCampaignCurrentlyActive(campaign, now)) {
    return {
      priceCents: base.priceCents,
      minPriceCents: base.minPriceCents,
      maxPriceCents: base.maxPriceCents,
      priceKind: base.priceKind,
      originalPriceCents: null,
      campaignName: null,
      campaignEndsAt: null,
    };
  }

  const original = baseValue(base);
  const promo = campaignValue(campaign);

  return {
    priceCents: campaign.priceCents,
    minPriceCents: campaign.minPriceCents,
    maxPriceCents: campaign.maxPriceCents,
    priceKind: campaign.priceKind,
    originalPriceCents: original != null && original !== promo ? original : null,
    campaignName: campaign.name,
    campaignEndsAt: campaign.endsAt,
  };
}

/**
 * Valor único "cotável" de um tratamento para snapshot de agendamento/receita:
 * preço efetivo (campanha ativa sobrepõe lista) colapsado em um número. Mesma
 * ordem de precedência que o dashboard e a derivação de prosa usam
 * (`priceCents ?? minPriceCents ?? maxPriceCents`). Retorna null quando o
 * tratamento não tem preço cadastrado.
 */
export function effectiveBookableValueCents(
  base: TreatmentPriceBase,
  campaign: PriceCampaignRow | null,
  now: Date = new Date(),
): number | null {
  const eff = resolveEffectivePrice(base, campaign, now);
  return eff.priceCents ?? eff.minPriceCents ?? eff.maxPriceCents ?? null;
}

/**
 * Combina os valores de vários procedimentos de UM agendamento numa receita única,
 * tratando corretamente o SINAL (procedimento com `deductible = true`, ex.: a
 * avaliação de R$30 que é abatida do total quando o cliente fecha o procedimento).
 *
 * Regra (confirmada com o produto):
 *  - Se há procedimento real (não-dedutível) junto: o sinal é ABSORVIDO no total —
 *    não soma por cima. Receita = soma dos não-dedutíveis. (Lentes R$1.500 +
 *    Avaliação R$30 → R$1.500, não R$1.530.)
 *  - Se o agendamento é só sinal (nenhum procedimento real): vale o próprio sinal
 *    (o depósito coletado na avaliação). (Avaliação R$30 sozinha → R$30.)
 *  - Nenhum item com preço → null.
 *
 * Isto evita superfaturar a receita do dashboard contando o sinal duas vezes.
 */
export function combineAppointmentValueCents(
  items: { valueCents: number | null; deductible: boolean }[],
): number | null {
  const nonDeductible = items.filter((i) => !i.deductible && i.valueCents != null);
  if (nonDeductible.length > 0) {
    return nonDeductible.reduce((sum, i) => sum + (i.valueCents ?? 0), 0);
  }
  const deductible = items.filter((i) => i.deductible && i.valueCents != null);
  if (deductible.length > 0) {
    return deductible.reduce((sum, i) => sum + (i.valueCents ?? 0), 0);
  }
  return null;
}

/**
 * Uma clínica só deve rodar UMA campanha ativa por tratamento por vez —
 * simplicidade deliberada (sem empilhamento de promoções concorrentes).
 * Retorna a mais recente por `createdAt` caso o dado fique inconsistente.
 */
export async function getActivePriceCampaignsByTreatment(
  clinicId: string,
  now: Date = new Date(),
): Promise<Map<string, PriceCampaignRow>> {
  const rows = await db
    .select({
      id: priceCampaigns.id,
      treatmentId: priceCampaigns.treatmentId,
      name: priceCampaigns.name,
      priceCents: priceCampaigns.priceCents,
      minPriceCents: priceCampaigns.minPriceCents,
      maxPriceCents: priceCampaigns.maxPriceCents,
      priceKind: priceCampaigns.priceKind,
      startsAt: priceCampaigns.startsAt,
      endsAt: priceCampaigns.endsAt,
      isActive: priceCampaigns.isActive,
      createdAt: priceCampaigns.createdAt,
    })
    .from(priceCampaigns)
    .where(and(eq(priceCampaigns.clinicId, clinicId), eq(priceCampaigns.isActive, true)));

  const byTreatment = new Map<string, PriceCampaignRow & { createdAt: Date }>();
  for (const row of rows) {
    if (!isCampaignCurrentlyActive(row, now)) continue;
    const existing = byTreatment.get(row.treatmentId);
    if (!existing || row.createdAt > existing.createdAt) {
      byTreatment.set(row.treatmentId, row);
    }
  }
  return byTreatment;
}
