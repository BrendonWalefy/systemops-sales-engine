import type { ConversationRuntimeControl } from "@/application/ports/conversation-runtime-control-store";

export type SystemOpsLabReadinessBlocker =
  | "target_not_test"
  | "target_is_demo"
  | "status_not_active"
  | "automation_must_be_enabled"
  | "shadow_must_remain_disabled"
  | "authority_below_v2"
  | "runtime_control_closed"
  | "config_digest_missing"
  | "provider_not_zapi"
  | "instance_missing"
  | "credential_missing"
  | "tenant_resolution_mismatch"
  | "owner_membership_mismatch"
  | "webhook_secret_missing"
  | "remote_not_connected";

export type SystemOpsLabReadinessReport = Readonly<{
  readyForControlledInbound: boolean;
  readyForAutomation: boolean;
  blockers: SystemOpsLabReadinessBlocker[];
}>;

export type SystemOpsLabReadinessInput = Readonly<{
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
  authorityVersion: number | null;
  runtimeControl: ConversationRuntimeControl | null;
  configurationDigest: string | null;
}>;

export function evaluateSystemOpsLabReadiness(
  input: SystemOpsLabReadinessInput,
): SystemOpsLabReadinessReport {
  const blockers: SystemOpsLabReadinessBlocker[] = [];

  if (!input.isTest) blockers.push("target_not_test");
  if (input.isDemo) blockers.push("target_is_demo");
  if (input.operationalStatus !== "active") blockers.push("status_not_active");
  if (!input.autoReplyEnabled) blockers.push("automation_must_be_enabled");
  if (input.shadowModeEnabled) blockers.push("shadow_must_remain_disabled");
  if (input.authorityVersion === null || input.authorityVersion < 2) {
    blockers.push("authority_below_v2");
  }
  if (input.runtimeControl?.liveOutboundEnabled !== true) {
    blockers.push("runtime_control_closed");
  }
  if (!input.configurationDigest?.trim()) blockers.push("config_digest_missing");
  if (input.channelProvider !== "z_api") blockers.push("provider_not_zapi");
  if (!input.zapiInstanceId?.trim()) blockers.push("instance_missing");
  if (!input.hasEncryptedToken) blockers.push("credential_missing");
  if (input.resolvedClinicId !== input.clinicId) blockers.push("tenant_resolution_mismatch");
  if (input.ownerMembershipMatches !== true) blockers.push("owner_membership_mismatch");
  if (!input.webhookSecretConfigured) blockers.push("webhook_secret_missing");
  if (input.remoteConnected !== true) blockers.push("remote_not_connected");

  return Object.freeze({
    readyForControlledInbound: blockers.length === 0,
    readyForAutomation: blockers.length === 0,
    blockers,
  });
}
