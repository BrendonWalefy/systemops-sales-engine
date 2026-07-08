import { describe, expect, it, vi } from "vitest";
import {
  PLAN_PRICE_BRL_CENTS,
  resolveClinicCommercialSettings,
} from "@/application/onboarding/clinic-commercial-settings";

describe("resolveClinicCommercialSettings", () => {
  it("keeps test organizations out of revenue even when billing is marked active", () => {
    const result = resolveClinicCommercialSettings({
      plan: "growth",
      billingActive: true,
      monthlyRevenueBrl: 2100,
      billingStartedAt: "2026-06-14",
      isTest: true,
    });

    expect(result).toEqual({
      plan: "growth",
      monthlyRevenueBrl: 0,
      billingStartedAt: null,
      isTest: true,
    });
  });

  it("uses plan default revenue when billing is active and no manual value is provided", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));

    const result = resolveClinicCommercialSettings({
      plan: "start",
      billingActive: true,
      isTest: false,
    });

    expect(result.plan).toBe("start");
    expect(result.monthlyRevenueBrl).toBe(PLAN_PRICE_BRL_CENTS.start);
    expect(result.billingStartedAt).toEqual(new Date("2026-06-14T12:00:00.000Z"));
    expect(result.isTest).toBe(false);

    vi.useRealTimers();
  });

  it("uses the manual revenue and explicit billing date when provided", () => {
    const result = resolveClinicCommercialSettings({
      plan: "enterprise",
      billingActive: true,
      monthlyRevenueBrl: 2500,
      billingStartedAt: "2026-07-01",
      isTest: false,
    });

    expect(result).toEqual({
      plan: "enterprise",
      monthlyRevenueBrl: 250000,
      billingStartedAt: new Date("2026-07-01T00:00:00"),
      isTest: false,
    });
  });
});
