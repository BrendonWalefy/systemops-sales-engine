import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import {
  isRegisteredInternalV2ActivationApproval,
  type InternalV2ActivationApproval,
} from "@/application/conversation-v2/activation-approval";

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
    || !isRegisteredInternalV2ActivationApproval(input.approval)
  ) {
    return { route: "v1", shadow: false, reason: "activation_gate_missing" };
  }
  return {
    route: "v1",
    shadow: false,
    reason: "v2_internal_runtime_unavailable",
  };
}
