import { describe, expect, it } from "vitest";

import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";

describe("Clinic automation policy", () => {
  it("permite outbound automatizado quando autoReplyEnabled=true", () => {
    expect(shouldSendAutomatedClinicOutbound({ autoReplyEnabled: true })).toBe(true);
  });

  it("bloqueia outbound automatizado quando autoReplyEnabled=false", () => {
    expect(shouldSendAutomatedClinicOutbound({ autoReplyEnabled: false })).toBe(false);
  });
});
