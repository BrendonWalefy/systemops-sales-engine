import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  evaluateSystemOpsLabReadiness,
  type SystemOpsLabReadinessInput,
} from "@/application/labs/systemops-lab-readiness";
import {
  runSystemOpsLabReadinessCommand,
  runSystemOpsLabReadinessVerifier,
} from "../../scripts/verify-systemops-lab";

const ownerMembershipDigest = `sha256:${"c".repeat(64)}`;
const configurationDigest = `sha256:${"d".repeat(64)}`;

function liveInput(
  patch: Partial<SystemOpsLabReadinessInput> = {},
): SystemOpsLabReadinessInput {
  return {
    clinicId: "lab-id",
    isTest: true,
    isDemo: false,
    operationalStatus: "active",
    autoReplyEnabled: true,
    shadowModeEnabled: false,
    channelProvider: "z_api",
    zapiInstanceId: "instance-1",
    hasEncryptedToken: true,
    resolvedClinicId: "lab-id",
    ownerMembershipMatches: true,
    webhookSecretConfigured: true,
    remoteConnected: true,
    authorityVersion: 2,
    runtimeControl: { liveOutboundEnabled: true, version: 7 },
    configurationDigest,
    ...patch,
  };
}

function verifierDependencies(write: (line: string) => void) {
  return {
    readSnapshot: async () => ({
      id: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "active",
      autoReplyEnabled: true,
      shadowModeEnabled: false,
      channelProvider: "z_api" as const,
      zapiInstanceId: "instance-1",
      zapiToken: "encrypted-token-not-for-output",
      zapiClientToken: null,
      ownerMembershipDigest,
    }),
    readAuthorityVersion: async () => 2,
    readRuntimeControl: async () => ({ liveOutboundEnabled: true, version: 7 }),
    resolveConfigurationDigest: async () => configurationDigest,
    resolveClinicByInstance: async () => "lab-id",
    resolveChannel: () => ({
      provider: "z_api" as const,
      zapi: { instanceId: "instance-1", token: "decrypted-only-in-memory" },
      meta: null,
    }),
    getRemoteStatus: async () => ({ connected: true, smartphoneConnected: true }),
    write,
  };
}

