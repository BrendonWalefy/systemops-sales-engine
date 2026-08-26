import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  auditV2OnlyRollout,
  runV2OnlyRolloutAuditCommand,
} from "../../scripts/audit-v2-only-rollout";
import {
  controlV2OnlyRollout,
  runV2OnlyRolloutControlCommand,
  SYSTEMOPS_LAB_V2_ROLLOUT_CLINIC_ID,
} from "../../scripts/control-v2-only-rollout";

const LAB_ID = SYSTEMOPS_LAB_V2_ROLLOUT_CLINIC_ID;
const OTHER_ID = "11111111-1111-4111-8111-111111111111";
const AUTHORITY_METRICS = Object.freeze([
  { metric: "unresolved_events", count: 0 },
  { metric: "partial_claims", count: 0 },
  { metric: "identity_conflicts", count: 0 },
  { metric: "duplicate_generations", count: 0 },
  { metric: "duplicate_active_aliases", count: 0 },
  { metric: "active_alias_conflicts", count: 0 },
  { metric: "active_orphan_streams", count: 0 },
  { metric: "multiple_active_streams_per_conversation", count: 0 },
  { metric: "process_job_orphans", count: 0 },
  { metric: "invalid_outbound_authorization", count: 0 },
  { metric: "terminal_legacy_events", count: 50 },
  { metric: "terminal_legacy_outbounds", count: 72 },
] as const);

function auditDependencies(overrides: Record<string, unknown> = {}) {
  return {
    readTarget: vi.fn().mockResolvedValue({
      clinicId: LAB_ID,
      operationalStatus: "active",
      isTest: true,
      isDemo: false,
      autoReplyEnabled: true,
      liveAutomationEnabled: true,
      shadowModeEnabled: false,
      authorityVersion: 2,
    }),
    readLiveTenants: vi.fn().mockResolvedValue([
      { clinicId: LAB_ID, operationalStatus: "active", authorityVersion: 2 },
    ]),
    readQueueCounts: vi.fn().mockResolvedValue({
      pending: 0,
      processing: 0,
      failed: 0,
      locked: 0,
    }),
    readOutboundCounts: vi.fn().mockResolvedValue({
      pending: 0,
      processing: 0,
      failed: 0,
    }),
    readAuthorityValidation: vi.fn().mockResolvedValue({
      clinicId: LAB_ID,
      clean: true,
      issues: [],
      metrics: AUTHORITY_METRICS,
    }),
    readRuntimeControl: vi.fn().mockResolvedValue({
      liveOutboundEnabled: true,
      version: 7,
    }),
    readOtherTenantDigest: vi.fn().mockResolvedValue("sha256:other-tenants"),
    deploymentSha: vi.fn().mockReturnValue("candidate-sha"),
    ...overrides,
  };
}

function controlHarness(initialStatus: "test" | "active" | "paused" = "active") {
  let status: "test" | "active" | "paused" = initialStatus;
  let liveAutomationEnabled = initialStatus === "active";
  let control = { liveOutboundEnabled: true, version: 7 };
  let otherDigest = "sha256:other-tenants";
  let authorityClean = true;
  let activeJobs = 0;
  let activeOutbounds = 0;
  let otherLiveTenantIds: string[] = [];
  const dependencies = {
    readTarget: vi.fn(async () => ({
      clinicId: LAB_ID,
      operationalStatus: status,
      isTest: true,
      isDemo: false,
      autoReplyEnabled: true,
      liveAutomationEnabled,
      shadowModeEnabled: false,
      authorityVersion: 2,
    })),
    readRuntimeControl: vi.fn(async () => ({ ...control })),
    readOtherTenantDigest: vi.fn(async () => otherDigest),
    readActivationGate: vi.fn(async () => ({
      authorityClean,
      activeJobs,
      activeOutbounds,
      liveTenantIds: [
        ...(status === "active" ? [LAB_ID] : []),
        ...otherLiveTenantIds,
      ],
    })),
    compareAndSetTenantStatus: vi.fn(async (input: {
      expectedStatus: "test" | "active" | "paused";
      nextStatus: "active" | "paused";
    }) => {
      if (status !== input.expectedStatus) return false;
      status = input.nextStatus;
      liveAutomationEnabled = input.nextStatus === "active";
      return true;
    }),
    compareAndSetGlobal: vi.fn(async (input: {
      expectedVersion: number;
      liveOutboundEnabled: boolean;
    }) => {
      if (control.version !== input.expectedVersion) return false;
      control = {
        liveOutboundEnabled: input.liveOutboundEnabled,
        version: input.expectedVersion + 1,
      };
      return true;
    }),
  };
  return {
    dependencies,
    changeOtherTenantDigest: () => { otherDigest = "sha256:mutated"; },
    setAuthorityClean: (value: boolean) => { authorityClean = value; },
    setActiveJobs: (value: number) => { activeJobs = value; },
    setActiveOutbounds: (value: number) => { activeOutbounds = value; },
    setOtherLiveTenantIds: (value: string[]) => { otherLiveTenantIds = value; },
  };
}

