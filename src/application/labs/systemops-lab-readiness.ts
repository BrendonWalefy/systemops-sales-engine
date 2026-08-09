export type SystemOpsLabReadinessReport = {
  readyForControlledInbound: boolean;
  readyForAutomation: false;
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
    | "webhook_secret_missing"
    | "remote_not_connected"
  >;
};

export type SystemOpsLabReadinessInput = {
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
  webhookSecretConfigured: boolean;
  remoteConnected: boolean | null;
};

export function evaluateSystemOpsLabReadiness(
  input: SystemOpsLabReadinessInput,
): SystemOpsLabReadinessReport {
  const blockers: SystemOpsLabReadinessReport["blockers"] = [];

  if (!input.isTest) blockers.push("target_not_test");
  if (input.isDemo) blockers.push("target_is_demo");
  if (input.operationalStatus !== "test") blockers.push("status_not_test");
  if (input.autoReplyEnabled) blockers.push("automation_must_remain_disabled");
  if (input.shadowModeEnabled) blockers.push("shadow_must_remain_disabled");
  if (input.channelProvider !== "z_api") blockers.push("provider_not_zapi");
  if (!input.zapiInstanceId?.trim()) blockers.push("instance_missing");
  if (!input.hasEncryptedToken) blockers.push("credential_missing");
  if (input.resolvedClinicId !== input.clinicId) blockers.push("tenant_resolution_mismatch");
  if (!input.webhookSecretConfigured) blockers.push("webhook_secret_missing");
  if (input.remoteConnected === false) blockers.push("remote_not_connected");

  return {
    readyForControlledInbound: blockers.length === 0,
    readyForAutomation: false,
    blockers,
  };
}