describe("SystemOps Lab V2-only readiness", () => {
  it("is live only with active operations, authority V2 and an open global switch", () => {
    expect(evaluateSystemOpsLabReadiness(liveInput())).toEqual({
      readyForControlledInbound: true,
      readyForAutomation: true,
      blockers: [],
    });
  });

  it.each([0, 1, null])("fails closed below authority V2 (%s)", (authorityVersion) => {
    const report = evaluateSystemOpsLabReadiness(liveInput({ authorityVersion }));

    expect(report.readyForAutomation).toBe(false);
    expect(report.blockers).toContain("authority_below_v2");
  });

  it("fails closed when the global live-outbound switch is closed or unavailable", () => {
    expect(evaluateSystemOpsLabReadiness(liveInput({
      runtimeControl: { liveOutboundEnabled: false, version: 8 },
    })).blockers).toContain("runtime_control_closed");
    expect(evaluateSystemOpsLabReadiness(liveInput({ runtimeControl: null })).blockers)
      .toContain("runtime_control_closed");
  });

  it.each([
    ["paused", { operationalStatus: "paused" }, "status_not_active"],
    ["disabled", { autoReplyEnabled: false }, "automation_must_be_enabled"],
    ["shadow", { shadowModeEnabled: true }, "shadow_must_remain_disabled"],
    ["demo", { isDemo: true }, "target_is_demo"],
    ["missing config digest", { configurationDigest: null }, "config_digest_missing"],
  ] as const)("does not silently activate a %s tenant", (_case, patch, blocker) => {
    const report = evaluateSystemOpsLabReadiness(liveInput(patch));

    expect(report.readyForAutomation).toBe(false);
    expect(report.blockers).toContain(blocker);
  });

  it("preserves tenant, owner, channel and credential isolation", () => {
    const report = evaluateSystemOpsLabReadiness(liveInput({
      resolvedClinicId: "other-id",
      ownerMembershipMatches: false,
      channelProvider: null,
      hasEncryptedToken: false,
    }));

    expect(report.blockers).toEqual(expect.arrayContaining([
      "tenant_resolution_mismatch",
      "owner_membership_mismatch",
      "provider_not_zapi",
      "credential_missing",
    ]));
  });

  it("uses durable V2 authority and runtime control without engine or build approval", async () => {
    const lines: string[] = [];
    const dependencies = verifierDependencies((line) => lines.push(line));
    const readiness = await runSystemOpsLabReadinessVerifier({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      SYSTEMOPS_LAB_CHECK_REMOTE: "true",
      SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST: ownerMembershipDigest,
      ZAPI_WEBHOOK_SECRET: "configured-locally",
    }, dependencies);

    expect(readiness.readyForAutomation).toBe(true);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      clinicId: "lab-id",
      authority: { version: 2 },
      runtimeControl: { liveOutboundEnabled: true, version: 7 },
      configuration: { digest: configurationDigest },
      credentials: { configured: true },
      webhookSecret: { configured: true },
      readiness,
      remote: {
        checked: true,
        connected: true,
        warnings: [],
      },
    });
    expect(lines.join("\n")).not.toMatch(/encrypted-token|decrypted-only|approval|build/i);
  });

  it("does not declare live automation ready while remote channel state is unknown", async () => {
    const lines: string[] = [];
    const readiness = await runSystemOpsLabReadinessVerifier({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST: ownerMembershipDigest,
      ZAPI_WEBHOOK_SECRET: "configured-locally",
    }, verifierDependencies((line) => lines.push(line)));

    expect(readiness.readyForAutomation).toBe(false);
    expect(readiness.blockers).toContain("remote_not_connected");
    expect(JSON.parse(lines[0] ?? "").remote).toEqual({
      checked: false,
      connected: null,
      warnings: ["remote_not_connected"],
    });
  });

  it("checks the remote channel once when explicitly requested", async () => {
    const lines: string[] = [];
    let remoteChecks = 0;
    const dependencies = verifierDependencies((line) => lines.push(line));
    dependencies.getRemoteStatus = async () => {
      remoteChecks += 1;
      return { connected: false, smartphoneConnected: false };
    };

    const readiness = await runSystemOpsLabReadinessVerifier({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      SYSTEMOPS_LAB_CHECK_REMOTE: "true",
      SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST: ownerMembershipDigest,
      ZAPI_WEBHOOK_SECRET: "secret-not-for-output",
    }, dependencies);

    expect(remoteChecks).toBe(1);
    expect(readiness.blockers).toContain("remote_not_connected");
    expect(lines.join("\n")).not.toContain("secret-not-for-output");
  });

  it("turns an entrypoint exception into a sanitized failure", async () => {
    const lines: string[] = [];
    const dependencies = verifierDependencies((line) => lines.push(line));
    dependencies.readSnapshot = async () => {
      throw new Error("database rejected secret-not-for-output");
    };

    const result = await runSystemOpsLabReadinessCommand({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      ZAPI_WEBHOOK_SECRET: "secret-not-for-output",
    }, dependencies);

    expect(result).toBeNull();
    expect(JSON.parse(lines[0] ?? "")).toEqual(expect.objectContaining({
      clinicId: "lab-id",
      reasonCodes: ["readiness_check_failed"],
    }));
    expect(lines.join("\n")).not.toContain("secret-not-for-output");
  });

  it("contains no engine-selection, approval or build-bound verifier dependency", () => {
    const readinessSource = readFileSync(resolve(
      process.cwd(),
      "src/application/labs/systemops-lab-readiness.ts",
    ), "utf8");
    const verifierSource = readFileSync(resolve(process.cwd(), "scripts/verify-systemops-lab.ts"), "utf8");

    expect(`${readinessSource}\n${verifierSource}`).not.toMatch(
      /engineActivation|engine-selection|approvalRegistered|approvalDecision|internal-lab-approval|BuildIdentity/,
    );
  });
});
