import { describe, expect, it, vi } from "vitest";
import {
  V2OnlyAutomationPolicy,
  type V2AutomationDecision,
} from "@/application/automation/v2-only-automation-policy";
import type { ClinicAutomationFacts } from "@/application/ports/clinic-automation-policy-reader";
import type { ConversationAuthorityVersion } from "@/application/ports/conversation-authority-store";

const CLINIC_ID = "clinic-v2";

const eligibleFacts: ClinicAutomationFacts = Object.freeze({
  clinicId: CLINIC_ID,
  isTest: false,
  isDemo: false,
  operationalStatus: "active",
  autoReplyEnabled: true,
  liveAutomationEnabled: true,
  shadowModeEnabled: false,
});

function expectedDecision(
  patch: Partial<V2AutomationDecision> = {},
): V2AutomationDecision {
  return {
    clinicId: CLINIC_ID,
    mode: "live",
    reason: "live_v2",
    authorityVersion: 2,
    runtimeControlVersion: 7,
    ...patch,
  };
}

function makePolicy(input: Readonly<{
  facts?: ClinicAutomationFacts | null;
  authorityVersion?: ConversationAuthorityVersion;
  liveOutboundEnabled?: boolean;
  runtimeControlVersion?: number;
}> = {}) {
  const failures: unknown[] = [];
  const clinicFactsReader = {
    getAutomationFacts: vi.fn().mockResolvedValue(
      input.facts === undefined ? eligibleFacts : input.facts,
    ),
  };
  const authorityStore = {
    getVersion: vi.fn().mockResolvedValue(input.authorityVersion ?? 2),
    compareAndSetVersion: vi.fn(),
  };
  const runtimeControlStore = {
    getGlobal: vi.fn().mockResolvedValue({
      liveOutboundEnabled: input.liveOutboundEnabled ?? true,
      version: input.runtimeControlVersion ?? 7,
    }),
    compareAndSetGlobal: vi.fn(),
  };
  const policy = new V2OnlyAutomationPolicy({
    clinicFactsReader,
    authorityStore,
    runtimeControlStore,
    onPolicyReadFailure: (failure) => {
      failures.push(failure);
    },
  });

  return {
    policy,
    clinicFactsReader,
    authorityStore,
    runtimeControlStore,
    failures,
  };
}

