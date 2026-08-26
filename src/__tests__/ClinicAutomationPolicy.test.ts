import { describe, expect, it } from "vitest";

import { resolveClinicAutomationMode, shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";

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

  it("shadow mode observa somente uma clínica operacionalmente elegível", () => {
    const clinic = {
      autoReplyEnabled: true,
      operationalStatus: "active" as const,
      shadowModeEnabled: true,
    };
    expect(resolveClinicAutomationMode(clinic)).toBe("observe");
    expect(shouldSendAutomatedClinicOutbound(clinic)).toBe(false);
  });

  it.each([
    ["prospect", true],
    ["test", true],
    ["paused", true],
    ["cancelled", true],
    ["active", false],
  ] as const)("shadow não observa status=%s com autoReply=%s", (operationalStatus, autoReplyEnabled) => {
    const clinic = { autoReplyEnabled, operationalStatus, shadowModeEnabled: true };
    expect(resolveClinicAutomationMode(clinic)).toBe("disabled");
    expect(shouldSendAutomatedClinicOutbound(clinic)).toBe(false);
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
