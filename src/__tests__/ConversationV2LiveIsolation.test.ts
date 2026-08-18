import { describe, expect, it } from "vitest";
import type {
  ConversationHandleInput,
  ConversationHandleResult,
  ConversationHandler,
} from "@/application/ports/conversation-handler";
import type { ConversationEnginePolicy } from "@/application/conversation-v2/engine-selection";
import type { InternalLabEligibilityFacts } from "@/application/ports/internal-lab-eligibility-reader";
import {
  TenantEngineRouter,
  V2ShadowSelectionRegistry,
} from "@/application/conversation-v2/tenant-engine-router";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";
import { createConversationV2Runtime } from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";
import {
  createRegisteredInternalLabDeploymentSmokeApproval,
  INTERNAL_LAB_TEST_BINDINGS,
} from "./helpers/internal-lab-approval-fixture";

const approval = createRegisteredInternalLabDeploymentSmokeApproval();

const labTurn: ConversationHandleInput = {
  clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
  phone: "5511999999999",
  messageText: "Quero agendar",
  messageId: "provider-message-1",
  turnId: "turn-1",
  timestamp: INTERNAL_LAB_TEST_BINDINGS.now,
  automationMode: "live",
};

class MutablePolicyReader {
  private readonly policies = new Map<string, ConversationEnginePolicy>();

  set(policy: ConversationEnginePolicy): void {
    this.policies.set(policy.clinicId, Object.freeze({ ...policy }));
  }

  async getConversationEnginePolicy(clinicId: string): Promise<ConversationEnginePolicy> {
    return this.policies.get(clinicId) ?? { clinicId, engine: "v1", isTest: false };
  }
}

class RecordingHandler implements ConversationHandler {
  readonly turns: string[] = [];

  constructor(
    private readonly engine: "v1" | "v2",
    private readonly failTurnId: string | null = null,
  ) {}

  async handle(input: ConversationHandleInput): Promise<ConversationHandleResult> {
    this.turns.push(input.turnId ?? input.messageId);
    if ((input.turnId ?? input.messageId) === this.failTurnId) {
      throw new Error("v2 terminal failure");
    }
    return { replied: true, reason: this.engine };
  }
}

function createRouterHarness(input: {
  policy?: ConversationEnginePolicy;
  failV2TurnId?: string;
  approvalPresent?: boolean;
} = {}) {
  const policyReader = new MutablePolicyReader();
  policyReader.set(input.policy ?? {
    clinicId: labTurn.clinicId,
    engine: "v2_internal",
    isTest: true,
  });
  const bindings = {
    tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
    channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
    configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
  };
  const eligibility = new Map<string, InternalLabEligibilityFacts>([[labTurn.clinicId, {
    clinicId: labTurn.clinicId,
    isTest: true,
    isDemo: false,
    operationalStatus: "test" as const,
    autoReplyEnabled: true,
    shadowModeEnabled: false,
  }]]);
  const v1 = new RecordingHandler("v1");
  const v2 = new RecordingHandler("v2", input.failV2TurnId ?? null);
  const trace = new InMemoryDecisionTraceSink();
  const router = new TenantEngineRouter({
    v1Handler: v1,
    v2Handler: v2,
    policyReader,
    eligibilityReader: {
      async getInternalLabEligibilityFacts(clinicId) {
        return eligibility.get(clinicId) ?? null;
      },
    },
    runtimeBindingsReader: {
      async resolve() { return Object.freeze({ ...bindings }); },
    },
    shadowSelections: new V2ShadowSelectionRegistry(),
    decisionTraceSink: trace,
    liveProviderReady: true,
    approval: input.approvalPresent === false ? null : approval.approval,
    runtimeIdentity: approval.runtimeIdentity,
    expectedClinicId: labTurn.clinicId,
    expectedTenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
    expectedChannelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
    expectedConfigDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
    now: () => new Date(INTERNAL_LAB_TEST_BINDINGS.now),
  });
  return { bindings, eligibility, policyReader, router, trace, v1, v2 };
}

