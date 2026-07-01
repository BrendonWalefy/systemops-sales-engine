import { describe, expect, it } from "vitest";

import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";

describe("Clinic automation policy", () => {
  it("permite outbound automatizado apenas para clínicas ativas", () => {
    expect(
      shouldSendAutomatedClinicOutbound({
        autoReplyEnabled: true,
        operationalStatus: "active",
      }),
    ).toBe(true);
  });

  it("bloqueia outbound automatizado quando a IA está desligada", () => {
    expect(
      shouldSendAutomatedClinicOutbound({
        autoReplyEnabled: false,
        operationalStatus: "active",
      }),
    ).toBe(false);
  });

  it("bloqueia outbound automatizado para clínicas fora de go-live", () => {
    expect(
      shouldSendAutomatedClinicOutbound({
        autoReplyEnabled: true,
        operationalStatus: "test",
      }),
    ).toBe(false);
    expect(
      shouldSendAutomatedClinicOutbound({
        autoReplyEnabled: true,
        operationalStatus: "prospect",
      }),
    ).toBe(false);
    expect(
      shouldSendAutomatedClinicOutbound({
        autoReplyEnabled: true,
        operationalStatus: "paused",
      }),
    ).toBe(false);
  });

  it("shadow mode compõe resposta mesmo fora de go-live (prospect, paused, test)", () => {
    for (const operationalStatus of ["prospect", "paused", "test"] as const) {
      expect(
        shouldSendAutomatedClinicOutbound({
          autoReplyEnabled: false,
          operationalStatus,
          shadowModeEnabled: true,
        }),
      ).toBe(true);
    }
  });

  it("shadow mode nunca compõe para clínica arquivada (cancelled)", () => {
    expect(
      shouldSendAutomatedClinicOutbound({
        autoReplyEnabled: true,
        operationalStatus: "cancelled",
        shadowModeEnabled: true,
      }),
    ).toBe(false);
  });

  it("shadow mode desligado preserva o comportamento normal", () => {
    expect(
      shouldSendAutomatedClinicOutbound({
        autoReplyEnabled: true,
        operationalStatus: "active",
        shadowModeEnabled: false,
      }),
    ).toBe(true);
    expect(
      shouldSendAutomatedClinicOutbound({
        autoReplyEnabled: true,
        operationalStatus: "prospect",
        shadowModeEnabled: false,
      }),
    ).toBe(false);
  });
});
