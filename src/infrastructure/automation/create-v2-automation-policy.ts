import type { ClinicAutomationFactsReader } from "@/application/ports/clinic-automation-policy-reader";
import type { ConversationAuthorityStore } from "@/application/ports/conversation-authority-store";
import type { ConversationRuntimeControlStore } from "@/application/ports/conversation-runtime-control-store";
import {
  V2OnlyAutomationPolicy,
  type V2AutomationPolicy,
} from "@/application/automation/v2-only-automation-policy";
import { DrizzleClinicAutomationPolicyReader } from "@/infrastructure/repositories/drizzle-clinic-automation-policy-reader";
import { DrizzleConversationAuthorityStore } from "@/infrastructure/repositories/drizzle-conversation-authority-store";
import { DrizzleConversationRuntimeControlStore } from "@/infrastructure/repositories/drizzle-conversation-runtime-control-store";

type PolicyDependencies = Readonly<{
  clinicFactsReader?: ClinicAutomationFactsReader;
  authorityStore?: Pick<ConversationAuthorityStore, "getVersion">;
  runtimeControlStore?: Pick<ConversationRuntimeControlStore, "getGlobal">;
}>;

export function createV2ProactiveAutomationPolicy(
  dependencies: PolicyDependencies = {},
): V2OnlyAutomationPolicy {
  return new V2OnlyAutomationPolicy({
    clinicFactsReader: dependencies.clinicFactsReader
      ?? new DrizzleClinicAutomationPolicyReader(),
    authorityStore: dependencies.authorityStore
      ?? new DrizzleConversationAuthorityStore(),
    runtimeControlStore: dependencies.runtimeControlStore
      ?? new DrizzleConversationRuntimeControlStore(),
  });
}

export async function requireLiveV2ProactiveAutomation(
  clinicId: string,
  policy: V2AutomationPolicy = createV2ProactiveAutomationPolicy(),
) {
  const decision = await policy.decide(clinicId);
  return Object.freeze({
    allowed: decision.mode === "live",
    reason: decision.reason,
    authorityVersion: decision.authorityVersion,
    runtimeControlVersion: decision.runtimeControlVersion,
  });
}
