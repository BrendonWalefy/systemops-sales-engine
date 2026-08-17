import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { z } from "zod";
import {
  isRegisteredCycleIRuntimeBuildIdentity,
  type CycleIRuntimeBuildIdentity,
} from "@/application/conversation-v2/configured-cycle-i-authority";
import {
  INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
  assertConfiguredInternalLabAuthorityBindings,
  isRegisteredConfiguredInternalLabAuthority,
  isRegisteredInternalLabDeploymentIdentity,
  type ConfiguredInternalLabAuthority,
  type ConfiguredInternalLabDeploymentIdentity,
} from "@/infrastructure/conversation-v2/configured-internal-lab-authority";
import {
  isRegisteredCycleIBuildAttestation,
  type CycleIBuildAttestation,
} from "@/infrastructure/conversation-v2/git-cycle-i-build-attestation";

export type InternalLabApprovalDecision =
  | "INTERNAL_LAB_SMOKE_AUTHORIZED"
  | "INTERNAL_LAB_READY";

export type InternalLabApprovalCriterion =
  | "h_safety_entailment_preserved"
  | "tasks_1_7_closed"
  | "architecture_review_clear"
  | "final_build_measurement_recorded"
  | "single_router_boundary"
  | "tenant_flag_fail_closed"
  | "same_turn_fallback_absent"
  | "isolation_dedupe_state_booking_outbox_sender_green"
  | "bidirectional_rollback_green"
  | "verify_green"
  | "single_internal_target"
  | "exact_build_deployed"
  | "real_internal_number_smoke_green"
  | "production_rollback_green"
  | "inbox_persistence_green"
  | "synthetic_personas_captured"
  | "automated_evidence_generated"
  | "observability_green"
  | "lab_final_engine_v2_internal";

export type InternalLabApprovalClaims = Readonly<{
  schemaVersion: 1;
  decision: InternalLabApprovalDecision;
  authorityDomain: typeof INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN;
  commitSha: string;
  treeSha: string;
  sourceDigest: string;
  runtimeDigest: string;
  tenantDigest: string;
  channelDigest: string;
  configDigest: string;
  cycleIGateDigest: string;
  cycleIDecision: "NO_GO";
  qualitativeStatus: "not_measurable" | "pending_human_review";
  criteria: readonly InternalLabApprovalCriterion[];
  evidenceDigests: readonly Readonly<{
    kind: "verification" | "architecture_review" | "production_smoke" | "rollback" | "personas" | "inbox" | "observability";
    digest: string;
  }>[];
  issuedAt: string;
  expiresAt: string | null;
}>;

export type RegisteredInternalLabApproval = Readonly<{
  claims: InternalLabApprovalClaims;
  signature: string;
}>;

const smokeCriteria = Object.freeze([
  "h_safety_entailment_preserved",
  "tasks_1_7_closed",
  "architecture_review_clear",
  "final_build_measurement_recorded",
  "single_router_boundary",
  "tenant_flag_fail_closed",
  "same_turn_fallback_absent",
  "isolation_dedupe_state_booking_outbox_sender_green",
  "bidirectional_rollback_green",
  "verify_green",
  "single_internal_target",
] satisfies readonly InternalLabApprovalCriterion[]);

const readyCriteria = Object.freeze([
  ...smokeCriteria,
  "exact_build_deployed",
  "real_internal_number_smoke_green",
  "production_rollback_green",
  "inbox_persistence_green",
  "synthetic_personas_captured",
  "automated_evidence_generated",
  "observability_green",
  "lab_final_engine_v2_internal",
] satisfies readonly InternalLabApprovalCriterion[]);

const smokeEvidenceKinds = Object.freeze(["verification", "architecture_review"] as const);
const readyEvidenceKinds = Object.freeze([
  ...smokeEvidenceKinds,
  "production_smoke",
  "rollback",
  "personas",
  "inbox",
  "observability",
] as const);

