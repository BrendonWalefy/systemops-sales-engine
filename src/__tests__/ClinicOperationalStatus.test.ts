import { describe, expect, it } from "vitest";
import {
  resolveInitialClinicOperationalStatus,
  resolveOperationalStatusFromAutomationState,
} from "@/application/clinics/clinic-operational-status";

describe("clinic operational status", () => {
  it("starts new test organizations in test and others in prospect", () => {
    expect(resolveInitialClinicOperationalStatus({ isTest: true })).toBe(
      "test",
    );
    expect(resolveInitialClinicOperationalStatus({ isTest: false })).toBe(
      "prospect",
    );
  });

  it("keeps test organizations blocked even if auto reply is on", () => {
    expect(
      resolveOperationalStatusFromAutomationState({
        currentStatus: "test",
        isTest: true,
        autoReplyEnabled: true,
      }),
    ).toBe("test");
  });

  it("maps production organizations to active or paused based on automation", () => {
    expect(
      resolveOperationalStatusFromAutomationState({
        currentStatus: "prospect",
        isTest: false,
        autoReplyEnabled: true,
      }),
    ).toBe("prospect");

    expect(
      resolveOperationalStatusFromAutomationState({
        currentStatus: "paused",
        isTest: false,
        autoReplyEnabled: true,
      }),
    ).toBe("active");

    expect(
      resolveOperationalStatusFromAutomationState({
        currentStatus: "active",
        isTest: false,
        autoReplyEnabled: false,
      }),
    ).toBe("paused");
  });

  it("preserves cancelled organizations", () => {
    expect(
      resolveOperationalStatusFromAutomationState({
        currentStatus: "cancelled",
        isTest: false,
        autoReplyEnabled: true,
      }),
    ).toBe("cancelled");
  });
});
