import { createPublicKey, verify, type KeyObject } from "node:crypto";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";
import { replayApprovalKeyId, verifyReplayDatasetApproval } from "@/application/replay/replay-dataset-approval";
import type { ReplayDatasetV2 } from "@/application/replay/contracts";

export const CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.cycle-i.gate-report.v1" as const;
export const CYCLE_I_ACTIVATION_APPROVAL_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.cycle-i.activation-approval.v1" as const;
export const CYCLE_I_RUN_MANIFEST_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.cycle-i.run-manifest.v2" as const;
export const CYCLE_I_MEASUREMENT_RUN_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.cycle-i.measurement-run.v1" as const;
export const CYCLE_I_REVIEW_CALIBRATION_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.cycle-i.review-calibration.v1" as const;
export const CYCLE_I_REVIEW_RATING_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.cycle-i.review-rating.v1" as const;

export type Ed25519SignatureRef = `ed25519:${string}`;

declare const cycleIRuntimeBuildIdentityBrand: unique symbol;
export type CycleIRuntimeBuildIdentity = Readonly<{
  commit: string;
  reportDigest: HmacRef;
  populationDigest: HmacRef;
  datasetDigest: HmacRef;
  configDigest: HmacRef;
  readonly [cycleIRuntimeBuildIdentityBrand]: true;
}>;

type ConfiguredAuthorityRoot = Readonly<{
  gateReportPublicKey: KeyObject;
  activationApprovalPublicKey: KeyObject;
}>;

let configuredRoot: ConfiguredAuthorityRoot | null | undefined;
let configuredReviewRoot: KeyObject | null | undefined;
const runtimeBuildIdentities = new WeakSet<object>();
const commitPattern = /^[a-f0-9]{7,64}$/;
const hmacPattern = /^hmac:[a-f0-9]{64}$/;

function readEd25519PublicKey(name: string): KeyObject {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Cycle I trusted authority root is not configured: ${name}`);
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
      throw new Error(`Cycle I trusted authority root must be explicit SPKI public material: ${name}`);
    }
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } else {
    throw new Error(`Cycle I trusted authority root must be explicit SPKI public material: ${name}`);
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
    throw new Error(`Cycle I trusted authority root must be an Ed25519 SPKI public key: ${name}`);
  }
  return key;
}

function authorityRoot(): ConfiguredAuthorityRoot {
  if (configuredRoot === null) {
    throw new Error("Cycle I trusted authority root is unavailable");
  }
  if (configuredRoot) return configuredRoot;
  try {
    const gateReportPublicKey = readEd25519PublicKey(
      "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY",
    );
    const activationApprovalPublicKey = readEd25519PublicKey(
      "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY",
    );
    const gateDer = gateReportPublicKey.export({ type: "spki", format: "der" });
    const approvalDer = activationApprovalPublicKey.export({ type: "spki", format: "der" });
    if (gateDer.equals(approvalDer)) {
      throw new Error("Cycle I authorities must use distinct Ed25519 public keys");
    }
    configuredRoot = Object.freeze({ gateReportPublicKey, activationApprovalPublicKey });
    return configuredRoot;
  } catch (error) {
    configuredRoot = null;
    throw error;
  }
}

function reviewAuthorityRoot(): KeyObject {
  if (configuredReviewRoot === null) throw new Error("Cycle I review authority root is unavailable");
  if (configuredReviewRoot) return configuredReviewRoot;
  try {
    const key = readEd25519PublicKey("CONVERSATION_V2_REVIEW_AUTHORITY_PUBLIC_KEY");
    const root = authorityRoot();
    const der = key.export({ type: "spki", format: "der" });
    if (
      der.equals(root.gateReportPublicKey.export({ type: "spki", format: "der" }))
      || der.equals(root.activationApprovalPublicKey.export({ type: "spki", format: "der" }))
    ) throw new Error("Cycle I review authority must be distinct from gate and activation authorities");
    configuredReviewRoot = key;
    return key;
  } catch (error) {
    configuredReviewRoot = null;
    throw error;
  }
}

function requiredConfiguredValue(name: string, pattern: RegExp): string {
  const value = process.env[name];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Cycle I runtime build identity is not configured: ${name}`);
  }
  return value;
}

