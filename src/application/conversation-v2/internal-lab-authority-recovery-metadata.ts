import { createPublicKey } from "node:crypto";
import {
  computeInternalLabRecoveryRuntimeDigest,
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

function requiredDigest(
  env: RecoveryEnvironment,
  name: RequiredRecoveryEnvironmentName,
  pattern: RegExp,
): string {
  const value = requiredValue(env, name);
  if (!pattern.test(value)) throw new Error(`Internal Lab recovery digest is invalid: ${name}`);
  return value;
}

function requiredPublicKey(
  env: RecoveryEnvironment,
  name: RequiredRecoveryEnvironmentName,
): string {
  const encoded = requiredValue(env, name);
  try {
    let key: ReturnType<typeof createPublicKey>;
    let canonical: string;
    if (
      encoded.startsWith("-----BEGIN PUBLIC KEY-----")
      && encoded.endsWith("-----END PUBLIC KEY-----")
    ) {
      key = createPublicKey(encoded);
      canonical = key.export({ type: "spki", format: "pem" }).toString().trim();
    } else if (encoded.startsWith("spki-der-base64:")) {
      const base64 = encoded.slice("spki-der-base64:".length);
      const der = Buffer.from(base64, "base64");
      if (base64.length === 0 || der.toString("base64") !== base64) {
        throw new Error("invalid SPKI encoding");
      }
      key = createPublicKey({ key: der, format: "der", type: "spki" });
      canonical = `spki-der-base64:${key.export({
        type: "spki",
        format: "der",
      }).toString("base64")}`;
    } else {
      throw new Error("not explicit public material");
    }
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      throw new Error("not an Ed25519 public key");
    }
    if (encoded !== canonical) throw new Error("public key is not canonical");
    return canonical;
  } catch {
    throw new Error(`Internal Lab recovery public key is invalid: ${name}`);
  }
}

function requiredClinicId(env: RecoveryEnvironment): string {
  const value = requiredValue(env, "SYSTEMOPS_LAB_CLINIC_ID");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) {
    throw new Error("Internal Lab recovery clinic ID is invalid");
  }
  return value;
}

export function describeInternalLabAuthorityRecoveryMetadata(
  env: RecoveryEnvironment,
  runtime: RecoveryDeploymentRuntime,
) {
  const deploymentCommit = requiredValue(env, "VERCEL_GIT_COMMIT_SHA");
  if (!/^[a-f0-9]{40,64}$/.test(deploymentCommit)) {
    throw new Error("Internal Lab recovery deployment commit is invalid");
  }
  const tenantDigest = requiredDigest(
    env,
    "CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST",
    /^(?:hmac|sha256):[a-f0-9]{64}$/,
  );
  const channelDigest = requiredDigest(
    env,
    "CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST",
    /^(?:hmac|sha256):[a-f0-9]{64}$/,
  );
  const configDigest = requiredDigest(
    env,
    "CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST",
    /^(?:hmac|sha256):[a-f0-9]{64}$/,
  );
  const now = new Date();
  const claims = parseInternalLabRecoveryApprovalClaims({
    serializedApproval: env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON,
    expectedTenantDigest: tenantDigest,
    expectedChannelDigest: channelDigest,
    expectedConfigDigest: configDigest,
    now,
  });
  const expiresAt = claims?.expiresAt ?? null;
  const runtimeDigest = computeInternalLabRecoveryRuntimeDigest(runtime);

  return Object.freeze({
    schemaVersion: 1 as const,
    deployment: Object.freeze({ commit: deploymentCommit, ...runtime }),
    target: Object.freeze({
      clinicId: requiredClinicId(env),
      tenantDigest,
      channelDigest,
      configDigest,
    }),
    cycleI: Object.freeze({
      gateReportAuthorityPublicKey: requiredPublicKey(
        env,
        "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY",
      ),
      activationApprovalAuthorityPublicKey: requiredPublicKey(
        env,
        "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY",
      ),
      gateReportDigest: requiredDigest(
        env,
        "CONVERSATION_V2_GATE_REPORT_DIGEST",
        /^hmac:[a-f0-9]{64}$/,
      ),
      populationDigest: requiredDigest(
        env,
        "CONVERSATION_V2_POPULATION_DIGEST",
        /^hmac:[a-f0-9]{64}$/,
      ),
      datasetDigest: requiredDigest(
        env,
        "CONVERSATION_V2_DATASET_DIGEST",
        /^hmac:[a-f0-9]{64}$/,
      ),
      configDigest: requiredDigest(
        env,
        "CONVERSATION_V2_CONFIG_DIGEST",
        /^hmac:[a-f0-9]{64}$/,
      ),
    }),
    internalLabAuthorityPublicKey: requiredPublicKey(
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
        : Date.parse(expiresAt) <= now.getTime(),
      currentBuild: claims?.commitSha === deploymentCommit
        && claims.runtimeDigest === runtimeDigest,
      claims,
    }),
  });
}
