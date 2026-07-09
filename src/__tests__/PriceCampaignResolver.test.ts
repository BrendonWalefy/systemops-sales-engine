import { describe, expect, it } from "vitest";
import {
  isCampaignCurrentlyActive,
  resolveEffectivePrice,
  effectiveBookableValueCents,
  type PriceCampaignRow,
  type TreatmentPriceBase,
} from "@/application/config/price-campaigns";

function base(overrides: Partial<TreatmentPriceBase> = {}): TreatmentPriceBase {
  return { priceCents: 170000, minPriceCents: null, maxPriceCents: null, priceKind: "from", ...overrides };
}

function campaign(overrides: Partial<PriceCampaignRow> = {}): PriceCampaignRow {
  return {
    id: "camp-1",
    treatmentId: "treat-1",
    name: "Promoção de lançamento",
    priceCents: 150000,
    minPriceCents: null,
    maxPriceCents: null,
    priceKind: "from",
    startsAt: null,
    endsAt: null,
    isActive: true,
    ...overrides,
  };
}

describe("isCampaignCurrentlyActive", () => {
  it("é ativa quando isActive=true e sem janela de datas", () => {
    expect(isCampaignCurrentlyActive(campaign())).toBe(true);
  });

  it("não é ativa quando isActive=false, mesmo dentro da janela", () => {
    expect(isCampaignCurrentlyActive(campaign({ isActive: false }))).toBe(false);
  });

  it("não é ativa antes de startsAt", () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(isCampaignCurrentlyActive(campaign({ startsAt: future }))).toBe(false);
  });

  it("não é ativa depois de endsAt", () => {
    const past = new Date(Date.now() - 86_400_000);
    expect(isCampaignCurrentlyActive(campaign({ endsAt: past }))).toBe(false);
  });

  it("é ativa dentro da janela startsAt/endsAt", () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    expect(isCampaignCurrentlyActive(campaign({ startsAt: past, endsAt: future }))).toBe(true);
  });
});

describe("resolveEffectivePrice", () => {
  it("sem campanha, retorna o preço de lista intacto e originalPriceCents null", () => {
    const effective = resolveEffectivePrice(base(), null);
    expect(effective.priceCents).toBe(170000);
    expect(effective.originalPriceCents).toBeNull();
    expect(effective.campaignName).toBeNull();
  });

  it("com campanha ativa, sobrepõe o preço e preenche originalPriceCents", () => {
    const effective = resolveEffectivePrice(base(), campaign());
    expect(effective.priceCents).toBe(150000);
    expect(effective.originalPriceCents).toBe(170000);
    expect(effective.campaignName).toBe("Promoção de lançamento");
  });

  it("com campanha inativa, ignora o override e volta ao preço de lista", () => {
    const effective = resolveEffectivePrice(base(), campaign({ isActive: false }));
    expect(effective.priceCents).toBe(170000);
    expect(effective.originalPriceCents).toBeNull();
  });

  it("com campanha fora da janela de datas, ignora o override", () => {
    const past = new Date(Date.now() - 86_400_000);
    const effective = resolveEffectivePrice(base(), campaign({ endsAt: past }));
    expect(effective.priceCents).toBe(170000);
    expect(effective.originalPriceCents).toBeNull();
  });

  it("quando o valor da campanha é igual ao de lista, não preenche originalPriceCents (nada a anunciar)", () => {
    const effective = resolveEffectivePrice(base({ priceCents: 150000 }), campaign({ priceCents: 150000 }));
    expect(effective.originalPriceCents).toBeNull();
  });

  it("carrega campaignEndsAt quando presente, para a IA citar o prazo", () => {
    const endsAt = new Date(Date.now() + 86_400_000);
    const effective = resolveEffectivePrice(base(), campaign({ endsAt }));
    expect(effective.campaignEndsAt).toBe(endsAt);
  });

  it("propaga o priceKind da campanha, não do preço de lista", () => {
    const effective = resolveEffectivePrice(base({ priceKind: "from" }), campaign({ priceKind: "fixed" }));
    expect(effective.priceKind).toBe("fixed");
  });
});

describe("effectiveBookableValueCents — snapshot de valor para agendamento/receita", () => {
  it("preço fixo sem campanha retorna priceCents", () => {
    expect(effectiveBookableValueCents(base({ priceKind: "fixed", priceCents: 30000 }), null)).toBe(30000);
  });

  it("campanha ativa sobrepõe o valor de lista", () => {
    expect(effectiveBookableValueCents(base({ priceCents: 170000 }), campaign({ priceCents: 150000 }))).toBe(150000);
  });

  it("kind 'from' sem priceCents cai para minPriceCents", () => {
    expect(effectiveBookableValueCents(base({ priceKind: "from", priceCents: null, minPriceCents: 250000 }), null)).toBe(250000);
  });

  it("sem nenhum preço cadastrado retorna null (não vira 0 na soma)", () => {
    expect(effectiveBookableValueCents(base({ priceCents: null, minPriceCents: null, maxPriceCents: null }), null)).toBeNull();
  });

  it("campanha inativa é ignorada — volta ao valor de lista", () => {
    expect(effectiveBookableValueCents(base({ priceCents: 170000 }), campaign({ isActive: false, priceCents: 150000 }))).toBe(170000);
  });
});