export function createConfiguredCycleIRuntimeBuildIdentity(): CycleIRuntimeBuildIdentity {
  authorityRoot();
  const vercelCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  const gitCommit = process.env.GIT_COMMIT_SHA;
  if (vercelCommit && gitCommit && vercelCommit !== gitCommit) {
    throw new Error("Cycle I runtime build identity has conflicting commit configuration");
  }
  const identity = Object.freeze({
    commit: requiredConfiguredValue(
      vercelCommit ? "VERCEL_GIT_COMMIT_SHA" : "GIT_COMMIT_SHA",
      commitPattern,
    ),
    reportDigest: requiredConfiguredValue(
      "CONVERSATION_V2_GATE_REPORT_DIGEST",
      hmacPattern,
    ) as HmacRef,
    populationDigest: requiredConfiguredValue(
      "CONVERSATION_V2_POPULATION_DIGEST",
      hmacPattern,
    ) as HmacRef,
    datasetDigest: requiredConfiguredValue(
      "CONVERSATION_V2_DATASET_DIGEST",
      hmacPattern,
    ) as HmacRef,
    configDigest: requiredConfiguredValue(
      "CONVERSATION_V2_CONFIG_DIGEST",
      hmacPattern,
    ) as HmacRef,
  }) as CycleIRuntimeBuildIdentity;
  runtimeBuildIdentities.add(identity);
  return identity;
}

export function isRegisteredCycleIRuntimeBuildIdentity(
  identity: CycleIRuntimeBuildIdentity | null,
): identity is CycleIRuntimeBuildIdentity {
  return typeof identity === "object"
    && identity !== null
    && runtimeBuildIdentities.has(identity);
}

function verifyConfiguredAuthority(
  domain: string,
  payload: string,
  signature: Ed25519SignatureRef,
  publicKey: KeyObject,
): boolean {
  if (!/^ed25519:[a-f0-9]{128}$/.test(signature)) return false;
  return verify(
    null,
    Buffer.from(`${domain}\0${payload}`),
    publicKey,
    Buffer.from(signature.slice("ed25519:".length), "hex"),
  );
}

export function verifyConfiguredCycleIGateReportAuthority(
  payload: string,
  signature: Ed25519SignatureRef,
): boolean {
  return verifyConfiguredAuthority(
    CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN,
    payload,
    signature,
    authorityRoot().gateReportPublicKey,
  );
}

export function verifyConfiguredCycleIApprovalAuthority(
  payload: string,
  signature: Ed25519SignatureRef,
): boolean {
  return verifyConfiguredAuthority(
    CYCLE_I_ACTIVATION_APPROVAL_AUTHORITY_DOMAIN,
    payload,
    signature,
    authorityRoot().activationApprovalPublicKey,
  );
}

export function verifyConfiguredCycleIRunManifestAuthority(
  payload: string,
  signature: Ed25519SignatureRef,
): boolean {
  return verifyConfiguredAuthority(
    CYCLE_I_RUN_MANIFEST_AUTHORITY_DOMAIN,
    payload,
    signature,
    authorityRoot().gateReportPublicKey,
  );
}

export function verifyConfiguredCycleIMeasurementRunAuthority(
  payload: string,
  signature: Ed25519SignatureRef,
): boolean {
  return verifyConfiguredAuthority(
    CYCLE_I_MEASUREMENT_RUN_AUTHORITY_DOMAIN,
    payload,
    signature,
    authorityRoot().gateReportPublicKey,
  );
}

export function verifyConfiguredCycleIReviewCalibrationAuthority(
  payload: string,
  signature: Ed25519SignatureRef,
): boolean {
  return verifyConfiguredAuthority(
    CYCLE_I_REVIEW_CALIBRATION_AUTHORITY_DOMAIN,
    payload,
    signature,
    reviewAuthorityRoot(),
  );
}

export function verifyConfiguredCycleIReviewRatingAuthority(
  payload: string,
  signature: Ed25519SignatureRef,
): boolean {
  return verifyConfiguredAuthority(
    CYCLE_I_REVIEW_RATING_AUTHORITY_DOMAIN,
    payload,
    signature,
    reviewAuthorityRoot(),
  );
}

export function verifyConfiguredCycleIReplayDatasetAuthority(
  dataset: ReplayDatasetV2,
  expectedKeyId: string,
): void {
  const key = readEd25519PublicKey("CONVERSATION_V2_REPLAY_APPROVAL_PUBLIC_KEY");
  if (replayApprovalKeyId(key) !== expectedKeyId) {
    throw new Error("configured replay approval root does not match the signed run manifest");
  }
  verifyReplayDatasetApproval(
    dataset,
    key.export({ type: "spki", format: "pem" }),
  );
}