describe("V2OnlyAutomationPolicy", () => {
  it.each([2, 3] as const)(
    "admits authority version %s as live V2 when every gate is open",
    async (authorityVersion) => {
      const harness = makePolicy({
        authorityVersion,
        facts: authorityVersion === 2
          ? { ...eligibleFacts, isTest: true }
          : eligibleFacts,
      });

      await expect(harness.policy.decide(CLINIC_ID)).resolves.toEqual(
        expectedDecision({ authorityVersion }),
      );
      expect(harness.clinicFactsReader.getAutomationFacts)
        .toHaveBeenCalledExactlyOnceWith(CLINIC_ID);
      expect(harness.authorityStore.getVersion)
        .toHaveBeenCalledExactlyOnceWith(CLINIC_ID);
      expect(harness.runtimeControlStore.getGlobal).toHaveBeenCalledOnce();
      expect(harness.failures).toEqual([]);
    },
  );

  it.each([
    ["missing clinic", { facts: null }, { mode: "disabled", reason: "clinic_missing" }],
    ["prospect", { facts: { ...eligibleFacts, operationalStatus: "prospect" } }, { mode: "disabled", reason: "operational_status" }],
    ["test status", { facts: { ...eligibleFacts, operationalStatus: "test", isTest: true } }, { mode: "disabled", reason: "operational_status" }],
    ["paused", { facts: { ...eligibleFacts, operationalStatus: "paused" } }, { mode: "disabled", reason: "operational_status" }],
    ["cancelled", { facts: { ...eligibleFacts, operationalStatus: "cancelled" } }, { mode: "disabled", reason: "operational_status" }],
    ["demo", { facts: { ...eligibleFacts, isDemo: true, operationalStatus: "prospect" } }, { mode: "disabled", reason: "demo" }],
    ["auto reply off", { facts: { ...eligibleFacts, autoReplyEnabled: false } }, { mode: "disabled", reason: "auto_reply_disabled" }],
    ["authority missing", { authorityVersion: 0 }, { mode: "disabled", reason: "authority_below_v2", authorityVersion: 0 }],
    ["authority V1", { authorityVersion: 1 }, { mode: "disabled", reason: "authority_below_v2", authorityVersion: 1 }],
    ["global switch closed", { liveOutboundEnabled: false }, { mode: "disabled", reason: "global_kill_switch" }],
  ] as const)("returns an exact disabled reason for %s", async (_case, input, expected) => {
    const harness = makePolicy(input);

    const decision = await harness.policy.decide(CLINIC_ID);

    expect(decision).toEqual(expectedDecision(expected));
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it("keeps an otherwise eligible shadow tenant in observe mode", async () => {
    const harness = makePolicy({
      facts: { ...eligibleFacts, shadowModeEnabled: true },
    });

    await expect(harness.policy.decide(CLINIC_ID)).resolves.toEqual(
      expectedDecision({ mode: "observe", reason: "shadow_observe" }),
    );
  });

  it("keeps an active authority-v2 tenant disabled without its explicit live permit", async () => {
    const harness = makePolicy({
      facts: {
        ...eligibleFacts,
        liveAutomationEnabled: false,
      },
    });

    await expect(harness.policy.decide(CLINIC_ID)).resolves.toEqual(
      expectedDecision({
        mode: "disabled",
        reason: "tenant_live_disabled",
      }),
    );
  });

  it("starts all independent source reads before awaiting any one of them", async () => {
    let resolveFacts!: (value: ClinicAutomationFacts) => void;
    let resolveAuthority!: (value: ConversationAuthorityVersion) => void;
    let resolveControl!: (value: { liveOutboundEnabled: boolean; version: number }) => void;
    const clinicFactsReader = {
      getAutomationFacts: vi.fn(() => new Promise<ClinicAutomationFacts>((resolve) => {
        resolveFacts = resolve;
      })),
    };
    const authorityStore = {
      getVersion: vi.fn(() => new Promise<ConversationAuthorityVersion>((resolve) => {
        resolveAuthority = resolve;
      })),
      compareAndSetVersion: vi.fn(),
    };
    const runtimeControlStore = {
      getGlobal: vi.fn(() => new Promise<{ liveOutboundEnabled: boolean; version: number }>((resolve) => {
        resolveControl = resolve;
      })),
      compareAndSetGlobal: vi.fn(),
    };
    const policy = new V2OnlyAutomationPolicy({
      clinicFactsReader,
      authorityStore,
      runtimeControlStore,
    });

    const pendingDecision = policy.decide(CLINIC_ID);
    await Promise.resolve();

    expect(clinicFactsReader.getAutomationFacts).toHaveBeenCalledWith(CLINIC_ID);
    expect(authorityStore.getVersion).toHaveBeenCalledWith(CLINIC_ID);
    expect(runtimeControlStore.getGlobal).toHaveBeenCalledOnce();

    resolveFacts(eligibleFacts);
    resolveAuthority(2);
    resolveControl({ liveOutboundEnabled: true, version: 7 });
    await expect(pendingDecision).resolves.toEqual(expectedDecision());
  });

  it.each(["clinic", "authority", "runtime control"] as const)(
    "fails closed and emits only sanitized policy metadata when the %s read fails",
    async (source) => {
      const secret = "postgres://user:credential@private-host/database";
      const harness = makePolicy();
      if (source === "clinic") {
        harness.clinicFactsReader.getAutomationFacts.mockRejectedValue(new Error(secret));
      } else if (source === "authority") {
        harness.authorityStore.getVersion.mockRejectedValue(new Error(secret));
      } else {
        harness.runtimeControlStore.getGlobal.mockRejectedValue(new Error(secret));
      }

      await expect(harness.policy.decide(CLINIC_ID)).resolves.toEqual(
        expectedDecision({
          mode: "disabled",
          reason: "global_kill_switch",
          authorityVersion: 0,
          runtimeControlVersion: 0,
        }),
      );
      expect(harness.failures).toEqual([{
        clinicId: CLINIC_ID,
        reason: "policy_read_failure",
      }]);
      expect(JSON.stringify(harness.failures)).not.toContain(secret);
    },
  );
});
