export type SystemOpsLabReadinessReport = {
  readyForControlledInbound: boolean;
  readyForAutomation: boolean;
  blockers: Array<
    | "target_not_test"
    | "target_is_demo"
    | "status_not_test"
    | "automation_must_remain_disabled"
    | "shadow_must_remain_disabled"
    | "provider_not_zapi"
    | "instance_missing"
    | "credential_missing"
    | "tenant_resolution_mismatch"
    | "owner_membership_mismatch"
    | "webhook_secret_missing"
    | "remote_not_connected"
    | "engine_must_be_v1"
    | "engine_must_be_v2_internal"
    | "automation_must_be_enabled"
    | "config_digest_mismatch"
    | "approval_missing_or_invalid"
    | "approval_decision_mismatch"
  >;
};

export type SystemOpsLabReadinessPhase = "preactivation" | "smoke" | "ready";

export type SystemOpsLabReadinessInput = {
  phase?: SystemOpsLabReadinessPhase;
  clinicId: string;
  isTest: boolean;
  isDemo: boolean;
  operationalStatus: string;
  autoReplyEnabled: boolean;
  shadowModeEnabled: boolean;
  channelProvider: string | null;
  zapiInstanceId: string | null;
  hasEncryptedToken: boolean;
  resolvedClinicId: string | null;
  ownerMembershipMatches: boolean;
  webhookSecretConfigured: boolean;
  remoteConnected: boolean | null;
  conversationEngine?: string;
  configDigest?: string | null;
  expectedConfigDigest?: string | null;
  approvalDecision?: "INTERNAL_LAB_SMOKE_AUTHORIZED" | "INTERNAL_LAB_READY" | null;
  approvalRegistered?: boolean;
};

export function evaluateSystemOpsLabReadiness(
  input: SystemOpsLabReadinessInput,
): SystemOpsLabReadinessReport {
  const blockers: SystemOpsLabReadinessReport["blockers"] = [];
  const phase = input.phase ?? "preactivation";

  if (!input.isTest) blockers.push("target_not_test");
  if (input.isDemo) blockers.push("target_is_demo");
  if (input.operationalStatus !== "test") blockers.push("status_not_test");
  if (phase === "preactivation") {
    if (input.autoReplyEnabled) blockers.push("automation_must_remain_disabled");
    if ((input.conversationEngine ?? "v1") !== "v1") blockers.push("engine_must_be_v1");
  } else {
    if (!input.autoReplyEnabled) blockers.push("automation_must_be_enabled");
    if (input.conversationEngine !== "v2_internal") blockers.push("engine_must_be_v2_internal");
    if (
      !input.configDigest
      || !input.expectedConfigDigest
      || input.configDigest !== input.expectedConfigDigest
    ) blockers.push("config_digest_mismatch");
    if (!input.approvalRegistered || !input.approvalDecision) {
      blockers.push("approval_missing_or_invalid");
    } else {
      const expectedDecision = phase === "ready"
        ? "INTERNAL_LAB_READY"
        : "INTERNAL_LAB_SMOKE_AUTHORIZED";
      if (input.approvalDecision !== expectedDecision) {
        blockers.push("approval_decision_mismatch");
      }
    }
  }
  if (input.shadowModeEnabled) blockers.push("shadow_must_remain_disabled");
  if (input.channelProvider !== "z_api") blockers.push("provider_not_zapi");
  if (!input.zapiInstanceId?.trim()) blockers.push("instance_missing");
  if (!input.hasEncryptedToken) blockers.push("credential_missing");
  if (input.resolvedClinicId !== input.clinicId) blockers.push("tenant_resolution_mismatch");
  if (input.ownerMembershipMatches !== true) blockers.push("owner_membership_mismatch");
  if (!input.webhookSecretConfigured) blockers.push("webhook_secret_missing");
  if (input.remoteConnected === false) blockers.push("remote_not_connected");

  return {
    readyForControlledInbound: blockers.length === 0,
    readyForAutomation: phase !== "preactivation" && blockers.length === 0,
    blockers,
  };
}