describe("V2-only rollout audit", () => {
  it("treats only a structurally missing pre-expand control table as closed", async () => {
    const rolloutAuditModule = await import("../../scripts/audit-v2-only-rollout");
    const readControl = (rolloutAuditModule as unknown as {
      readV2OnlyRolloutRuntimeControl?: (
        read: () => Promise<{ liveOutboundEnabled: boolean; version: number }>,
      ) => Promise<{ liveOutboundEnabled: boolean; version: number }>;
    }).readV2OnlyRolloutRuntimeControl;

    expect(readControl).toBeTypeOf("function");
    await expect(readControl!(async () => Promise.reject({ code: "42P01" })))
      .resolves.toEqual({ liveOutboundEnabled: false, version: 0 });
    await expect(readControl!(async () => Promise.reject({ code: "08006" })))
      .rejects.toEqual({ code: "08006" });
  });

  it("resolves job tenancy through durable inbound/outbound ownership", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/audit-v2-only-rollout.ts"), "utf8");

    expect(source).toMatch(/from \$\{jobs\} job/);
    expect(source).toMatch(/job\.inbound_event_id/);
    expect(source).toMatch(/job\.payload->>'outboundMessageId'/);
    expect(source).not.toMatch(/from \$\{jobs\}\s+where organization_id/);
    expect(source).toMatch(/to_jsonb\(organization\) \|\| jsonb_build_object/);
    expect(source).toMatch(/'live_automation_enabled'/);
    expect(source).toMatch(/to_jsonb\(authority\) as authority/);
  });

  it("reuses the structured authority validator inside the atomic opening fence", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/control-v2-only-rollout.ts"), "utf8");

    expect(source).toMatch(/buildWhatsAppStreamAuthorityValidationStatement/);
    expect(source).toMatch(/AUTHORITY_BLOCKING_VALIDATION_METRICS/);
    expect(source).toMatch(/validation\.metric/);
    expect(source).toMatch(/validation\.count/);
  });

  it("returns only sanitized counts, durable controls and tenant-scoped state", async () => {
    const result = await auditV2OnlyRollout({
      clinicId: LAB_ID,
      expectedLiveTenantIds: [LAB_ID],
    }, auditDependencies());

    expect(result).toEqual({
      clinicId: LAB_ID,
      deploymentSha: "candidate-sha",
      target: {
        operationalStatus: "active",
        isTest: true,
        isDemo: false,
        autoReplyEnabled: true,
        liveAutomationEnabled: true,
        shadowModeEnabled: false,
        authorityVersion: 2,
      },
      liveTenants: [{ clinicId: LAB_ID, operationalStatus: "active", authorityVersion: 2 }],
      queues: { pending: 0, processing: 0, failed: 0, locked: 0 },
      outbounds: { pending: 0, processing: 0, failed: 0 },
      runtimeControl: { liveOutboundEnabled: true, version: 7 },
      authority: { clean: true, metrics: AUTHORITY_METRICS },
      otherTenantDigest: "sha256:other-tenants",
    });
    expect(JSON.stringify(result)).not.toMatch(/phone|message|payload|database|credential|secret|https?:\/\//i);
  });

  it("fails the first-cut audit when another tenant is live", async () => {
    await expect(auditV2OnlyRollout({
      clinicId: LAB_ID,
      expectedLiveTenantIds: [LAB_ID],
    }, auditDependencies({
      readLiveTenants: vi.fn().mockResolvedValue([
        { clinicId: LAB_ID, operationalStatus: "active", authorityVersion: 2 },
        { clinicId: OTHER_ID, operationalStatus: "active", authorityVersion: 2 },
      ]),
    }))).rejects.toThrow(/live tenant set/i);
  });

  it("sanitizes a hostile audit failure without exposing runtime details", async () => {
    const lines: string[] = [];
    const result = await runV2OnlyRolloutAuditCommand({
      clinicId: LAB_ID,
      expectedLiveTenantIds: [LAB_ID],
    }, auditDependencies({
      readTarget: vi.fn().mockRejectedValue(new Error(
        "postgres://user:password@prod.invalid payload=private",
      )),
    }), (line) => lines.push(line));

    expect(result).toBeNull();
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      stage: "audit",
      reasonCodes: ["command_failed"],
    });
    expect(lines.join("\n")).not.toMatch(/postgres|password|prod\.invalid|payload|private/i);
  });

  it.each([
    ["authority is dirty", {
      readAuthorityValidation: vi.fn().mockResolvedValue({
        clinicId: LAB_ID,
        clean: false,
        issues: ["partial_claims=1"],
        metrics: AUTHORITY_METRICS.map((metric) =>
          metric.metric === "partial_claims" ? { ...metric, count: 1 } : metric),
      }),
    }, /authority validation/i],
    ["a process job is active", {
      readQueueCounts: vi.fn().mockResolvedValue({ pending: 1, processing: 0, failed: 0, locked: 0 }),
    }, /active jobs/i],
    ["a failed retryable job exists", {
      readQueueCounts: vi.fn().mockResolvedValue({ pending: 0, processing: 0, failed: 1, locked: 0 }),
    }, /active jobs/i],
    ["an outbound is active", {
      readOutboundCounts: vi.fn().mockResolvedValue({ pending: 0, processing: 1, failed: 0 }),
    }, /active outbounds/i],
    ["the target is below authority V2", {
      readTarget: vi.fn().mockResolvedValue({
        clinicId: LAB_ID,
        operationalStatus: "active",
        isTest: true,
        isDemo: false,
        autoReplyEnabled: true,
        shadowModeEnabled: false,
        authorityVersion: 1,
      }),
    }, /authority V2/i],
  ])("fails closed when %s", async (_case, override, error) => {
    await expect(auditV2OnlyRollout({
      clinicId: LAB_ID,
      expectedLiveTenantIds: [LAB_ID],
    }, auditDependencies(override))).rejects.toThrow(error);
  });
});

