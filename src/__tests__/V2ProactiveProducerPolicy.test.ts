import { describe, expect, it, vi } from "vitest";
import {
  createV2ProactiveAutomationPolicy,
  requireLiveV2ProactiveAutomation,
} from "@/infrastructure/automation/create-v2-automation-policy";

function dependencies(overrides: {
  authorityVersion?: 0 | 1 | 2;
  liveOutboundEnabled?: boolean;
  operationalStatus?: "test" | "active" | "paused";
  autoReplyEnabled?: boolean;
  liveAutomationEnabled?: boolean;
  shadowModeEnabled?: boolean;
  isDemo?: boolean;
} = {}) {
  return {
    clinicFactsReader: {
      getAutomationFacts: vi.fn(async (clinicId: string) => ({
        clinicId,
        isTest: true,
        isDemo: overrides.isDemo ?? false,
        operationalStatus: overrides.operationalStatus ?? "active",
        autoReplyEnabled: overrides.autoReplyEnabled ?? true,
        liveAutomationEnabled: overrides.liveAutomationEnabled ?? true,
        shadowModeEnabled: overrides.shadowModeEnabled ?? false,
      })),
    },
    authorityStore: { getVersion: vi.fn(async () => overrides.authorityVersion ?? 2) },
    runtimeControlStore: {
      getGlobal: vi.fn(async () => ({
        liveOutboundEnabled: overrides.liveOutboundEnabled ?? true,
        version: 4,
      })),
    },
  };
}

describe("V2 proactive producer policy boundary", () => {
  it("allows only a tenant that is live on authority V2", async () => {
    const policy = createV2ProactiveAutomationPolicy(dependencies());
    await expect(requireLiveV2ProactiveAutomation("clinic-a", policy)).resolves.toMatchObject({
      allowed: true,
      reason: "live_v2",
      authorityVersion: 2,
    });
  });

  it.each([
    [{ authorityVersion: 1 as const }, "authority_below_v2"],
    [{ liveOutboundEnabled: false }, "global_kill_switch"],
    [{ operationalStatus: "paused" as const }, "operational_status"],
    [{ autoReplyEnabled: false }, "auto_reply_disabled"],
    [{ liveAutomationEnabled: false }, "tenant_live_disabled"],
    [{ shadowModeEnabled: true }, "shadow_observe"],
    [{ isDemo: true }, "demo"],
  ])("fails closed for %s", async (overrides, reason) => {
    const policy = createV2ProactiveAutomationPolicy(dependencies(overrides));
    await expect(requireLiveV2ProactiveAutomation("clinic-a", policy)).resolves.toMatchObject({
      allowed: false,
      reason,
    });
  });
});