const digest = z.string().regex(/^(?:hmac|sha256):[a-f0-9]{64}$/);
const objectId = z.string().regex(/^[a-f0-9]{40,64}$/);
const isoDateTime = z.string().datetime({ offset: true });
const criterion = z.enum(readyCriteria as [InternalLabApprovalCriterion, ...InternalLabApprovalCriterion[]]);
const evidenceKind = z.enum(readyEvidenceKinds);
const evidenceSchema = z.object({ kind: evidenceKind, digest }).strict();
const claimsSchema = z.object({
  schemaVersion: z.literal(1),
  decision: z.enum(["INTERNAL_LAB_SMOKE_AUTHORIZED", "INTERNAL_LAB_READY"]),
  authorityDomain: z.literal(INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
  commitSha: objectId,
  treeSha: objectId,
  sourceDigest: digest,
  runtimeDigest: digest,
  tenantDigest: digest,
  channelDigest: digest,
  configDigest: digest,
  cycleIGateDigest: z.string().regex(/^hmac:[a-f0-9]{64}$/),
  cycleIDecision: z.literal("NO_GO"),
  qualitativeStatus: z.enum(["not_measurable", "pending_human_review"]),
  criteria: z.array(criterion),
  evidenceDigests: z.array(evidenceSchema),
  issuedAt: isoDateTime,
  expiresAt: isoDateTime.nullable(),
}).strict();
const signatureSchema = z.string().regex(/^ed25519:[a-f0-9]{128}$/);
const approvalKeys = Object.freeze(["claims", "signature"]);
const claimKeys = Object.freeze([
  "schemaVersion",
  "decision",
  "authorityDomain",
  "commitSha",
  "treeSha",
  "sourceDigest",
  "runtimeDigest",
  "tenantDigest",
  "channelDigest",
  "configDigest",
  "cycleIGateDigest",
  "cycleIDecision",
  "qualitativeStatus",
  "criteria",
  "evidenceDigests",
  "issuedAt",
  "expiresAt",
]);
const evidenceKeys = Object.freeze(["kind", "digest"]);
const approvals = new WeakSet<object>();
const approvalBuildBindings = new WeakMap<object, Readonly<{
  runtimeIdentity: CycleIRuntimeBuildIdentity;
  buildAttestation: CycleIBuildAttestation;
}>>();
const approvalDeploymentBindings = new WeakMap<object, Readonly<{
  runtimeIdentity: CycleIRuntimeBuildIdentity;
  deploymentIdentity: ConfiguredInternalLabDeploymentIdentity;
}>>();

function snapshotPlainRecord(
  input: unknown,
  expectedKeys: readonly string[],
  errorMessage: string,
): Record<string, unknown> {
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype
  ) throw new Error(errorMessage);

  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) throw new Error(errorMessage);

  const snapshot: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(errorMessage);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function parseClaims(input: unknown): InternalLabApprovalClaims {
  const snapshot = snapshotPlainRecord(input, claimKeys, "invalid Internal Lab approval claims");
  if (Array.isArray(snapshot.evidenceDigests)) {
    snapshot.evidenceDigests = snapshot.evidenceDigests.map((item) =>
      snapshotPlainRecord(item, evidenceKeys, "invalid Internal Lab approval evidence"));
  }
  return claimsSchema.parse(snapshot) as InternalLabApprovalClaims;
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertDecisionRequirements(claims: InternalLabApprovalClaims, now: Date): void {
  if (!Number.isFinite(now.getTime())) throw new Error("Internal Lab approval now is invalid");
  const issuedAt = new Date(claims.issuedAt);
  if (issuedAt.getTime() > now.getTime()) {
    throw new Error("Internal Lab approval issuedAt is in the future");
  }

  if (claims.decision === "INTERNAL_LAB_SMOKE_AUTHORIZED") {
    if (!sameOrderedValues(claims.criteria, smokeCriteria)) {
      throw new Error("Internal Lab SMOKE criteria are incomplete or out of order");
    }
    if (!sameOrderedValues(claims.evidenceDigests.map(({ kind }) => kind), smokeEvidenceKinds)) {
      throw new Error("Internal Lab SMOKE evidence is incomplete or out of order");
    }
    if (claims.expiresAt === null) throw new Error("Internal Lab SMOKE expiresAt is required");
    const expiresAt = new Date(claims.expiresAt);
    if (expiresAt.getTime() <= issuedAt.getTime()) {
      throw new Error("Internal Lab SMOKE expiresAt must be after issuedAt");
    }
    if (expiresAt.getTime() <= now.getTime()) throw new Error("Internal Lab SMOKE approval is expired");
    return;
  }

  if (!sameOrderedValues(claims.criteria, readyCriteria)) {
    throw new Error("Internal Lab READY criteria are incomplete or out of order");
  }
  if (!sameOrderedValues(claims.evidenceDigests.map(({ kind }) => kind), readyEvidenceKinds)) {
    throw new Error("Internal Lab READY evidence is incomplete or out of order");
  }
  if (claims.expiresAt !== null) throw new Error("Internal Lab READY expiresAt must be null");
}

function canonicalClaimsObject(claims: InternalLabApprovalClaims): Record<string, unknown> {
  return {
    schemaVersion: claims.schemaVersion,
    decision: claims.decision,
    authorityDomain: claims.authorityDomain,
    commitSha: claims.commitSha,
    treeSha: claims.treeSha,
    sourceDigest: claims.sourceDigest,
    runtimeDigest: claims.runtimeDigest,
    tenantDigest: claims.tenantDigest,
    channelDigest: claims.channelDigest,
    configDigest: claims.configDigest,
    cycleIGateDigest: claims.cycleIGateDigest,
    cycleIDecision: claims.cycleIDecision,
    qualitativeStatus: claims.qualitativeStatus,
    criteria: [...claims.criteria],
    evidenceDigests: claims.evidenceDigests.map(({ kind, digest: evidenceDigest }) => ({
      kind,
      digest: evidenceDigest,
    })),
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  };
}

export function serializeInternalLabApprovalClaims(input: unknown, now?: Date): string {
  const claims = parseClaims(input);
  if (now) assertDecisionRequirements(claims, now);
  return JSON.stringify(canonicalClaimsObject(claims));
}

export function computeInternalLabRuntimeDigest(runtime: Readonly<{
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
}>): string {
  return `sha256:${createHash("sha256")
    .update(`${INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN}\0runtime\0`)
    .update(JSON.stringify({
      nodeVersion: runtime.nodeVersion,
      platform: runtime.platform,
      arch: runtime.arch,
    }))
    .digest("hex")}`;
}

function freezeClaims(claims: InternalLabApprovalClaims): InternalLabApprovalClaims {
  const criteria = Object.freeze([...claims.criteria]);
  const evidenceDigests = Object.freeze(claims.evidenceDigests.map((entry) => Object.freeze({
    kind: entry.kind,
    digest: entry.digest,
  })));
  return Object.freeze({
    ...canonicalClaimsObject(claims),
    criteria,
    evidenceDigests,
  }) as InternalLabApprovalClaims;
}

export function parseAndRegisterInternalLabApproval(input: {
  serializedApproval: string;
  authority: ConfiguredInternalLabAuthority;
  runtimeIdentity: CycleIRuntimeBuildIdentity;
  buildAttestation: CycleIBuildAttestation;
  expectedTenantDigest: string;
  expectedChannelDigest: string;
  expectedConfigDigest: string;
  now: Date;
}): RegisteredInternalLabApproval {
  if (!isRegisteredConfiguredInternalLabAuthority(input.authority)) {
    throw new Error("Internal Lab approval authority is not registered by the configured loader");
  }
  if (!isRegisteredCycleIRuntimeBuildIdentity(input.runtimeIdentity)) {
    throw new Error("Internal Lab runtime build identity is not registered");
  }
  if (!isRegisteredCycleIBuildAttestation(input.buildAttestation)) {
    throw new Error("Internal Lab Git build attestation is not registered");
  }
  if (typeof input.serializedApproval !== "string") {
    throw new Error("Internal Lab approval must be serialized JSON");
  }
  assertConfiguredInternalLabAuthorityBindings(input.authority, {
    tenantDigest: input.expectedTenantDigest,
    channelDigest: input.expectedChannelDigest,
    configDigest: input.expectedConfigDigest,
  });

  let decoded: unknown;
  try {
    decoded = JSON.parse(input.serializedApproval);
  } catch {
    throw new Error("Internal Lab approval JSON is invalid");
  }
  const record = snapshotPlainRecord(decoded, approvalKeys, "invalid Internal Lab approval artifact");
  const claims = parseClaims(record.claims);
  const signature = signatureSchema.parse(record.signature);
  const canonicalPayload = Buffer.from(JSON.stringify(canonicalClaimsObject(claims)));
  if (!input.authority.verifyCanonicalPayload(
    canonicalPayload,
    Buffer.from(signature.slice("ed25519:".length), "hex"),
  )) throw new Error("Internal Lab approval signature is invalid");

  assertDecisionRequirements(claims, input.now);
  assertConfiguredInternalLabAuthorityBindings(input.authority, {
    serializedApproval: input.serializedApproval,
    tenantDigest: input.expectedTenantDigest,
    channelDigest: input.expectedChannelDigest,
    configDigest: input.expectedConfigDigest,
  });
  if (input.runtimeIdentity.commit !== input.buildAttestation.commit) {
    throw new Error("Internal Lab runtime commit does not match the registered Git build");
  }
  const exactBindings = {
    commitSha: input.buildAttestation.commit,
    treeSha: input.buildAttestation.tree,
    sourceDigest: input.buildAttestation.sourceDigest,
    runtimeDigest: computeInternalLabRuntimeDigest(input.buildAttestation.runtime),
    cycleIGateDigest: input.runtimeIdentity.reportDigest,
    tenantDigest: input.expectedTenantDigest,
    channelDigest: input.expectedChannelDigest,
    configDigest: input.expectedConfigDigest,
  } as const;
  for (const [field, expected] of Object.entries(exactBindings)) {
    if (claims[field as keyof typeof exactBindings] !== expected) {
      throw new Error(`Internal Lab approval ${field} mismatch`);
    }
  }

  const approval = Object.freeze({
    claims: freezeClaims(claims),
    signature,
  }) as RegisteredInternalLabApproval;
  approvals.add(approval);
  approvalBuildBindings.set(approval, Object.freeze({
    runtimeIdentity: input.runtimeIdentity,
    buildAttestation: input.buildAttestation,
  }));
  return approval;
}

export function parseAndRegisterDeployedInternalLabApproval(input: {
  serializedApproval: string;
  authority: ConfiguredInternalLabAuthority;
  runtimeIdentity: CycleIRuntimeBuildIdentity;
  deploymentIdentity: ConfiguredInternalLabDeploymentIdentity;
  expectedTenantDigest: string;
  expectedChannelDigest: string;
  expectedConfigDigest: string;
  now: Date;
}): RegisteredInternalLabApproval {
  if (!isRegisteredConfiguredInternalLabAuthority(input.authority)) {
    throw new Error("Internal Lab approval authority is not registered by the configured loader");
  }
  if (!isRegisteredCycleIRuntimeBuildIdentity(input.runtimeIdentity)) {
    throw new Error("Internal Lab runtime build identity is not registered");
  }
  if (!isRegisteredInternalLabDeploymentIdentity(input.deploymentIdentity)) {
    throw new Error("Internal Lab deployment identity is not registered");
  }
  if (typeof input.serializedApproval !== "string") {
    throw new Error("Internal Lab approval must be serialized JSON");
  }
  assertConfiguredInternalLabAuthorityBindings(input.authority, {
    tenantDigest: input.expectedTenantDigest,
    channelDigest: input.expectedChannelDigest,
    configDigest: input.expectedConfigDigest,
  });
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.serializedApproval);
  } catch {
    throw new Error("Internal Lab approval JSON is invalid");
  }
  const record = snapshotPlainRecord(decoded, approvalKeys, "invalid Internal Lab approval artifact");
  const claims = parseClaims(record.claims);
  const signature = signatureSchema.parse(record.signature);
  const canonicalPayload = Buffer.from(JSON.stringify(canonicalClaimsObject(claims)));
  if (!input.authority.verifyCanonicalPayload(
    canonicalPayload,
    Buffer.from(signature.slice("ed25519:".length), "hex"),
  )) throw new Error("Internal Lab approval signature is invalid");

  assertDecisionRequirements(claims, input.now);
  assertConfiguredInternalLabAuthorityBindings(input.authority, {
    serializedApproval: input.serializedApproval,
    tenantDigest: input.expectedTenantDigest,
    channelDigest: input.expectedChannelDigest,
    configDigest: input.expectedConfigDigest,
  });
  if (
    input.runtimeIdentity.commit !== input.deploymentIdentity.commit
    || claims.commitSha !== input.deploymentIdentity.commit
  ) throw new Error("Internal Lab deployed commit mismatch");
  const exactBindings = {
    runtimeDigest: computeInternalLabRuntimeDigest(input.deploymentIdentity.runtime),
    cycleIGateDigest: input.runtimeIdentity.reportDigest,
    tenantDigest: input.expectedTenantDigest,
    channelDigest: input.expectedChannelDigest,
    configDigest: input.expectedConfigDigest,
  } as const;
  for (const [field, expected] of Object.entries(exactBindings)) {
    if (claims[field as keyof typeof exactBindings] !== expected) {
      throw new Error(`Internal Lab deployed approval ${field} mismatch`);
    }
  }
  const approval = Object.freeze({ claims: freezeClaims(claims), signature }) as RegisteredInternalLabApproval;
  approvals.add(approval);
  approvalDeploymentBindings.set(approval, Object.freeze({
    runtimeIdentity: input.runtimeIdentity,
    deploymentIdentity: input.deploymentIdentity,
  }));
  return approval;
}

