import type { ConversationEnginePolicyReader } from "@/application/ports/conversation-engine-policy-reader";
import type {
  ConversationHandler,
  ConversationHandleInput,
  ConversationHandleResult,
} from "@/application/ports/conversation-handler";
import type { InternalLabEligibilityReader } from "@/application/ports/internal-lab-eligibility-reader";
import type { InternalLabRuntimeBindingsReader } from "@/application/conversation-v2/internal-lab-runtime-bindings";
import { canonicalizeConversationEnginePolicy } from "@/application/conversation-v2/engine-selection";
import {
  isInternalLabAuthorized,
  type InternalLabAuthorizationBindings,
} from "@/application/conversation-v2/internal-lab-authorization";
import {
  recordDecisionTrace,
  type DecisionTraceSink,
} from "@/core/observability/DecisionTrace";

export type EffectiveConversationEngine =
  | Readonly<{
      route: "v1";
      shadow: false;
      reason: "configured_v1" | "automation_not_live" | "internal_lab_not_eligible";
    }>
  | Readonly<{ route: "v1"; shadow: true; reason: "configured_shadow" }>
  | Readonly<{ route: "v2"; shadow: false; reason: "internal_lab_authorized" }>;

export type V2ShadowSelection = Readonly<{ turnId: string; clinicId: string }>;

const registeredSelectionSnapshots = new WeakSet<object>();
const consumedSelectionSnapshots = new WeakSet<object>();

export class V2ShadowSelectionRegistry {
  private readonly selections = new Map<string, V2ShadowSelection>();

  register(input: { turnId: string; clinicId: string }): void {
    if (!input || typeof input.turnId !== "string" || input.turnId.length === 0
      || typeof input.clinicId !== "string" || input.clinicId.length === 0) {
      throw new Error("invalid V2 shadow selection");
    }
    const existing = this.selections.get(input.turnId);
    if (existing && existing.clinicId !== input.clinicId) {
      throw new Error("V2 shadow selection tenant mismatch");
    }
    this.selections.set(input.turnId, Object.freeze({
      turnId: input.turnId,
      clinicId: input.clinicId,
    }));
  }

  consumeAll(): readonly V2ShadowSelection[] {
    const snapshot = Object.freeze([...this.selections.values()]);
    this.selections.clear();
    registeredSelectionSnapshots.add(snapshot);
    return snapshot;
  }
}

export function consumeRegisteredV2ShadowSelections(
  input: readonly V2ShadowSelection[],
): readonly V2ShadowSelection[] {
  if (!registeredSelectionSnapshots.has(input) || consumedSelectionSnapshots.has(input)) {
    throw new Error("V2 shadow selections are not a fresh registered snapshot");
  }
  consumedSelectionSnapshots.add(input);
  return input;
}

type RouterDependencies = Readonly<{
  v1Handler: ConversationHandler;
  v2Handler: ConversationHandler;
  policyReader: ConversationEnginePolicyReader;
  eligibilityReader: InternalLabEligibilityReader;
  shadowSelections: V2ShadowSelectionRegistry;
  decisionTraceSink?: DecisionTraceSink;
  runtimeBindingsReader: InternalLabRuntimeBindingsReader;
  liveProviderReady: boolean;
}> & InternalLabAuthorizationBindings;

export class TenantEngineRouter implements ConversationHandler {
  constructor(private readonly deps: RouterDependencies) {
    if (typeof deps.expectedClinicId !== "string" || deps.expectedClinicId.length === 0) {
      throw new Error("Internal Lab expected clinic id is required");
    }
  }

  async handle(input: ConversationHandleInput): Promise<ConversationHandleResult> {
    const effective = await this.selectEngine(input);
    if (input.turnId) {
      await recordDecisionTrace(this.deps.decisionTraceSink, {
        turnId: input.turnId,
        clinicId: input.clinicId,
        stage: "engine.selected",
        occurredAt: new Date().toISOString(),
        metadata: {
          route: effective.route,
          shadow: effective.shadow,
          reason: effective.reason,
        },
      });
    }

    if (effective.route === "v2") {
      return this.deps.v2Handler.handle(input);
    }

    const result = await this.deps.v1Handler.handle(input);
    if (effective.shadow && input.turnId) {
      this.deps.shadowSelections.register({ turnId: input.turnId, clinicId: input.clinicId });
    }
    return result;
  }

  private async selectEngine(
    input: ConversationHandleInput,
  ): Promise<EffectiveConversationEngine> {
    let policy;
    try {
      policy = canonicalizeConversationEnginePolicy(
        await this.deps.policyReader.getConversationEnginePolicy(input.clinicId),
        input.clinicId,
      );
    } catch {
      return { route: "v1", shadow: false, reason: "internal_lab_not_eligible" };
    }

    if (input.automationMode !== "live") {
      return { route: "v1", shadow: false, reason: "automation_not_live" };
    }
    if (policy.engine === "v1") {
      return { route: "v1", shadow: false, reason: "configured_v1" };
    }
    if (policy.engine === "v1_with_v2_shadow") {
      return { route: "v1", shadow: true, reason: "configured_shadow" };
    }
    if (input.clinicId !== this.deps.expectedClinicId || !policy.isTest) {
      return { route: "v1", shadow: false, reason: "internal_lab_not_eligible" };
    }
    if (!this.deps.liveProviderReady) {
      return { route: "v1", shadow: false, reason: "internal_lab_not_eligible" };
    }

    try {
      const [facts, currentBindings] = await Promise.all([
        this.deps.eligibilityReader.getInternalLabEligibilityFacts(input.clinicId),
        this.deps.runtimeBindingsReader.resolve(input.clinicId),
      ]);
      if (!isInternalLabAuthorized(facts, {
        ...this.deps,
        expectedTenantDigest: currentBindings.tenantDigest,
        expectedChannelDigest: currentBindings.channelDigest,
        expectedConfigDigest: currentBindings.configDigest,
      })) {
        return { route: "v1", shadow: false, reason: "internal_lab_not_eligible" };
      }
    } catch {
      return { route: "v1", shadow: false, reason: "internal_lab_not_eligible" };
    }
    return { route: "v2", shadow: false, reason: "internal_lab_authorized" };
  }
}
