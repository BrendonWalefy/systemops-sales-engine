import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  TenantEngineRouter,
  V2ShadowSelectionRegistry,
} from "@/application/conversation-v2/tenant-engine-router";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";
import { createRegisteredInternalLabApprovalFixture } from "@/__tests__/test-support/registered-internal-lab-approval";

type ApprovalFixture = ReturnType<typeof createRegisteredInternalLabApprovalFixture>;
let registered: ApprovalFixture;

const turn = {
  clinicId: "systemops-lab",
  phone: "5511999999999",
  messageText: "conteúdo privado que nunca entra no trace",
  messageId: "message-1",
  timestamp: new Date("2026-08-17T15:05:00.000Z"),
  turnId: "turn-1",
  automationMode: "live" as const,
};

const eligibleFacts = {
  clinicId: "systemops-lab",
  isTest: true,
  isDemo: false,
  operationalStatus: "test" as const,
  autoReplyEnabled: true,
  shadowModeEnabled: false,
};

beforeAll(() => {
  registered = createRegisteredInternalLabApprovalFixture();
});

afterAll(() => registered.restoreEnvironment());

function makeRouter(input: {
  engine?: "v1" | "v1_with_v2_shadow" | "v2_internal";
  facts?: typeof eligibleFacts | null;
  automationMode?: "live" | "observe" | "disabled";
  approval?: ApprovalFixture["approval"] | null;
  runtimeIdentity?: ApprovalFixture["runtimeIdentity"] | null;
  expectedClinicId?: string;
  target?: ApprovalFixture["target"];
} = {}) {
  const policyReader = {
    getConversationEnginePolicy: vi.fn(async () => ({
      clinicId: turn.clinicId,
      engine: input.engine ?? "v2_internal",
      isTest: true,
    })),
  };
  const eligibilityReader = {
    getInternalLabEligibilityFacts: vi.fn(async () =>
      input.facts === undefined ? eligibleFacts : input.facts),
  };
  const v1 = { handle: vi.fn().mockResolvedValue({ replied: true, reason: "v1" }) };
  const v2 = { handle: vi.fn().mockResolvedValue({ replied: true, reason: "v2" }) };
  const shadowSelections = new V2ShadowSelectionRegistry();
  const decisionTraceSink = new InMemoryDecisionTraceSink();
  const router = new TenantEngineRouter({
    policyReader,
    eligibilityReader,
    v1,
    v2,
    shadowSelections,
    approval: input.approval === undefined ? registered.approval : input.approval,
    runtimeIdentity: input.runtimeIdentity === undefined
      ? registered.runtimeIdentity
      : input.runtimeIdentity,
    expectedClinicId: input.expectedClinicId ?? "systemops-lab",
    internalLabTarget: input.target ?? registered.target,
    now: () => registered.now,
    decisionTraceSink,
  });
  return {
    router,
    policyReader,
    eligibilityReader,
    v1,
    v2,
    shadowSelections,
    decisionTraceSink,
    input: { ...turn, automationMode: input.automationMode ?? "live" },
  };
}

describe("TenantEngineRouter", () => {
  it("routes an exactly eligible v2_internal turn to V2 once without calling V1", async () => {
    const { router, input, v1, v2, policyReader, eligibilityReader } = makeRouter();

    await expect(router.handle(input)).resolves.toEqual({ replied: true, reason: "v2" });

    expect(v2.handle).toHaveBeenCalledOnce();
    expect(v1.handle).not.toHaveBeenCalled();
    expect(policyReader.getConversationEnginePolicy).toHaveBeenCalledOnce();
    expect(eligibilityReader.getInternalLabEligibilityFacts).toHaveBeenCalledOnce();
  });

  it("never calls V1 after the selected V2 handler throws", async () => {
    const { router, input, v1, v2 } = makeRouter();
    v2.handle.mockRejectedValue(new Error("v2 failed"));

    await expect(router.handle(input)).rejects.toThrow("v2 failed");

    expect(v2.handle).toHaveBeenCalledOnce();
    expect(v1.handle).not.toHaveBeenCalled();
  });

  it.each([
    ["missing approval", { approval: null }],
    ["missing runtime identity", { runtimeIdentity: null }],
    ["wrong raw tenant target", { expectedClinicId: "another-lab" }],
    ["different registered tenant digest", { target: { tenantDigest: "hmac:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", channelDigest: "hmac:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0", configDigest: "hmac:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }],
    ["not a test tenant", { facts: { ...eligibleFacts, isTest: false } }],
    ["demo tenant", { facts: { ...eligibleFacts, isDemo: true } }],
    ["non-test status", { facts: { ...eligibleFacts, operationalStatus: "active" as const } }],
    ["auto reply disabled", { facts: { ...eligibleFacts, autoReplyEnabled: false } }],
    ["legacy shadow enabled", { facts: { ...eligibleFacts, shadowModeEnabled: true } }],
  ] as const)("fails closed to V1 when v2_internal has %s", async (_case, override) => {
    const { router, input, v1, v2 } = makeRouter(override as never);

    await expect(router.handle(input)).resolves.toEqual({ replied: true, reason: "v1" });

    expect(v1.handle).toHaveBeenCalledOnce();
    expect(v2.handle).not.toHaveBeenCalled();
  });

  it("records shadow selection at the router and still calls only V1", async () => {
    const { router, input, v1, v2, shadowSelections } = makeRouter({
      engine: "v1_with_v2_shadow",
    });

    await router.handle(input);

    expect(v1.handle).toHaveBeenCalledOnce();
    expect(v2.handle).not.toHaveBeenCalled();
    expect(shadowSelections.consumeAll()).toEqual([
      { turnId: "turn-1", clinicId: "systemops-lab" },
    ]);
    expect(shadowSelections.consumeAll()).toEqual([]);
  });

  it.each(["observe", "disabled"] as const)(
    "keeps automation=%s on V1 without reading engine or Lab eligibility",
    async (automationMode) => {
      const { router, input, v1, v2, policyReader, eligibilityReader } = makeRouter({
        automationMode,
      });

      await router.handle(input);

      expect(v1.handle).toHaveBeenCalledOnce();
      expect(v2.handle).not.toHaveBeenCalled();
      expect(policyReader.getConversationEnginePolicy).not.toHaveBeenCalled();
      expect(eligibilityReader.getInternalLabEligibilityFacts).not.toHaveBeenCalled();
    },
  );

  it("rejects a policy bound to another tenant before either handler can run", async () => {
    const setup = makeRouter({ engine: "v1" });
    setup.policyReader.getConversationEnginePolicy.mockResolvedValue({
      clinicId: "other-tenant",
      engine: "v1",
      isTest: true,
    });

    await expect(setup.router.handle(setup.input)).rejects.toThrow(/policy|clinic|tenant/i);

    expect(setup.v1.handle).not.toHaveBeenCalled();
    expect(setup.v2.handle).not.toHaveBeenCalled();
  });

  it("records only allowlisted engine selection metadata, never turn content or contact data", async () => {
    const { router, input, decisionTraceSink } = makeRouter();

    await router.handle(input);

    expect(decisionTraceSink.getEvents("turn-1")).toEqual([
      expect.objectContaining({
        stage: "engine.selected",
        clinicId: "systemops-lab",
        metadata: {
          route: "v2",
          shadow: false,
          reason: "internal_lab_authorized",
        },
      }),
    ]);
    const serialized = JSON.stringify(decisionTraceSink.getEvents("turn-1"));
    expect(serialized).not.toContain(turn.phone);
    expect(serialized).not.toContain(turn.messageText);
    expect(serialized).not.toContain(turn.messageId);
  });
});
