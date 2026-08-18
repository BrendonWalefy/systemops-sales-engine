import { describe, expect, it, vi } from "vitest";
import { TenantEngineRouter, V2ShadowSelectionRegistry } from "@/application/conversation-v2/tenant-engine-router";
import type { ConversationHandleInput } from "@/application/ports/conversation-handler";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";
import { createRegisteredInternalLabSmokeApproval, INTERNAL_LAB_TEST_BINDINGS } from "@/__tests__/helpers/internal-lab-approval-fixture";

const turn = Object.freeze({
  clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
  phone: "synthetic:lead-1", messageText: "Quanto custa?", messageId: "message-1",
  timestamp: new Date("2026-08-17T15:05:00.000Z"), turnId: "turn-1", automationMode: "live" as const,
}) satisfies ConversationHandleInput;

const eligibleFacts = Object.freeze({
  clinicId: turn.clinicId,
  isTest: true,
  isDemo: false,
  operationalStatus: "test" as const,
  autoReplyEnabled: true,
  shadowModeEnabled: false,
});

function eligibilityReaderWith(overrides: Record<string, unknown> = {}) {
  return { getInternalLabEligibilityFacts: vi.fn().mockResolvedValue({
    ...eligibleFacts,
    ...overrides,
  }) };
}

function makeRouter(overrides: Record<string, unknown> = {}) {
  const registered = createRegisteredInternalLabSmokeApproval();
  const defaults = {
    v1Handler: { handle: vi.fn().mockResolvedValue({ replied: true }) },
    v2Handler: { handle: vi.fn().mockResolvedValue({ replied: true }) },
    policyReader: { getConversationEnginePolicy: vi.fn().mockResolvedValue({ clinicId: turn.clinicId, engine: "v2_internal", isTest: true }) },
    eligibilityReader: eligibilityReaderWith(),
    approval: registered.approval,
    runtimeIdentity: registered.runtimeIdentity,
    expectedClinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
    expectedTenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
    expectedChannelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
    expectedConfigDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
    runtimeBindingsReader: {
      resolve: vi.fn().mockResolvedValue({
        tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
        channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
        configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
      }),
    },
    liveProviderReady: true,
    now: () => INTERNAL_LAB_TEST_BINDINGS.now,
    shadowSelections: new V2ShadowSelectionRegistry(),
    decisionTraceSink: new InMemoryDecisionTraceSink(),
    ...overrides,
  };
  return { router: new TenantEngineRouter(defaults as never), ...defaults };
}

