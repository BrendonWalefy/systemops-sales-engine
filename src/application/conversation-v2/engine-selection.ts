import { isProxy } from "node:util/types";
import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import {
  isRegisteredInternalV2ActivationApproval,
  type InternalV2ActivationApproval,
} from "@/application/conversation-v2/activation-approval";
import type { CycleIRuntimeBuildIdentity } from "@/application/conversation-v2/configured-cycle-i-authority";

export const CONVERSATION_ENGINES = [
  "v1",
  "v1_with_v2_shadow",
  "v2_internal",
] as const;

export type ConversationEngine = typeof CONVERSATION_ENGINES[number];
export type ConversationEnginePolicy = Readonly<{
  clinicId: string;
  engine: ConversationEngine;
  isTest: boolean;
}>;

export function canonicalizeConversationEnginePolicy(
  input: unknown,
  expectedClinicId: string,
): ConversationEnginePolicy {
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype
  ) throw new Error("invalid conversation engine policy");
  const expectedKeys = ["clinicId", "engine", "isTest"] as const;
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key as typeof expectedKeys[number]))
  ) throw new Error("invalid conversation engine policy");
  const source: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid conversation engine policy");
    }
    source[key] = descriptor.value;
  }
  if (
    typeof expectedClinicId !== "string"
    || expectedClinicId.length === 0
    || source.clinicId !== expectedClinicId
    || typeof source.engine !== "string"
    || !(CONVERSATION_ENGINES as readonly string[]).includes(source.engine)
    || typeof source.isTest !== "boolean"
  ) throw new Error("invalid conversation engine policy");
  return Object.freeze({
    clinicId: expectedClinicId,
    engine: source.engine as ConversationEngine,
    isTest: source.isTest,
  });
}

export type EffectiveConversationEngine =
  | Readonly<{
      route: "v1";
      shadow: false;
      reason:
        | "configured_v1"
        | "automation_not_live"
        | "v2_internal_runtime_unavailable"
        | "activation_gate_missing";
    }>
  | Readonly<{ route: "v1"; shadow: true; reason: "configured_shadow" }>;

export function resolveConversationEngine(input: {
  automationMode: ClinicAutomationMode;
  policy: ConversationEnginePolicy;
  approval: InternalV2ActivationApproval | null;
  runtimeIdentity: CycleIRuntimeBuildIdentity | null;
}): EffectiveConversationEngine {
  if (input.automationMode !== "live") {
    return { route: "v1", shadow: false, reason: "automation_not_live" };
  }
  if (input.policy.engine === "v1") {
    return { route: "v1", shadow: false, reason: "configured_v1" };
  }
  if (input.policy.engine === "v1_with_v2_shadow") {
    return { route: "v1", shadow: true, reason: "configured_shadow" };
  }
  if (
    !input.policy.isTest
    || !isRegisteredInternalV2ActivationApproval(input.approval, input.runtimeIdentity)
  ) {
    return { route: "v1", shadow: false, reason: "activation_gate_missing" };
  }
  return {
    route: "v1",
    shadow: false,
    reason: "v2_internal_runtime_unavailable",
  };
}
