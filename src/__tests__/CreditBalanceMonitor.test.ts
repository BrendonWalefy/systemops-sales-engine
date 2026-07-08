import { describe, expect, it } from "vitest";
import {
  evaluateElevenLabsCredits,
  evaluateOpenAiBudget,
} from "@/application/health/credit-balance";

describe("evaluateElevenLabsCredits", () => {
  it("stays quiet with healthy balance (estado real de 08/07: 72% restante)", () => {
    const alerts = evaluateElevenLabsCredits({
      usedCharacters: 33_887,
      characterLimit: 121_369,
      nextResetAt: new Date("2026-07-20T00:00:00Z"),
    });

    expect(alerts).toHaveLength(0);
  });

  it("warns when remaining credits drop to 25% or below", () => {
    const alerts = evaluateElevenLabsCredits({
      usedCharacters: 91_027, // 75% usado
      characterLimit: 121_369,
      nextResetAt: new Date("2026-07-20T00:00:00Z"),
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("warn");
    expect(alerts[0].source).toBe("credits");
    expect(alerts[0].detail).toContain("renova em");
  });

  it("escalates to critical at 10% remaining or below", () => {
    const alerts = evaluateElevenLabsCredits({
      usedCharacters: 110_000,
      characterLimit: 121_369,
      nextResetAt: null,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("critical");
  });

  it("ignores accounts without a character limit instead of dividing by zero", () => {
    const alerts = evaluateElevenLabsCredits({
      usedCharacters: 0,
      characterLimit: 0,
      nextResetAt: null,
    });

    expect(alerts).toHaveLength(0);
  });

  it("clamps overdrawn balances to 0% instead of going negative", () => {
    const alerts = evaluateElevenLabsCredits({
      usedCharacters: 130_000,
      characterLimit: 121_369,
      nextResetAt: null,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("critical");
    expect(alerts[0].detail).toContain("0% restante");
  });
});

describe("evaluateOpenAiBudget", () => {
  it("stays quiet below 70% of the monthly budget", () => {
    const alerts = evaluateOpenAiBudget({
      monthToDateUsdMicros: 10_000_000, // US$ 10
      monthlyBudgetUsd: 20,
    });

    expect(alerts).toHaveLength(0);
  });

  it("warns at 70% of the budget (antes do teto parar o auto-recharge)", () => {
    const alerts = evaluateOpenAiBudget({
      monthToDateUsdMicros: 14_000_000, // US$ 14 de US$ 20
      monthlyBudgetUsd: 20,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("warn");
    expect(alerts[0].detail).toContain("US$ 14.00");
  });

  it("escalates to critical at 90% of the budget", () => {
    const alerts = evaluateOpenAiBudget({
      monthToDateUsdMicros: 18_500_000,
      monthlyBudgetUsd: 20,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("critical");
  });

  it("skips the check when the budget is not configured", () => {
    const alerts = evaluateOpenAiBudget({
      monthToDateUsdMicros: 50_000_000,
      monthlyBudgetUsd: 0,
    });

    expect(alerts).toHaveLength(0);
  });
});
