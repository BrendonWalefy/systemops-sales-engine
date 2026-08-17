import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isRegisteredInternalLabApproval,
  computeInternalLabRuntimeDigest,
  parseAndRegisterInternalLabApproval,
  serializeInternalLabApprovalClaims,
  type InternalLabApprovalClaims,
} from "@/application/conversation-v2/internal-lab-approval";
import { createConfiguredCycleIRuntimeBuildIdentity } from "@/application/conversation-v2/configured-cycle-i-authority";
import {
  INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
  loadConfiguredInternalLabAuthority,
} from "@/infrastructure/conversation-v2/configured-internal-lab-authority";
import { createGitCycleIBuildAttestation } from "@/infrastructure/conversation-v2/git-cycle-i-build-attestation";

const hmac = (tail: string) => `hmac:${"a".repeat(63)}${tail}`;
const internalAuthority = generateKeyPairSync("ed25519");
const gateAuthority = generateKeyPairSync("ed25519");
const activationAuthority = generateKeyPairSync("ed25519");
const buildAttestation = createGitCycleIBuildAttestation();

process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = internalAuthority.publicKey
  .export({ type: "spki", format: "pem" }).toString();
process.env.CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY = gateAuthority.publicKey
  .export({ type: "spki", format: "pem" }).toString();
process.env.CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY = activationAuthority.publicKey
  .export({ type: "spki", format: "pem" }).toString();
process.env.VERCEL_GIT_COMMIT_SHA = buildAttestation.commit;
process.env.CONVERSATION_V2_GATE_REPORT_DIGEST = hmac("1");
process.env.CONVERSATION_V2_POPULATION_DIGEST = hmac("2");
process.env.CONVERSATION_V2_DATASET_DIGEST = hmac("3");
process.env.CONVERSATION_V2_CONFIG_DIGEST = hmac("4");

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

const readyCriteria = [
  ...smokeCriteria,
  "exact_build_deployed",
  "real_internal_number_smoke_green",
  "production_rollback_green",
  "inbox_persistence_green",
  "synthetic_personas_captured",
  "automated_evidence_generated",
  "observability_green",
  "lab_final_engine_v2_internal",
] as const;

const smokeEvidence = [
  { kind: "verification", digest: hmac("5") },
  { kind: "architecture_review", digest: hmac("6") },
] as const;

const readyEvidence = [
  ...smokeEvidence,
  { kind: "production_smoke", digest: hmac("7") },
  { kind: "rollback", digest: hmac("8") },
  { kind: "personas", digest: hmac("9") },
  { kind: "inbox", digest: hmac("b") },
  { kind: "observability", digest: hmac("c") },
] as const;

function smokeClaims(
  overrides: Partial<InternalLabApprovalClaims> = {},
): InternalLabApprovalClaims {
  return {
    schemaVersion: 1,
    decision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
    authorityDomain: INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA!,
    treeSha: buildAttestation.tree,
    sourceDigest: buildAttestation.sourceDigest,
    runtimeDigest: computeInternalLabRuntimeDigest(buildAttestation.runtime),
    tenantDigest: hmac("f"),
    channelDigest: hmac("0"),
    configDigest: hmac("a"),
    cycleIGateDigest: process.env.CONVERSATION_V2_GATE_REPORT_DIGEST!,
    cycleIDecision: "NO_GO",
    qualitativeStatus: "not_measurable",
    criteria: smokeCriteria,
    evidenceDigests: smokeEvidence,
    issuedAt: "2026-08-17T15:00:00.000Z",
    expiresAt: "2026-08-17T15:10:00.000Z",
    ...overrides,
  };
}

function canonicalClaims(claims: InternalLabApprovalClaims): string {
  return JSON.stringify({
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
    criteria: claims.criteria,
    evidenceDigests: claims.evidenceDigests.map(({ kind, digest }) => ({ kind, digest })),
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  });
}