describe("V2-only rollout control", () => {
  it("fences the actual pre-cut Lab state through test -> paused only", async () => {
    const harness = controlHarness("test");
    const paused = await controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: {
        kind: "tenant_status",
        expectedStatus: "test",
        nextStatus: "paused",
      },
    }, harness.dependencies);

    expect(paused).toMatchObject({
      applied: true,
      affectedRows: 1,
      target: { operationalStatus: "paused", liveAutomationEnabled: false },
      otherTenantChanges: 0,
    });
    expect(harness.dependencies.compareAndSetTenantStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: LAB_ID,
        expectedStatus: "test",
        nextStatus: "paused",
      }),
    );
  });

  it("rejects bypassing the reviewed pause with a direct test -> active transition", async () => {
    const harness = controlHarness("test");

    await expect(controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      action: {
        kind: "tenant_status",
        expectedStatus: "test",
        nextStatus: "active",
      },
    }, harness.dependencies)).rejects.toThrow(/transition/i);
    expect(harness.dependencies.compareAndSetTenantStatus).not.toHaveBeenCalled();
  });

  it("is dry-run by default and writes neither tenant nor global control", async () => {
    const harness = controlHarness();
    const result = await controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      action: {
        kind: "tenant_status",
        expectedStatus: "active",
        nextStatus: "paused",
      },
    }, harness.dependencies);

    expect(result).toMatchObject({
      mode: "dry-run",
      applied: false,
      affectedRows: 0,
      otherTenantChanges: 0,
      target: { operationalStatus: "active", authorityVersion: 2 },
    });
    expect(harness.dependencies.compareAndSetTenantStatus).not.toHaveBeenCalled();
    expect(harness.dependencies.compareAndSetGlobal).not.toHaveBeenCalled();
  });

  it("pauses and reactivates only the exact Lab row by compare-and-set", async () => {
    const harness = controlHarness();
    const paused = await controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: {
        kind: "tenant_status",
        expectedStatus: "active",
        nextStatus: "paused",
      },
    }, harness.dependencies);
    const active = await controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: {
        kind: "tenant_status",
        expectedStatus: "paused",
        nextStatus: "active",
      },
    }, harness.dependencies);

    expect(paused).toMatchObject({
      applied: true,
      affectedRows: 1,
      target: { operationalStatus: "paused", liveAutomationEnabled: false },
    });
    expect(active).toMatchObject({
      applied: true,
      affectedRows: 1,
      target: { operationalStatus: "active", liveAutomationEnabled: true },
    });
    expect(harness.dependencies.compareAndSetTenantStatus).toHaveBeenNthCalledWith(1, expect.objectContaining({
      clinicId: LAB_ID,
      expectedStatus: "active",
      nextStatus: "paused",
    }));
    expect(harness.dependencies.compareAndSetTenantStatus).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clinicId: LAB_ID,
      expectedStatus: "paused",
      nextStatus: "active",
    }));
  });

  it("closes and opens only the singleton switch by durable version CAS", async () => {
    const harness = controlHarness();
    const closed = await controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: { kind: "global_control", expectedVersion: 7, liveOutboundEnabled: false },
    }, harness.dependencies);
    await controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: { kind: "tenant_status", expectedStatus: "active", nextStatus: "paused" },
    }, harness.dependencies);
    const opened = await controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: { kind: "global_control", expectedVersion: 8, liveOutboundEnabled: true },
    }, harness.dependencies);

    expect(closed).toMatchObject({ applied: true, affectedRows: 1, runtimeControl: { liveOutboundEnabled: false, version: 8 } });
    expect(opened).toMatchObject({ applied: true, affectedRows: 1, runtimeControl: { liveOutboundEnabled: true, version: 9 } });
    expect(harness.dependencies.compareAndSetTenantStatus).toHaveBeenCalledOnce();
  });

  it.each([
    ["Lab is active", (harness: ReturnType<typeof controlHarness>) => harness, /paused/i],
    ["another tenant is live", (harness: ReturnType<typeof controlHarness>) => {
      harness.setOtherLiveTenantIds([OTHER_ID]);
      return harness;
    }, /live tenant set/i],
    ["authority is dirty", (harness: ReturnType<typeof controlHarness>) => {
      harness.setAuthorityClean(false);
      return harness;
    }, /authority validation/i],
    ["jobs remain active", (harness: ReturnType<typeof controlHarness>) => {
      harness.setActiveJobs(1);
      return harness;
    }, /active jobs/i],
    ["outbounds remain active", (harness: ReturnType<typeof controlHarness>) => {
      harness.setActiveOutbounds(1);
      return harness;
    }, /active outbounds/i],
  ])("refuses to open the global switch when %s", async (_case, arrange, error) => {
    const harness = arrange(controlHarness());
    if (_case !== "Lab is active") {
      await controlV2OnlyRollout({
        clinicId: LAB_ID,
        actor: "Brendon Walefy",
        apply: true,
        action: { kind: "tenant_status", expectedStatus: "active", nextStatus: "paused" },
      }, harness.dependencies);
    }
    await expect(controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: { kind: "global_control", expectedVersion: 7, liveOutboundEnabled: true },
    }, harness.dependencies)).rejects.toThrow(error);
    expect(harness.dependencies.compareAndSetGlobal).not.toHaveBeenCalled();
  });

  it("fails closed when state changes between preflight and global CAS", async () => {
    const harness = controlHarness();
    await controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: { kind: "tenant_status", expectedStatus: "active", nextStatus: "paused" },
    }, harness.dependencies);
    harness.dependencies.compareAndSetGlobal.mockResolvedValue(false);

    await expect(controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: { kind: "global_control", expectedVersion: 7, liveOutboundEnabled: true },
    }, harness.dependencies)).rejects.toThrow(/compare-and-set/i);
  });

  it("sanitizes a hostile control failure", async () => {
    const lines: string[] = [];
    const result = await runV2OnlyRolloutControlCommand({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: { kind: "tenant_status", expectedStatus: "active", nextStatus: "paused" },
    }, {
      ...controlHarness().dependencies,
      compareAndSetTenantStatus: vi.fn().mockRejectedValue(new Error(
        "postgres://user:password@prod.invalid payload=private",
      )),
    }, (line) => lines.push(line));

    expect(result).toBeNull();
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      stage: "control",
      reasonCodes: ["command_failed"],
    });
    expect(lines.join("\n")).not.toMatch(/postgres|password|prod\.invalid|payload|private/i);
  });

  it.each([
    ["wrong tenant", { clinicId: OTHER_ID }, /SystemOps Lab/i],
    ["stale status", { action: { kind: "tenant_status", expectedStatus: "paused", nextStatus: "active" } }, /expected status/i],
    ["stale control", { action: { kind: "global_control", expectedVersion: 6, liveOutboundEnabled: false } }, /control version/i],
  ])("fails closed for %s", async (_case, patch, error) => {
    const harness = controlHarness();
    await expect(controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: {
        kind: "tenant_status",
        expectedStatus: "active",
        nextStatus: "paused",
      },
      ...patch,
    } as never, harness.dependencies)).rejects.toThrow(error);
    expect(harness.dependencies.compareAndSetTenantStatus).not.toHaveBeenCalled();
    expect(harness.dependencies.compareAndSetGlobal).not.toHaveBeenCalled();
  });

  it("rejects paused/demo/non-v2 activation without changing any row", async () => {
    for (const target of [
      { operationalStatus: "paused", isTest: true, isDemo: false, authorityVersion: 1 },
      { operationalStatus: "paused", isTest: true, isDemo: true, authorityVersion: 2 },
      { operationalStatus: "paused", isTest: false, isDemo: false, authorityVersion: 2 },
    ] as const) {
      const harness = controlHarness();
      harness.dependencies.readTarget.mockResolvedValue({
        clinicId: LAB_ID,
        autoReplyEnabled: true,
        liveAutomationEnabled: false,
        shadowModeEnabled: false,
        ...target,
      });
      await expect(controlV2OnlyRollout({
        clinicId: LAB_ID,
        actor: "Brendon Walefy",
        apply: true,
        action: { kind: "tenant_status", expectedStatus: "paused", nextStatus: "active" },
      }, harness.dependencies)).rejects.toThrow(/authority v2|test tenant|demo/i);
      expect(harness.dependencies.compareAndSetTenantStatus).not.toHaveBeenCalled();
    }
  });

  it("fails if any other-tenant snapshot changes", async () => {
    const harness = controlHarness();
    harness.dependencies.compareAndSetTenantStatus.mockImplementation(async () => {
      harness.changeOtherTenantDigest();
      return true;
    });
    await expect(controlV2OnlyRollout({
      clinicId: LAB_ID,
      actor: "Brendon Walefy",
      apply: true,
      action: { kind: "tenant_status", expectedStatus: "active", nextStatus: "paused" },
    }, harness.dependencies)).rejects.toThrow(/cross-tenant/i);
  });
});
