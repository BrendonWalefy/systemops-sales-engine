import { generateKeyPairSync, sign } from "node:crypto";
import {
  computeInternalLabRuntimeDigest,
  parseAndRegisterInternalLabApproval,
  type InternalLabApprovalClaims,
} from "@/application/conversation-v2/internal-lab-approval";
import { createConfiguredCycleIRuntimeBuildIdentity } from "@/application/conversation-v2/configured-cycle-i-authority";
import {
  INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
  loadConfiguredInternalLabAuthority,
} from "@/infrastructure/conversation-v2/configured-internal-lab-authority";
import { createGitCycleIBuildAttestation } from "@/infrastructure/conversation-v2/git-cycle-i-build-attestation";

const environmentNames = [
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

const readyCriteria = [
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
  "exact_build_deployed",
  "real_internal_number_smoke_green",
  "production_rollback_green",
  "inbox_persistence_green",
  "synthetic_personas_captured",
  "automated_evidence_generated",
  "observability_green",
  "lab_final_engine_v2_internal",
] as const;

const hmac = (tail: string) => `hmac:${"a".repeat(63)}${tail}`;

export function createRegisteredInternalLabApprovalFixture() {
  const originals = Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]]),
  );
  const internalAuthority = generateKeyPairSync("ed25519");
  const gateAuthority = generateKeyPairSync("ed25519");
  const activationAuthority = generateKeyPairSync("ed25519");
  const pem = (key: typeof internalAuthority.publicKey) =>
    key.export({ type: "spki", format: "pem" }).toString();

  process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = pem(internalAuthority.publicKey);
  process.env.CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY = pem(gateAuthority.publicKey);
  process.env.CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY = pem(activationAuthority.publicKey);
  process.env.CONVERSATION_V2_GATE_REPORT_DIGEST = hmac("1");
  process.env.CONVERSATION_V2_POPULATION_DIGEST = hmac("2");
  process.env.CONVERSATION_V2_DATASET_DIGEST = hmac("3");
  process.env.CONVERSATION_V2_CONFIG_DIGEST = hmac("4");

  const buildAttestation = createGitCycleIBuildAttestation();
  process.env.VERCEL_GIT_COMMIT_SHA = buildAttestation.commit;
  const target = Object.freeze({
    tenantDigest: hmac("f"),
    channelDigest: hmac("0"),
    configDigest: hmac("a"),
  });
  const now = new Date("2026-08-17T15:05:00.000Z");
  const claims: InternalLabApprovalClaims = {
    schemaVersion: 1,
    decision: "INTERNAL_LAB_READY",
    authorityDomain: INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
    commitSha: buildAttestation.commit,
    treeSha: buildAttestation.tree,
    sourceDigest: buildAttestation.sourceDigest,
    runtimeDigest: computeInternalLabRuntimeDigest(buildAttestation.runtime),
    tenantDigest: target.tenantDigest,
    channelDigest: target.channelDigest,
    configDigest: target.configDigest,
    cycleIGateDigest: hmac("1"),
    cycleIDecision: "NO_GO",
    qualitativeStatus: "pending_human_review",
    criteria: readyCriteria,
    evidenceDigests: [
      { kind: "verification", digest: hmac("5") },
      { kind: "architecture_review", digest: hmac("6") },
      { kind: "production_smoke", digest: hmac("7") },
      { kind: "rollback", digest: hmac("8") },
      { kind: "personas", digest: hmac("9") },
      { kind: "inbox", digest: hmac("b") },
      { kind: "observability", digest: hmac("c") },
    ],
    issuedAt: "2026-08-17T15:00:00.000Z",
    expiresAt: null,
  };
  const canonicalClaims = JSON.stringify({
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
    evidenceDigests: claims.evidenceDigests,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  });
  const signed = Buffer.concat([
    Buffer.from(INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
    Buffer.from([0]),
    Buffer.from(canonicalClaims),
  ]);
  const serializedApproval = JSON.stringify({
    claims,
    signature: `ed25519:${sign(null, signed, internalAuthority.privateKey).toString("hex")}`,
  });
  process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = serializedApproval;
  process.env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST = target.tenantDigest;
  process.env.CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST = target.channelDigest;
  process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST = target.configDigest;

  const runtimeIdentity = createConfiguredCycleIRuntimeBuildIdentity();
  const approval = parseAndRegisterInternalLabApproval({
    serializedApproval,
    authority: loadConfiguredInternalLabAuthority(),
    runtimeIdentity,
    buildAttestation,
    expectedTenantDigest: target.tenantDigest,
    expectedChannelDigest: target.channelDigest,
    expectedConfigDigest: target.configDigest,
    now,
  });

  return Object.freeze({
    approval,
    runtimeIdentity,
    target,
    now,
    restoreEnvironment() {
      for (const name of environmentNames) {
        const original = originals[name];
        if (original === undefined) delete process.env[name];
        else process.env[name] = original;
      }
    },
  });
}
