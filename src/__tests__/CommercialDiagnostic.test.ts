import { describe, expect, it } from "vitest";
import {
  computeCommercialDiagnostic,
  type CommercialDiagnosticInput,
} from "@/application/onboarding/commercial-diagnostic";

const EMPTY: CommercialDiagnosticInput = {
  segment: "dental",
  leadsBucket: null,
  appointmentsBucket: null,
  ticketBucket: null,
  teamBucket: null,
  responseTime: null,
  channel: null,
  schedule: null,
  pains: [],
};

describe("computeCommercialDiagnostic", () => {
  it("marks insufficient data when leads or ticket are missing", () => {
    const r = computeCommercialDiagnostic(EMPTY);
    expect(r.hasEnoughData).toBe(false);
    expect(r.additionalRevenueBrl.low).toBe(0);
    expect(r.additionalRevenueBrl.high).toBe(0);
    expect(r.missedLeads).toBe(0);
  });

  it("computes missed leads and a positive revenue range with enough data", () => {
    const r = computeCommercialDiagnostic({
      ...EMPTY,
      leadsBucket: "200-400", // 300
      appointmentsBucket: "0-80", // 50
      ticketBucket: "600-1000", // 800
      responseTime: "over_6h",
      channel: "whatsapp",
      pains: ["after_hours", "slow_reply"],
    });
    expect(r.hasEnoughData).toBe(true);
    expect(r.leadsPerMonth).toBe(300);
    expect(r.appointmentsPerMonth).toBe(50);
    expect(r.missedLeads).toBe(250);
    expect(r.additionalRevenueBrl.high).toBeGreaterThan(r.additionalRevenueBrl.low);
    expect(r.additionalRevenueBrl.low).toBeGreaterThan(0);
  });

  it("caps recapture at 22% of missed leads (defensible ceiling)", () => {
    const r = computeCommercialDiagnostic({
      ...EMPTY,
      leadsBucket: "800+", // 1000
      appointmentsBucket: "0-80", // 50
      ticketBucket: "acima-1000",
      responseTime: "over_6h",
      pains: ["after_hours", "slow_reply", "no_organization", "low_conversion"],
    });
    const ratio = r.recoveredAppointments.high / r.missedLeads;
    expect(ratio).toBeLessThanOrEqual(0.22 + 1e-9);
  });

  it("clamps appointments to leads so conversion never exceeds 1", () => {
    const r = computeCommercialDiagnostic({
      ...EMPTY,
      leadsBucket: "0-200", // 120
      appointmentsBucket: "200+", // 240 -> clamped to 120
      ticketBucket: "ate-350",
    });
    expect(r.appointmentsPerMonth).toBe(120);
    expect(r.currentConversion).toBeLessThanOrEqual(0.95);
    expect(r.missedLeads).toBe(0);
  });

  it("recommends plan by lead volume", () => {
    const base = { ...EMPTY, ticketBucket: "600-1000" as const };
    expect(
      computeCommercialDiagnostic({ ...base, leadsBucket: "0-200" }).plan.key,
    ).toBe("start");
    expect(
      computeCommercialDiagnostic({ ...base, leadsBucket: "200-400" }).plan.key,
    ).toBe("growth");
    expect(
      computeCommercialDiagnostic({ ...base, leadsBucket: "800+" }).plan.key,
    ).toBe("scale");
  });

  it("keeps fit and close probability within bounds and coherent", () => {
    const r = computeCommercialDiagnostic({
      ...EMPTY,
      leadsBucket: "400-800",
      appointmentsBucket: "80-120",
      ticketBucket: "acima-1000",
      channel: "whatsapp",
      responseTime: "over_6h",
      pains: ["slow_reply", "after_hours"],
    });
    expect(r.fitScore).toBeGreaterThan(0);
    expect(r.fitScore).toBeLessThanOrEqual(98);
    expect(r.closeProbability).toBeGreaterThanOrEqual(0);
    expect(r.closeProbability).toBeLessThanOrEqual(95);
    expect(r.roiMultiple.high).toBeGreaterThanOrEqual(r.roiMultiple.low);
    expect(r.netGainBrl.high).toBe(
      r.additionalRevenueBrl.high - r.plan.monthlyCostBrl,
    );
  });
});
