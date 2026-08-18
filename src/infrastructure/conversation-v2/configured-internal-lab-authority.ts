import { createPublicKey, verify, type KeyObject } from "node:crypto";

export const INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.internal-lab-approval.v1" as const;

export type ConfiguredInternalLabAuthority = Readonly<{
  domain: typeof INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN;
  verifyCanonicalPayload(payload: Uint8Array, signature: Uint8Array): boolean;
}>;

export type ConfiguredInternalLabDeploymentIdentity = Readonly<{
  commit: string;
  runtime: Readonly<{
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
  }>;
}>;

const configuredAuthorities = new WeakSet<object>();
const configuredDeploymentIdentities = new WeakSet<object>();
type ConfiguredInternalLabBindings = Readonly<{
  serializedApproval: string | null;
  tenantDigest: string;
  channelDigest: string;
  configDigest: string;
}>;
const configuredBindings = new WeakMap<object, ConfiguredInternalLabBindings>();
const cycleIRootEnvironmentNames = Object.freeze([
  "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_REVIEW_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_REPLAY_APPROVAL_PUBLIC_KEY",
]);
let configuredPublicKey: KeyObject | null | undefined;
const digestPattern = /^(?:hmac|sha256):[a-f0-9]{64}$/;

function readEd25519PublicKey(name: string, required: boolean): KeyObject | null {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    if (!required) return null;
    throw new Error(`Internal Lab trusted authority root is not configured: ${name}`);
  }

  const encoded = value.trim();
  let key: KeyObject;
  if (
    encoded.startsWith("-----BEGIN PUBLIC KEY-----")
    && encoded.endsWith("-----END PUBLIC KEY-----")
  ) {
    key = createPublicKey(encoded);
  } else if (encoded.startsWith("spki-der-base64:")) {
    const base64 = encoded.slice("spki-der-base64:".length);
    const der = Buffer.from(base64, "base64");
    if (base64.length === 0 || der.toString("base64") !== base64) {
      throw new Error(`Internal Lab authority root must be explicit SPKI public material: ${name}`);
    }
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } else {
    throw new Error(`Internal Lab authority root must be explicit SPKI public material: ${name}`);
  }

  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
    throw new Error(`Internal Lab authority root must be an Ed25519 SPKI public key: ${name}`);
  }
  return key;
}

function samePublicKey(left: KeyObject, right: KeyObject): boolean {
  return left.export({ type: "spki", format: "der" })
    .equals(right.export({ type: "spki", format: "der" }));
}

function authorityPublicKey(): KeyObject {
  if (configuredPublicKey === null) {
    throw new Error("Internal Lab trusted authority root is unavailable");
  }
  if (configuredPublicKey) return configuredPublicKey;

  try {
    const publicKey = readEd25519PublicKey(
      "CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY",
      true,
    )!;
    for (const name of cycleIRootEnvironmentNames) {
      const cycleIRoot = readEd25519PublicKey(name, false);
      if (cycleIRoot && samePublicKey(publicKey, cycleIRoot)) {
        throw new Error(`Internal Lab authority must be distinct from Cycle I root: ${name}`);
      }
    }
    configuredPublicKey = publicKey;
    return publicKey;
  } catch (error) {
    configuredPublicKey = null;
    throw error;
  }
}

function requiredConfiguredDigest(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error(`Internal Lab configured target binding is not configured: ${name}`);
  }
  return value;
}

export function loadConfiguredInternalLabAuthority(): ConfiguredInternalLabAuthority {
  const publicKey = authorityPublicKey();
  const bindings = Object.freeze({
    serializedApproval: typeof process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON === "string"
      && process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON.length > 0
      ? process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON
      : null,
    tenantDigest: requiredConfiguredDigest("CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST"),
    channelDigest: requiredConfiguredDigest("CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST"),
    configDigest: requiredConfiguredDigest("CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST"),
  }) satisfies ConfiguredInternalLabBindings;

  const authority = Object.freeze({
    domain: INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
    verifyCanonicalPayload(payload: Uint8Array, signature: Uint8Array): boolean {
      if (!(payload instanceof Uint8Array) || !(signature instanceof Uint8Array)) return false;
      if (signature.byteLength !== 64) return false;
      try {
        return verify(
          null,
          Buffer.concat([
            Buffer.from(INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
            Buffer.from([0]),
            Buffer.from(payload),
          ]),
          publicKey,
          Buffer.from(signature),
        );
      } catch {
        return false;
      }
    },
  }) satisfies ConfiguredInternalLabAuthority;
  configuredAuthorities.add(authority);
  configuredBindings.set(authority, bindings);
  return authority;
}

export function assertConfiguredInternalLabAuthorityBindings(
  authority: ConfiguredInternalLabAuthority,
  expected: Readonly<{
    serializedApproval?: string;
    tenantDigest: string;
    channelDigest: string;
    configDigest: string;
  }>,
): void {
  const bindings = configuredBindings.get(authority);
  if (!bindings || !configuredAuthorities.has(authority)) {
    throw new Error("Internal Lab authority is not registered by the configured loader");
  }
  if (
    expected.serializedApproval !== undefined
    && (bindings.serializedApproval === null
      || expected.serializedApproval !== bindings.serializedApproval)
  ) {
    throw new Error("Internal Lab approval does not match the configured approval artifact");
  }
  for (const field of ["tenantDigest", "channelDigest", "configDigest"] as const) {
    if (expected[field] !== bindings[field]) {
      throw new Error(`Internal Lab ${field} does not match the configured target binding`);
    }
  }
}

export function isRegisteredConfiguredInternalLabAuthority(
  authority: unknown,
): authority is ConfiguredInternalLabAuthority {
  return typeof authority === "object"
    && authority !== null
    && configuredAuthorities.has(authority);
}

export function loadConfiguredInternalLabDeploymentIdentity(): ConfiguredInternalLabDeploymentIdentity {
  const vercelCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  const legacyCommit = process.env.GIT_COMMIT_SHA;
  if (vercelCommit && legacyCommit && vercelCommit !== legacyCommit) {
    throw new Error("Internal Lab deployment commit configuration conflicts");
  }
  if (typeof vercelCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(vercelCommit)) {
    throw new Error("Internal Lab exact Vercel deployment commit is not configured");
  }
  const identity = Object.freeze({
    commit: vercelCommit,
    runtime: Object.freeze({
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    }),
  }) satisfies ConfiguredInternalLabDeploymentIdentity;
  configuredDeploymentIdentities.add(identity);
  return identity;
}

export function isRegisteredInternalLabDeploymentIdentity(
  identity: unknown,
): identity is ConfiguredInternalLabDeploymentIdentity {
  return typeof identity === "object"
    && identity !== null
    && configuredDeploymentIdentities.has(identity);
}
