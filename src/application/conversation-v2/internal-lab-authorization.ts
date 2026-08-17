import type { InternalLabEligibilityFacts } from "@/application/ports/internal-lab-eligibility-reader";
import type { CycleIRuntimeBuildIdentity } from "@/application/conversation-v2/configured-cycle-i-authority";
import {
  isRegisteredInternalLabApproval,
  type RegisteredInternalLabApproval,
} from "@/application/conversation-v2/internal-lab-approval";

export type InternalLabAuthorizationBindings = Readonly<{
  approval: RegisteredInternalLabApproval | null;
  runtimeIdentity: CycleIRuntimeBuildIdentity | null;
  expectedClinicId: string;
  expectedTenantDigest: string;
  expectedChannelDigest: string;
  expectedConfigDigest: string;
  now(): Date;
}>;

export function isInternalLabAuthorized(
  facts: InternalLabEligibilityFacts | null,
  bindings: InternalLabAuthorizationBindings,
): boolean {
  if (!facts
    || facts.clinicId !== bindings.expectedClinicId
    || !facts.isTest
    || facts.isDemo
    || facts.operationalStatus !== "test"
    || !facts.autoReplyEnabled
    || facts.shadowModeEnabled
    || !bindings.runtimeIdentity) return false;

  const expected = {
    runtimeIdentity: bindings.runtimeIdentity,
    tenantDigest: bindings.expectedTenantDigest,
    channelDigest: bindings.expectedChannelDigest,
    configDigest: bindings.expectedConfigDigest,
    now: bindings.now(),
  } as const;
  return isRegisteredInternalLabApproval(bindings.approval, {
    ...expected,
    decision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
  }) || isRegisteredInternalLabApproval(bindings.approval, {
    ...expected,
    decision: "INTERNAL_LAB_READY",
  });
}