describe("TenantEngineRouter", () => {
  it("routes the exact eligible Internal Lab turn to V2 exactly once", async () => {
    const fixture = makeRouter();
    await expect(fixture.router.handle(turn)).resolves.toEqual({ replied: true });
    expect(fixture.v2Handler.handle).toHaveBeenCalledTimes(1);
    expect(fixture.v1Handler.handle).not.toHaveBeenCalled();
    expect(fixture.decisionTraceSink.getEvents(turn.turnId).at(-1)).toMatchObject({
      stage: "engine.selected", metadata: { route: "v2", shadow: false, reason: "internal_lab_authorized" },
    });
    expect(fixture.decisionTraceSink.getEvents(turn.turnId)
      .filter(({ stage }) => stage === "engine.selected")).toHaveLength(1);
  });

  it("never calls V1 after a V2 exception in the same turn", async () => {
    const v2Handler = { handle: vi.fn().mockRejectedValue(new Error("v2 failed")) };
    const fixture = makeRouter({ v2Handler });
    await expect(fixture.router.handle(turn)).rejects.toThrow("v2 failed");
    expect(v2Handler.handle).toHaveBeenCalledTimes(1);
    expect(fixture.v1Handler.handle).not.toHaveBeenCalled();
  });

  it("fails closed when the current resolved tenant facts drift from the signed approval", async () => {
    const runtimeBindingsReader = {
      resolve: vi.fn().mockResolvedValue({
        tenantDigest: `sha256:${"1".repeat(64)}`,
        channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
        configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
      }),
    };
    const fixture = makeRouter({ runtimeBindingsReader });

    await expect(fixture.router.handle(turn)).resolves.toEqual({ replied: true });

    expect(runtimeBindingsReader.resolve).toHaveBeenCalledWith(turn.clinicId);
    expect(fixture.v1Handler.handle).toHaveBeenCalledOnce();
    expect(fixture.v2Handler.handle).not.toHaveBeenCalled();
  });

  it("fails closed before V2 when the live understanding provider is unavailable", async () => {
    const fixture = makeRouter({ liveProviderReady: false });

    await expect(fixture.router.handle(turn)).resolves.toEqual({ replied: true });

    expect(fixture.v1Handler.handle).toHaveBeenCalledOnce();
    expect(fixture.v2Handler.handle).not.toHaveBeenCalled();
  });

  it("fails closed for a different test tenant even when all structural facts match", async () => {
    const other = { ...turn, clinicId: "other-test-tenant", turnId: "turn-other" };
    const fixture = makeRouter({
      policyReader: { getConversationEnginePolicy: vi.fn().mockResolvedValue({ clinicId: other.clinicId, engine: "v2_internal", isTest: true }) },
      eligibilityReader: { getInternalLabEligibilityFacts: vi.fn().mockResolvedValue({
        clinicId: other.clinicId, isTest: true, isDemo: false, operationalStatus: "test",
        autoReplyEnabled: true, shadowModeEnabled: false,
      }) },
    });
    await fixture.router.handle(other);
    expect(fixture.v1Handler.handle).toHaveBeenCalledTimes(1);
    expect(fixture.v2Handler.handle).not.toHaveBeenCalled();
    expect(fixture.eligibilityReader.getInternalLabEligibilityFacts).not.toHaveBeenCalled();
  });

  it.each([
    ["automation disabled", { input: { automationMode: "disabled" as const } }],
    ["automation observe", { input: { automationMode: "observe" as const } }],
    ["configured V1", { overrides: { policyReader: { getConversationEnginePolicy: vi.fn().mockResolvedValue({
      clinicId: turn.clinicId, engine: "v1", isTest: true,
    }) } } }],
    ["missing approval", { overrides: { approval: null } }],
    ["expired approval", { overrides: { now: () => new Date("2026-08-17T15:11:00.000Z") } }],
    ["missing runtime", { overrides: { runtimeIdentity: null } }],
    ["policy isTest false", { overrides: { policyReader: { getConversationEnginePolicy: vi.fn().mockResolvedValue({
      clinicId: turn.clinicId, engine: "v2_internal", isTest: false,
    }) } } }],
    ["missing eligibility", { overrides: { eligibilityReader: {
      getInternalLabEligibilityFacts: vi.fn().mockResolvedValue(null),
    } } }],
    ["eligibility clinic mismatch", { overrides: { eligibilityReader: eligibilityReaderWith({ clinicId: "other-test-tenant" }) } }],
    ["eligibility isTest false", { overrides: { eligibilityReader: eligibilityReaderWith({ isTest: false }) } }],
    ["eligibility isDemo true", { overrides: { eligibilityReader: eligibilityReaderWith({ isDemo: true }) } }],
    ["eligibility status active", { overrides: { eligibilityReader: eligibilityReaderWith({ operationalStatus: "active" }) } }],
    ["eligibility autoReply false", { overrides: { eligibilityReader: eligibilityReaderWith({ autoReplyEnabled: false }) } }],
    ["eligibility shadow true", { overrides: { eligibilityReader: eligibilityReaderWith({ shadowModeEnabled: true }) } }],
  ] as const)("routes %s fail-closed through V1", async (_name, scenario) => {
    const fixture = makeRouter("overrides" in scenario ? scenario.overrides : {});
    const input = { ...turn, ...("input" in scenario ? scenario.input : {}) };

    await expect(fixture.router.handle(input)).resolves.toEqual({ replied: true });
    expect(fixture.v1Handler.handle).toHaveBeenCalledTimes(1);
    expect(fixture.v2Handler.handle).not.toHaveBeenCalled();
  });

  it("registers a shadow turn only after V1 succeeds", async () => {
    const policyReader = { getConversationEnginePolicy: vi.fn().mockResolvedValue({
      clinicId: turn.clinicId, engine: "v1_with_v2_shadow", isTest: true,
    }) };
    const fixture = makeRouter({ policyReader });
    await fixture.router.handle(turn);
    expect(fixture.shadowSelections.consumeAll()).toEqual([{ turnId: turn.turnId, clinicId: turn.clinicId }]);
  });

  it("does not register shadow when V1 fails", async () => {
    const policyReader = { getConversationEnginePolicy: vi.fn().mockResolvedValue({
      clinicId: turn.clinicId, engine: "v1_with_v2_shadow", isTest: true,
    }) };
    const fixture = makeRouter({
      policyReader,
      v1Handler: { handle: vi.fn().mockRejectedValue(new Error("v1 failed")) },
    });

    await expect(fixture.router.handle(turn)).rejects.toThrow("v1 failed");
    expect(fixture.v2Handler.handle).not.toHaveBeenCalled();
    expect(fixture.shadowSelections.consumeAll()).toEqual([]);
  });
});
