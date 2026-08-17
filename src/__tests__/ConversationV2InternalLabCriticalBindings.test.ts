import { generateKeyPairSync, sign } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  parseAndRegisterInternalLabApproval,
  computeInternalLabRuntimeDigest,
  type InternalLabApprovalClaims,
} from "@/application/conversation-v2/internal-lab-approval";
import { createConfiguredCycleIRuntimeBuildIdentity } from "@/application/conversation-v2/configured-cycle-i-authority";
import {
  INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
  loadConfiguredInternalLabAuthority,
} from "@/infrastructure/conversation-v2/configured-internal-lab-authority";
import {
  createGitCycleIBuildAttestation,
  type CycleIBuildAttestation,
} from "@/infrastructure/conversation-v2/git-cycle-i-build-attestation";

const envNames = [
  "CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON",
  "CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST",
  "CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST",
  "CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST",
  "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY",
  "VERCEL_GIT_COMMIT_SHA",
  "CONVERSATION_V2_GATE_REPORT_DIGEST",
  "CONVERSATION_V2_POPULATION_DIGEST",
  "CONVERSATION_V2_DATASET_DIGEST",
  "CONVERSATION_V2_CONFIG_DIGEST",
] as const;
const originals = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const internal = generateKeyPairSync("ed25519");
const gate = generateKeyPairSync("ed25519");
const activation = generateKeyPairSync("ed25519");
const hmac = (tail: string) => `hmac:${"a".repeat(63)}${tail}`;
const pem = (key: typeof internal.publicKey) =>
  key.export({ type: "spki", format: "pem" }).toString();
const smokeCriteria = [
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
] as const;

process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = pem(internal.publicKey);
process.env.CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY = pem(gate.publicKey);
process.env.CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY = pem(activation.publicKey);
process.env.CONVERSATION_V2_GATE_REPORT_DIGEST = hmac("1");
process.env.CONVERSATION_V2_POPULATION_DIGEST = hmac("2");
process.env.CONVERSATION_V2_DATASET_DIGEST = hmac("3");
process.env.CONVERSATION_V2_CONFIG_DIGEST = hmac("4");

afterAll(() => {
  for (const name of envNames) {
    const original = originals[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

function claims(commitSha: string, overrides: Partial<InternalLabApprovalClaims> = {}): InternalLabApprovalClaims {
  return {
    schemaVersion: 1,
    decision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
    authorityDomain: INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
    commitSha,
    treeSha: "b".repeat(40),
    sourceDigest: hmac("d"),
    runtimeDigest: hmac("e"),
    tenantDigest: hmac("f"),
    channelDigest: hmac("0"),
    configDigest: hmac("a"),
    cycleIGateDigest: hmac("1"),
    cycleIDecision: "NO_GO",
    qualitativeStatus: "not_measurable",
    criteria: smokeCriteria,
    evidenceDigests: [
      { kind: "verification", digest: hmac("5") },
      { kind: "architecture_review", digest: hmac("6") },
    ],
    issuedAt: "2026-08-17T15:00:00.000Z",
    expiresAt: "2026-08-17T15:10:00.000Z",
    ...overrides,
  };
}

function canonical(value: InternalLabApprovalClaims): string {
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    decision: value.decision,
    authorityDomain: value.authorityDomain,
    commitSha: value.commitSha,
    treeSha: value.treeSha,
    sourceDigest: value.sourceDigest,
    runtimeDigest: value.runtimeDigest,
    tenantDigest: value.tenantDigest,
    channelDigest: value.channelDigest,
    configDigest: value.configDigest,
    cycleIGateDigest: value.cycleIGateDigest,
    cycleIDecision: value.cycleIDecision,
    qualitativeStatus: value.qualitativeStatus,
    criteria: value.criteria,
    evidenceDigests: value.evidenceDigests,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  });
}

function artifact(value: InternalLabApprovalClaims): string {
  const payload = Buffer.from(canonical(value));
  const signature = sign(null, Buffer.concat([
    Buffer.from(INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
    Buffer.from([0]),
    payload,
  ]), internal.privateKey);
  return JSON.stringify({ claims: value, signature: `ed25519:${signature.toString("hex")}` });
}

function runtime(commit: string) {
  process.env.VERCEL_GIT_COMMIT_SHA = commit;
  return createConfiguredCycleIRuntimeBuildIdentity();
}

const parseWithBuild = parseAndRegisterInternalLabApproval as unknown as (input: {
  serializedApproval: string;
  authority: ReturnType<typeof loadConfiguredInternalLabAuthority>;
  runtimeIdentity: ReturnType<typeof createConfiguredCycleIRuntimeBuildIdentity>;
  buildAttestation: CycleIBuildAttestation;
  expectedTenantDigest: string;
  expectedChannelDigest: string;
  expectedConfigDigest: string;
  now: Date;
}) => unknown;

describe("Task 1 critical authority bindings", () => {
  it("rejects caller target strings when the configured Lab artifact and bindings differ", () => {
    const build = createGitCycleIBuildAttestation();
    const value = claims(build.commit, {
      treeSha: build.tree,
      sourceDigest: build.sourceDigest,
      runtimeDigest: computeInternalLabRuntimeDigest(build.runtime),
    });
    const serializedApproval = artifact(value);
    process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = "configured-different-artifact";
    process.env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST = hmac("9");
    process.env.CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST = hmac("8");
    process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST = hmac("7");

    expect(() => parseWithBuild({
      serializedApproval,
      authority: loadConfiguredInternalLabAuthority(),
      runtimeIdentity: runtime(build.commit),
      buildAttestation: build,
      expectedTenantDigest: value.tenantDigest,
      expectedChannelDigest: value.channelDigest,
      expectedConfigDigest: value.configDigest,
      now: new Date("2026-08-17T15:05:00.000Z"),
    })).toThrow(/configured|artifact|target|tenant/i);
  });

  it("rejects a correctly signed approval for different tree/source/runtime bytes at the same commit", () => {
    const build = createGitCycleIBuildAttestation();
    const value = claims(build.commit);
    const serializedApproval = artifact(value);
    process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = serializedApproval;
    process.env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST = value.tenantDigest;
    process.env.CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST = value.channelDigest;
    process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST = value.configDigest;

    expect(() => parseWithBuild({
      serializedApproval,
      authority: loadConfiguredInternalLabAuthority(),
      runtimeIdentity: runtime(build.commit),
      buildAttestation: build,
      expectedTenantDigest: value.tenantDigest,
      expectedChannelDigest: value.channelDigest,
      expectedConfigDigest: value.configDigest,
      now: new Date("2026-08-17T15:05:00.000Z"),
    })).toThrow(/tree|source|runtime|build/i);
  });
});
