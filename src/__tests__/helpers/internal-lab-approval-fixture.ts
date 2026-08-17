import { generateKeyPairSync, sign } from "node:crypto";
import {
  computeInternalLabRuntimeDigest,
  parseAndRegisterInternalLabApproval,
  type InternalLabApprovalClaims,
  type RegisteredInternalLabApproval,
} from "@/application/conversation-v2/internal-lab-approval";
import {
  createConfiguredCycleIRuntimeBuildIdentity,
  type CycleIRuntimeBuildIdentity,
} from "@/application/conversation-v2/configured-cycle-i-authority";
import {
  INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
  loadConfiguredInternalLabAuthority,
} from "@/infrastructure/conversation-v2/configured-internal-lab-authority";
import { createGitCycleIBuildAttestation } from "@/infrastructure/conversation-v2/git-cycle-i-build-attestation";

const hmac = (tail: string) => `hmac:${"a".repeat(63)}${tail}`;
const internalAuthority = generateKeyPairSync("ed25519");
const gateAuthority = generateKeyPairSync("ed25519");
const activationAuthority = generateKeyPairSync("ed25519");
const smokeCriteria = [
  "h_safety_entailment_preserved", "tasks_1_7_closed", "architecture_review_clear",
  "final_build_measurement_recorded", "single_router_boundary", "tenant_flag_fail_closed",
  "same_turn_fallback_absent", "isolation_dedupe_state_booking_outbox_sender_green",
  "bidirectional_rollback_green", "verify_green", "single_internal_target",
] as const;

export const INTERNAL_LAB_TEST_BINDINGS = Object.freeze({
  expectedClinicId: "systemops-lab",
  tenantDigest: hmac("f"),
  channelDigest: hmac("0"),
  configDigest: hmac("a"),
  now: new Date("2026-08-17T15:05:00.000Z"),
});

const registeredInternalLabSmokeApproval: Readonly<{
  approval: RegisteredInternalLabApproval;
  runtimeIdentity: CycleIRuntimeBuildIdentity;
}> = (() => {
  const build = createGitCycleIBuildAttestation();
  process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = internalAuthority.publicKey
    .export({ type: "spki", format: "pem" }).toString();
  process.env.CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY = gateAuthority.publicKey
    .export({ type: "spki", format: "pem" }).toString();
  process.env.CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY = activationAuthority.publicKey
    .export({ type: "spki", format: "pem" }).toString();
  process.env.VERCEL_GIT_COMMIT_SHA = build.commit;
  process.env.CONVERSATION_V2_GATE_REPORT_DIGEST = hmac("1");
  process.env.CONVERSATION_V2_POPULATION_DIGEST = hmac("2");
  process.env.CONVERSATION_V2_DATASET_DIGEST = hmac("3");
  process.env.CONVERSATION_V2_CONFIG_DIGEST = hmac("4");

  const claims: InternalLabApprovalClaims = {
    schemaVersion: 1,
    decision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
    authorityDomain: INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
    commitSha: build.commit,
    treeSha: build.tree,
    sourceDigest: build.sourceDigest,
    runtimeDigest: computeInternalLabRuntimeDigest(build.runtime),
    tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
    channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
    configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
    cycleIGateDigest: process.env.CONVERSATION_V2_GATE_REPORT_DIGEST,
    cycleIDecision: "NO_GO",
    qualitativeStatus: "not_measurable",
    criteria: smokeCriteria,
    evidenceDigests: [
      { kind: "verification", digest: hmac("5") },
      { kind: "architecture_review", digest: hmac("6") },
    ],
    issuedAt: "2026-08-17T15:00:00.000Z",
    expiresAt: "2026-08-17T15:10:00.000Z",
  };
  const payload = JSON.stringify(claims);
  const serializedApproval = JSON.stringify({
    claims,
    signature: `ed25519:${sign(null, Buffer.concat([
      Buffer.from(INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN), Buffer.from([0]), Buffer.from(payload),
    ]), internalAuthority.privateKey).toString("hex")}`,
  });
  process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = serializedApproval;
  process.env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST = claims.tenantDigest;
  process.env.CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST = claims.channelDigest;
  process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST = claims.configDigest;
  const runtimeIdentity = createConfiguredCycleIRuntimeBuildIdentity();
  const approval = parseAndRegisterInternalLabApproval({
    serializedApproval,
    authority: loadConfiguredInternalLabAuthority(),
    runtimeIdentity,
    buildAttestation: build,
    expectedTenantDigest: claims.tenantDigest,
    expectedChannelDigest: claims.channelDigest,
    expectedConfigDigest: claims.configDigest,
    now: INTERNAL_LAB_TEST_BINDINGS.now,
  });
  return Object.freeze({ approval, runtimeIdentity });
})();

export function createRegisteredInternalLabSmokeApproval(): Readonly<{
  approval: RegisteredInternalLabApproval;
  runtimeIdentity: CycleIRuntimeBuildIdentity;
}> {
  return registeredInternalLabSmokeApproval;
}