describe("Conversation V2 live tenant isolation", () => {
  it("keeps the default composition on configured V1 without touching a database", async () => {
    const policyReader = new MutablePolicyReader();
    policyReader.set({ clinicId: labTurn.clinicId, engine: "v1", isTest: true });
    const v1 = new RecordingHandler("v1");
    const v2 = new RecordingHandler("v2");
    const runtime = createConversationV2Runtime({
      env: { ...process.env, OPENAI_API_KEY: "task-7-test-key" },
      policyReader,
      v1Handler: v1,
      v2Handler: v2,
      authorizationBindings: {
        approval: approval.approval,
        runtimeIdentity: approval.runtimeIdentity,
        expectedClinicId: labTurn.clinicId,
        expectedTenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
        expectedChannelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
        expectedConfigDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
        now: () => new Date(INTERNAL_LAB_TEST_BINDINGS.now),
      },
      runtimeBindingsReader: { async resolve() { return {
        tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
        channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
        configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
      }; } },
    });

    await expect(runtime.conversationHandler.handle(labTurn)).resolves.toEqual({
      replied: true,
      reason: "v1",
    });
    expect(v1.turns).toEqual(["turn-1"]);
    expect(v2.turns).toEqual([]);
  });

  it("fails closed before V2 when tenant, channel binding, or approval eligibility drifts", async () => {
    const scenarios = [
      {
        name: "different tenant",
        mutate(harness: ReturnType<typeof createRouterHarness>) {
          harness.policyReader.set({ clinicId: "external-tenant", engine: "v2_internal", isTest: true });
        },
        turn: { ...labTurn, clinicId: "external-tenant", turnId: "tenant-drift" },
      },
      {
        name: "channel digest",
        mutate(harness: ReturnType<typeof createRouterHarness>) {
          harness.bindings.channelDigest = `hmac:${"b".repeat(64)}`;
        },
        turn: { ...labTurn, messageId: "provider-message-2", turnId: "channel-drift" },
      },
      {
        name: "test eligibility",
        mutate(harness: ReturnType<typeof createRouterHarness>) {
          harness.eligibility.set(labTurn.clinicId, {
            ...harness.eligibility.get(labTurn.clinicId)!,
            isTest: false,
          });
        },
        turn: { ...labTurn, messageId: "provider-message-3", turnId: "eligibility-drift" },
      },
    ] as const;

    for (const scenario of scenarios) {
      const harness = createRouterHarness();
      scenario.mutate(harness);

      await expect(harness.router.handle(scenario.turn)).resolves.toEqual({
        replied: true,
        reason: "v1",
      });
      expect(harness.v2.turns, scenario.name).toEqual([]);
      expect(harness.trace.getEvents(scenario.turn.turnId)).toEqual([
        expect.objectContaining({
          stage: "engine.selected",
          metadata: {
            route: "v1",
            shadow: false,
            reason: "internal_lab_not_eligible",
          },
        }),
      ]);
    }
  });

  it("fails closed when the Internal Lab approval is removed", async () => {
    const harness = createRouterHarness({ approvalPresent: false });

    await expect(harness.router.handle({
      ...labTurn,
      messageId: "provider-approval-removed",
      turnId: "approval-removed",
    })).resolves.toEqual({ replied: true, reason: "v1" });
    expect(harness.v2.turns).toEqual([]);
    expect(harness.trace.getEvents("approval-removed")[0]).toMatchObject({
      stage: "engine.selected",
      metadata: { route: "v1", reason: "internal_lab_not_eligible" },
    });
  });

  it("never invokes V1 after a V2 failure and applies a flag change only to the next turn", async () => {
    const harness = createRouterHarness({ failV2TurnId: "failed-v2" });
    const failedTurn = {
      ...labTurn,
      messageId: "provider-failed-v2",
      turnId: "failed-v2",
    };

    await expect(harness.router.handle(failedTurn)).rejects.toThrow("v2 terminal failure");
    expect(harness.v1.turns).toEqual([]);
    expect(harness.v2.turns).toEqual(["failed-v2"]);

    harness.policyReader.set({
      clinicId: labTurn.clinicId,
      engine: "v1",
      isTest: true,
    });
    const nextTurn = {
      ...labTurn,
      messageId: "provider-next-turn",
      turnId: "next-turn",
    };
    await expect(harness.router.handle(nextTurn)).resolves.toEqual({
      replied: true,
      reason: "v1",
    });

    expect(harness.v1.turns).toEqual(["next-turn"]);
    expect(harness.v2.turns).toEqual(["failed-v2"]);
    expect(harness.trace.getEvents().filter(({ stage }) => stage === "engine.selected")
      .map(({ turnId, metadata }) => ({ turnId, route: metadata?.route })))
      .toEqual([
        { turnId: "failed-v2", route: "v2" },
        { turnId: "next-turn", route: "v1" },
      ]);
  });
});
