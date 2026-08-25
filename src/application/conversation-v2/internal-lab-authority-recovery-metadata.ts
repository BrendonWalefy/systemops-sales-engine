import {
  parseInternalLabRecoveryApprovalClaims,
} from "@/application/conversation-v2/internal-lab-authorization";

type RecoveryEnvironment = Readonly<Record<string, string | undefined>>;

type RecoveryDeploymentRuntime = Readonly<{
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
}>;

type RequiredRecoveryEnvironmentName =
  | "SYSTEMOPS_LAB_CLINIC_ID"
  | "CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY"
  | "CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST"
  | "CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST"
  | "CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST"
  | "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY"
  | "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY"
  | "CONVERSATION_V2_GATE_REPORT_DIGEST"
  | "CONVERSATION_V2_POPULATION_DIGEST"
  | "CONVERSATION_V2_DATASET_DIGEST"
  | "CONVERSATION_V2_CONFIG_DIGEST"
  | "VERCEL_GIT_COMMIT_SHA";

function requiredValue(env: RecoveryEnvironment, name: RequiredRecoveryEnvironmentName): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Internal Lab recovery metadata is not configured: ${name}`);
  return value;
}

export function describeInternalLabAuthorityRecoveryMetadata(
  env: RecoveryEnvironment,
  runtime: RecoveryDeploymentRuntime,
) {
  const deploymentCommit = requiredValue(env, "VERCEL_GIT_COMMIT_SHA");
  const claims = parseInternalLabRecoveryApprovalClaims(
    env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON,
  );
  const expiresAt = claims?.expiresAt ?? null;

  return Object.freeze({
    schemaVersion: 1 as const,
    deployment: Object.freeze({ commit: deploymentCommit, ...runtime }),
    target: Object.freeze({
      clinicId: requiredValue(env, "SYSTEMOPS_LAB_CLINIC_ID"),
      tenantDigest: requiredValue(env, "CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST"),
      channelDigest: requiredValue(env, "CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST"),
      configDigest: requiredValue(env, "CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST"),
    }),
    cycleI: Object.freeze({
      gateReportAuthorityPublicKey: requiredValue(
        env,
        "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY",
      ),
      activationApprovalAuthorityPublicKey: requiredValue(
        env,
        "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY",
      ),
      gateReportDigest: requiredValue(env, "CONVERSATION_V2_GATE_REPORT_DIGEST"),
      populationDigest: requiredValue(env, "CONVERSATION_V2_POPULATION_DIGEST"),
      datasetDigest: requiredValue(env, "CONVERSATION_V2_DATASET_DIGEST"),
      configDigest: requiredValue(env, "CONVERSATION_V2_CONFIG_DIGEST"),
    }),
    internalLabAuthorityPublicKey: requiredValue(
      env,
      "CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY",
    ),
    approval: Object.freeze({
      parsed: claims !== null,
      decision: claims?.decision ?? null,
      commitSha: claims?.commitSha ?? null,
      issuedAt: claims?.issuedAt ?? null,
      expiresAt,
      expired: claims === null ? null : expiresAt === null
        ? false
        : Date.parse(expiresAt) <= Date.now(),
      currentBuild: claims?.commitSha === deploymentCommit,
      claims,
    }),
  });
}
