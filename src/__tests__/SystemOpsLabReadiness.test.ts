import { describe, expect, it } from "vitest";

import { evaluateSystemOpsLabReadiness } from "@/application/labs/systemops-lab-readiness";
import {
  runSystemOpsLabReadinessCommand,
  runSystemOpsLabReadinessVerifier,
} from "../../scripts/verify-systemops-lab";

const ownerMembershipDigest = `sha256:${"c".repeat(64)}`;

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
      ownerMembershipMatches: true,
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
      ownerMembershipMatches: true,
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
      ownerMembershipMatches: true,
      webhookSecretConfigured: true,
      remoteConnected: null,
    });

    expect(report.readyForControlledInbound).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it("requires V1 and automation off during preactivation", () => {
    const report = evaluateSystemOpsLabReadiness({
      phase: "preactivation",
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: false,
      shadowModeEnabled: false,
      conversationEngine: "v2_internal",
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "lab-id",
      ownerMembershipMatches: true,
      webhookSecretConfigured: true,
      remoteConnected: true,
      configDigest: `sha256:${"a".repeat(64)}`,
      expectedConfigDigest: `sha256:${"a".repeat(64)}`,
      approvalDecision: null,
      approvalRegistered: false,
    });

    expect(report.readyForControlledInbound).toBe(false);
    expect(report.blockers).toContain("engine_must_be_v1");
  });

  it("requires a registered smoke approval, exact config and V2 engine for smoke", () => {
    const report = evaluateSystemOpsLabReadiness({
      phase: "smoke",
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: true,
      shadowModeEnabled: false,
      conversationEngine: "v2_internal",
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "lab-id",
      ownerMembershipMatches: true,
      webhookSecretConfigured: true,
      remoteConnected: true,
      configDigest: `sha256:${"a".repeat(64)}`,
      expectedConfigDigest: `sha256:${"b".repeat(64)}`,
      approvalDecision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
      approvalRegistered: true,
    });

    expect(report.readyForAutomation).toBe(false);
    expect(report.blockers).toEqual(["config_digest_mismatch"]);
  });

  it("never treats an omitted owner membership proof as ready", () => {
    const report = evaluateSystemOpsLabReadiness({
      phase: "smoke",
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: true,
      shadowModeEnabled: false,
      conversationEngine: "v2_internal",
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "lab-id",
      ownerMembershipMatches: undefined as never,
      webhookSecretConfigured: true,
      remoteConnected: true,
      configDigest: `sha256:${"a".repeat(64)}`,
      expectedConfigDigest: `sha256:${"a".repeat(64)}`,
      approvalDecision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
      approvalRegistered: true,
    });

    expect(report.readyForAutomation).toBe(false);
    expect(report.blockers).toContain("owner_membership_mismatch");
  });

  it("blocks readiness when the exact internal owner membership changes", () => {
    const report = evaluateSystemOpsLabReadiness({
      phase: "smoke",
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: true,
      shadowModeEnabled: false,
      conversationEngine: "v2_internal",
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "lab-id",
      ownerMembershipMatches: false,
      webhookSecretConfigured: true,
      remoteConnected: true,
      configDigest: `sha256:${"a".repeat(64)}`,
      expectedConfigDigest: `sha256:${"a".repeat(64)}`,
      approvalDecision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
      approvalRegistered: true,
    });

    expect(report.readyForAutomation).toBe(false);
    expect(report.blockers).toEqual(["owner_membership_mismatch"]);
  });

  it("keeps READY distinct from smoke and never treats human review as a readiness input", () => {
    const report = evaluateSystemOpsLabReadiness({
      phase: "ready",
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: true,
      shadowModeEnabled: false,
      conversationEngine: "v2_internal",
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "lab-id",
      ownerMembershipMatches: true,
      webhookSecretConfigured: true,
      remoteConnected: true,
      configDigest: `sha256:${"a".repeat(64)}`,
      expectedConfigDigest: `sha256:${"a".repeat(64)}`,
      approvalDecision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
      approvalRegistered: true,
    });

    expect(report.readyForAutomation).toBe(false);
    expect(report.blockers).toEqual(["approval_decision_mismatch"]);
  });

  it("emits a read-only local report and keeps an unchecked remote status as a warning", async () => {
    const lines: string[] = [];
    let remoteChecks = 0;

    await runSystemOpsLabReadinessVerifier({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST: ownerMembershipDigest,
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
        ownerMembershipDigest,
      }),
      resolveClinicByInstance: async () => "lab-id",
      resolveChannel: () => ({
        provider: "z_api",
        zapi: { instanceId: "instance-1", token: "decrypted-only-in-memory" },
        meta: null,
      }),
      getRemoteStatus: async () => {
        remoteChecks += 1;
        return { connected: true, smartphoneConnected: true };
      },
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
    expect(remoteChecks).toBe(0);
  });

  it("maps an absent or changed owner membership to a sanitized verifier blocker", async () => {
    const lines: string[] = [];
    const readiness = await runSystemOpsLabReadinessVerifier({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST: `sha256:${"a".repeat(64)}`,
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
        ownerMembershipDigest: null,
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

    expect(readiness.blockers).toEqual(["owner_membership_mismatch"]);
    expect(lines.join("\n")).not.toContain("encrypted-token");
  });

  it("checks a disconnected remote once and emits only the sanitized blocker", async () => {
    const lines: string[] = [];
    let remoteChecks = 0;

    const readiness = await runSystemOpsLabReadinessVerifier({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      SYSTEMOPS_LAB_CHECK_REMOTE: "true",
      SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST: ownerMembershipDigest,
      ZAPI_WEBHOOK_SECRET: "webhook-secret-not-for-output",
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
        zapiToken: "encrypted-token-not-for-output",
        zapiClientToken: "encrypted-client-token-not-for-output",
        ownerMembershipDigest,
      }),
      resolveClinicByInstance: async () => "lab-id",
      resolveChannel: () => ({
        provider: "z_api",
        zapi: {
          instanceId: "instance-1",
          token: "decrypted-token-not-for-output",
          clientToken: "decrypted-client-token-not-for-output",
        },
        meta: null,
      }),
      getRemoteStatus: async () => {
        remoteChecks += 1;
        return {
          connected: false,
          smartphoneConnected: false,
          error: "remote-detail-not-for-output",
        };
      },
      write: (line) => lines.push(line),
    });

    expect(remoteChecks).toBe(1);
    expect(readiness).toEqual({
      readyForControlledInbound: false,
      readyForAutomation: false,
      blockers: ["remote_not_connected"],
    });
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      clinicId: "lab-id",
      credentials: { configured: true },
      webhookSecret: { configured: true },
      readiness: {
        readyForControlledInbound: false,
        readyForAutomation: false,
        blockers: ["remote_not_connected"],
      },
      remote: {
        checked: true,
        connected: false,
        warnings: [],
      },
    });
    expect(lines.join("\n")).not.toMatch(/secret-not-for-output|token-not-for-output|remote-detail/);
  });

  it("turns an entrypoint exception into a sanitized JSON failure reason", async () => {
    const lines: string[] = [];

    const result = await runSystemOpsLabReadinessCommand({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      ZAPI_WEBHOOK_SECRET: "secret-not-for-output",
    }, {
      readSnapshot: async () => {
        throw new Error("database rejected secret-not-for-output");
      },
      resolveClinicByInstance: async () => "lab-id",
      resolveChannel: () => ({ provider: "z_api", zapi: null, meta: null }),
      getRemoteStatus: async () => ({ connected: false, smartphoneConnected: false }),
      write: (line) => lines.push(line),
    });

    expect(result).toBeNull();
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      clinicId: "lab-id",
      credentials: { configured: false },
      webhookSecret: { configured: true },
      readiness: {
        readyForControlledInbound: false,
        readyForAutomation: false,
        blockers: [],
      },
      remote: { checked: false, connected: null, warnings: ["remote_not_connected"] },
      reasonCodes: ["readiness_check_failed"],
    });
    expect(lines.join("\n")).not.toContain("secret-not-for-output");
  });
});
