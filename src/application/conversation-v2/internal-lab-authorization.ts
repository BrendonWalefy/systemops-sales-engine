import type { InternalLabEligibilityFacts } from "@/application/ports/internal-lab-eligibility-reader";
import type { CycleIRuntimeBuildIdentity } from "@/application/conversation-v2/configured-cycle-i-authority";
import {
  isRegisteredInternalLabApproval,
  isRegisteredInternalLabApprovalInstance,
  serializeInternalLabApprovalClaims,
  type InternalLabApprovalClaims,
  type RegisteredInternalLabApproval,
} from "@/application/conversation-v2/internal-lab-approval";

export type InternalLabRegisteredApproval = RegisteredInternalLabApproval;

export type InternalLabRecoveryApprovalClaims = InternalLabApprovalClaims;

export type CurrentInternalLabApprovalTarget = Readonly<{
  tenantDigest: string;
  channelDigest: string;
}>;

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

  return isInternalLabApprovalAuthorized(bindings);
}

export function isInternalLabApprovalAuthorized(
  bindings: InternalLabAuthorizationBindings,
): boolean {
  if (!bindings.runtimeIdentity) return false;
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

/**
 * Exposes only the nominal tenant/channel target needed to register a synthetic
 * run. Approval provenance, expiry, and exact clinic ownership remain private
 * to the canonical Internal Lab authorization boundary.
 */
export function resolveCurrentInternalLabApprovalTarget(input: Readonly<{
  approval: unknown;
  expectedClinicId: string;
  now: Date;
}>): CurrentInternalLabApprovalTarget | null {
  if (!isRegisteredInternalLabApprovalInstance(
    input.approval,
    input.now,
    input.expectedClinicId,
  )) return null;

  return Object.freeze({
    tenantDigest: input.approval.claims.tenantDigest,
    channelDigest: input.approval.claims.channelDigest,
  });
}

/**
 * Strictly projects the non-secret claims from a serialized approval artifact.
 * Raw approval parsing remains behind this canonical authorization boundary.
 */
export function parseInternalLabRecoveryApprovalClaims(
  serializedApproval: string | undefined,
): InternalLabRecoveryApprovalClaims | null {
  if (!serializedApproval) return null;
  try {
    const artifact = JSON.parse(serializedApproval) as Record<string, unknown>;
    if (
      !artifact
      || typeof artifact !== "object"
      || Array.isArray(artifact)
      || Object.keys(artifact).length !== 2
      || !("claims" in artifact)
      || typeof artifact.signature !== "string"
      || !/^ed25519:[a-f0-9]{128}$/.test(artifact.signature)
    ) return null;
    return JSON.parse(
      serializeInternalLabApprovalClaims(artifact.claims),
    ) as InternalLabRecoveryApprovalClaims;
  } catch {
    return null;
  }
}