export function isRegisteredInternalLabApproval(
  approval: unknown,
  expected: {
    decision: InternalLabApprovalDecision;
    runtimeIdentity: CycleIRuntimeBuildIdentity;
    tenantDigest: string;
    channelDigest: string;
    configDigest: string;
    now: Date;
  },
): approval is RegisteredInternalLabApproval {
  if (
    typeof approval !== "object"
    || approval === null
    || !approvals.has(approval)
    || !isRegisteredCycleIRuntimeBuildIdentity(expected.runtimeIdentity)
  ) return false;

  const buildBinding = approvalBuildBindings.get(approval);
  const deploymentBinding = approvalDeploymentBindings.get(approval);
  const validLocalBuild = !!buildBinding
    && buildBinding.runtimeIdentity === expected.runtimeIdentity
    && isRegisteredCycleIBuildAttestation(buildBinding.buildAttestation);
  const validDeployment = !!deploymentBinding
    && deploymentBinding.runtimeIdentity === expected.runtimeIdentity
    && isRegisteredInternalLabDeploymentIdentity(deploymentBinding.deploymentIdentity);
  if (!validLocalBuild && !validDeployment) return false;

  const registered = approval as RegisteredInternalLabApproval;
  if (
    registered.claims.decision !== expected.decision
    || registered.claims.tenantDigest !== expected.tenantDigest
    || registered.claims.channelDigest !== expected.channelDigest
    || registered.claims.configDigest !== expected.configDigest
    || !Number.isFinite(expected.now.getTime())
  ) return false;
  return registered.claims.expiresAt === null
    || new Date(registered.claims.expiresAt).getTime() > expected.now.getTime();
}