function serializeApproval(
  claims: InternalLabApprovalClaims,
  privateKey = internalAuthority.privateKey,
): string {
  const payload = Buffer.from(canonicalClaims(claims));
  const signed = Buffer.concat([
    Buffer.from(INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
    Buffer.from([0]),
    payload,
  ]);
  return JSON.stringify({
    claims,
    signature: `ed25519:${sign(null, signed, privateKey).toString("hex")}`,
  });
}

function validInput(claims = smokeClaims()) {
  const serializedApproval = serializeApproval(claims);
  process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = serializedApproval;
  process.env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST = claims.tenantDigest;
  process.env.CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST = claims.channelDigest;
  process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST = claims.configDigest;
  return {
    serializedApproval,
    authority: loadConfiguredInternalLabAuthority(),
    runtimeIdentity: createConfiguredCycleIRuntimeBuildIdentity(),
    buildAttestation,
    expectedTenantDigest: claims.tenantDigest,
    expectedChannelDigest: claims.channelDigest,
    expectedConfigDigest: claims.configDigest,
    now: new Date("2026-08-17T15:05:00.000Z"),
  };
}

describe("Conversation V2 Internal Lab approval", () => {
  it("registers only a valid internal approval bound to exact bytes and Lab digests", () => {
    const input = validInput();
    const approval = parseAndRegisterInternalLabApproval(input);

    expect(isRegisteredInternalLabApproval(approval, {
      decision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
      runtimeIdentity: input.runtimeIdentity,
      tenantDigest: hmac("f"),
      channelDigest: hmac("0"),
      configDigest: hmac("a"),
      now: input.now,
    })).toBe(true);
    expect(Object.isFrozen(approval)).toBe(true);
    expect(Object.isFrozen(approval.claims)).toBe(true);
    expect(Object.isFrozen(approval.claims.criteria)).toBe(true);
    expect(Object.isFrozen(approval.claims.evidenceDigests)).toBe(true);
  });

  it.each([
    "commitSha",
    "treeSha",
    "sourceDigest",
    "runtimeDigest",
    "tenantDigest",
    "channelDigest",
    "configDigest",
  ] as const)("rejects a changed %s", (field) => {
    const original = smokeClaims();
    const serialized = JSON.parse(serializeApproval(original)) as {
      claims: Record<string, unknown>;
      signature: string;
    };
    serialized.claims[field] = field.endsWith("Sha") ? "c".repeat(40) : hmac("9");

    expect(() => parseAndRegisterInternalLabApproval({
      ...validInput(original),
      serializedApproval: JSON.stringify(serialized),
    })).toThrow(/signature|mismatch|invalid/i);
  });

  it("cannot reinterpret Cycle I or human review as pass", () => {
    expect(() => parseAndRegisterInternalLabApproval(validInput(smokeClaims({
      cycleIDecision: "GO" as never,
    })))).toThrow(/Cycle I|decision|invalid/i);
    expect(() => parseAndRegisterInternalLabApproval(validInput(smokeClaims({
      qualitativeStatus: "pass" as never,
    })))).toThrow(/qualitative|invalid/i);
  });

  it("requires the exact SMOKE criteria, evidence, and a live short-lived approval", () => {
    expect(() => parseAndRegisterInternalLabApproval(validInput(smokeClaims({
      criteria: smokeCriteria.slice(0, -1),
    })))).toThrow(/criteria/i);
    expect(() => parseAndRegisterInternalLabApproval(validInput(smokeClaims({
      evidenceDigests: smokeEvidence.slice(0, -1),
    })))).toThrow(/evidence/i);
    expect(() => parseAndRegisterInternalLabApproval(validInput(smokeClaims({
      expiresAt: null,
    })))).toThrow(/expires/i);
    expect(() => parseAndRegisterInternalLabApproval({
      ...validInput(),
      now: new Date("2026-08-17T15:10:00.000Z"),
    })).toThrow(/expired/i);
  });

  it("refuses to canonicalize semantically invalid claims for offline issuance", () => {
    const serializeForIssuance = serializeInternalLabApprovalClaims as unknown as (
      claims: InternalLabApprovalClaims,
      now: Date,
    ) => string;
    expect(() => serializeForIssuance(smokeClaims({
      criteria: smokeCriteria.slice(0, -1),
    }), new Date("2026-08-17T15:05:00.000Z"))).toThrow(/criteria/i);
  });

  it("requires every additional READY criterion/evidence and no expiry", () => {
    const claims = smokeClaims({
      decision: "INTERNAL_LAB_READY",
      criteria: readyCriteria,
      evidenceDigests: readyEvidence,
      expiresAt: null,
    });
    const input = validInput(claims);
    const approval = parseAndRegisterInternalLabApproval(input);
    expect(isRegisteredInternalLabApproval(approval, {
      decision: "INTERNAL_LAB_READY",
      runtimeIdentity: input.runtimeIdentity,
      tenantDigest: claims.tenantDigest,
      channelDigest: claims.channelDigest,
      configDigest: claims.configDigest,
      now: new Date("2030-01-01T00:00:00.000Z"),
    })).toBe(true);

    expect(() => parseAndRegisterInternalLabApproval(validInput({
      ...claims,
      criteria: readyCriteria.slice(0, -1),
    }))).toThrow(/criteria/i);
    expect(() => parseAndRegisterInternalLabApproval(validInput({
      ...claims,
      evidenceDigests: readyEvidence.slice(0, -1),
    }))).toThrow(/evidence/i);
    expect(() => parseAndRegisterInternalLabApproval(validInput({
      ...claims,
      expiresAt: "2026-08-17T15:10:00.000Z",
    }))).toThrow(/expires/i);
  });

  it("rejects unregistered authorities, identities, casts, copies, and replay across identities", () => {
    const input = validInput();
    expect(() => parseAndRegisterInternalLabApproval({
      ...input,
      authority: {
        domain: INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
        verifyCanonicalPayload: () => true,
      } as never,
    })).toThrow(/authority|registered/i);
    expect(() => parseAndRegisterInternalLabApproval({
      ...input,
      runtimeIdentity: { ...input.runtimeIdentity } as never,
    })).toThrow(/runtime|registered/i);

    const approval = parseAndRegisterInternalLabApproval(input);
    expect(isRegisteredInternalLabApproval({ ...approval }, {
      decision: approval.claims.decision,
      runtimeIdentity: input.runtimeIdentity,
      tenantDigest: approval.claims.tenantDigest,
      channelDigest: approval.claims.channelDigest,
      configDigest: approval.claims.configDigest,
      now: input.now,
    })).toBe(false);
    expect(isRegisteredInternalLabApproval(approval, {
      decision: approval.claims.decision,
      runtimeIdentity: createConfiguredCycleIRuntimeBuildIdentity(),
      tenantDigest: approval.claims.tenantDigest,
      channelDigest: approval.claims.channelDigest,
      configDigest: approval.claims.configDigest,
      now: input.now,
    })).toBe(false);
  });

  it("rejects extra properties and signatures from another Ed25519 authority", () => {
    const input = validInput();
    const withExtra = JSON.parse(input.serializedApproval) as Record<string, unknown>;
    withExtra.publicKey = internalAuthority.publicKey.export({ type: "spki", format: "pem" });
    expect(() => parseAndRegisterInternalLabApproval({
      ...input,
      serializedApproval: JSON.stringify(withExtra),
    })).toThrow(/invalid|keys|approval/i);

    const attacker = generateKeyPairSync("ed25519");
    expect(() => parseAndRegisterInternalLabApproval({
      ...input,
      serializedApproval: serializeApproval(smokeClaims(), attacker.privateKey),
    })).toThrow(/signature/i);
  });
});
