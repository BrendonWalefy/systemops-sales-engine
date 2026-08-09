import { describe, expect, it } from "vitest";

import { evaluateSystemOpsLabReadiness } from "@/application/labs/systemops-lab-readiness";
import { runSystemOpsLabReadinessVerifier } from "../../scripts/verify-systemops-lab";

describe("SystemOps Lab readiness", () => {
  it("is ready for controlled inbound but not automation", () => {
    const report = evaluateSystemOpsLabReadiness({
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: false,
      shadowModeEnabled: false,
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "lab-id",
      webhookSecretConfigured: true,
      remoteConnected: true,
    });

    expect(report.readyForControlledInbound).toBe(true);
    expect(report.readyForAutomation).toBe(false);
    expect(report.blockers).toEqual([]);
  });

  it("blocks tenant mismatch and enabled automation", () => {
    const report = evaluateSystemOpsLabReadiness({
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: true,
      shadowModeEnabled: false,
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "other-id",
      webhookSecretConfigured: true,
      remoteConnected: true,
    });

    expect(report.readyForControlledInbound).toBe(false);
    expect(report.blockers).toContain("tenant_resolution_mismatch");
    expect(report.blockers).toContain("automation_must_remain_disabled");
  });

  it("does not block local readiness when remote status was not requested", () => {
    const report = evaluateSystemOpsLabReadiness({
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: false,
      shadowModeEnabled: false,
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "lab-id",
      webhookSecretConfigured: true,
      remoteConnected: null,
    });

    expect(report.readyForControlledInbound).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it("emits a read-only local report and keeps an unchecked remote status as a warning", async () => {
    const lines: string[] = [];

    await runSystemOpsLabReadinessVerifier({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      ZAPI_WEBHOOK_SECRET: "configured-locally",
    }, {
      readSnapshot: async () => ({
        id: "lab-id",
        isTest: true,
        isDemo: false,
        operationalStatus: "test",
        autoReplyEnabled: false,
        shadowModeEnabled: false,
        channelProvider: "z_api",
        zapiInstanceId: "instance-1",
        zapiToken: "encrypted-token",
        zapiClientToken: null,
      }),
      resolveClinicByInstance: async () => "lab-id",
      resolveChannel: () => ({
        provider: "z_api",
        zapi: { instanceId: "instance-1", token: "decrypted-only-in-memory" },
        meta: null,
      }),
      getRemoteStatus: async () => ({ connected: true, smartphoneConnected: true }),
      write: (line) => lines.push(line),
    });

    expect(JSON.parse(lines[0] ?? "")).toEqual({
      clinicId: "lab-id",
      credentials: { configured: true },
      webhookSecret: { configured: true },
      readiness: {
        readyForControlledInbound: true,
        readyForAutomation: false,
        blockers: [],
      },
      remote: {
        checked: false,
        connected: null,
        warnings: ["remote_not_connected"],
      },
    });
  });
});
