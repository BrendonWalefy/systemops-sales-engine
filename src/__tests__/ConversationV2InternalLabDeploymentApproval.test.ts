import { generateKeyPairSync, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tracked = [
  "CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON",
  "CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST",
  "CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST",
  "CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST",
  "CONVERSATION_V2_GATE_REPORT_DIGEST",
  "CONVERSATION_V2_POPULATION_DIGEST",
  "CONVERSATION_V2_DATASET_DIGEST",
  "CONVERSATION_V2_CONFIG_DIGEST",
  "VERCEL_GIT_COMMIT_SHA",
  "GIT_COMMIT_SHA",
] as const;
const originals = Object.fromEntries(tracked.map((name) => [name, process.env[name]]));
const internal = generateKeyPairSync("ed25519");
const gate = generateKeyPairSync("ed25519");
const activation = generateKeyPairSync("ed25519");
const hmac = (tail: string) => `hmac:${"a".repeat(63)}${tail}`;
const commit = "a".repeat(40);

beforeAll(() => {
  process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = internal.publicKey.export({ type: "spki", format: "pem" }).toString();
  process.env.CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY = gate.publicKey.export({ type: "spki", format: "pem" }).toString();
  process.env.CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY = activation.publicKey.export({ type: "spki", format: "pem" }).toString();
  process.env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST = hmac("1");
  process.env.CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST = hmac("2");
  process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST = hmac("3");
  process.env.CONVERSATION_V2_GATE_REPORT_DIGEST = hmac("4");
  process.env.CONVERSATION_V2_POPULATION_DIGEST = hmac("5");
  process.env.CONVERSATION_V2_DATASET_DIGEST = hmac("6");
  process.env.CONVERSATION_V2_CONFIG_DIGEST = hmac("7");
  process.env.VERCEL_GIT_COMMIT_SHA = commit;
  delete process.env.GIT_COMMIT_SHA;
});

afterAll(() => {
  for (const name of tracked) {
    if (originals[name] === undefined) delete process.env[name];
    else process.env[name] = originals[name];
  }
});

describe("Internal Lab deployed approval registration", () => {
  it("registers exact signed deployment bytes without a Git worktree and rejects mismatches or forged identity", async () => {
    const approvalModule = await import("@/application/conversation-v2/internal-lab-approval");
    const cycleModule = await import("@/application/conversation-v2/configured-cycle-i-authority");
    const authorityModule = await import("@/infrastructure/conversation-v2/configured-internal-lab-authority");
    const runtimeIdentity = cycleModule.createConfiguredCycleIRuntimeBuildIdentity();
    const deploymentIdentity = authorityModule.loadConfiguredInternalLabDeploymentIdentity();
    const claims = {
      schemaVersion: 1 as const,
      decision: "INTERNAL_LAB_SMOKE_AUTHORIZED" as const,
      authorityDomain: authorityModule.INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
      commitSha: commit,
      treeSha: "b".repeat(40),
      sourceDigest: hmac("8"),
      runtimeDigest: approvalModule.computeInternalLabRuntimeDigest(deploymentIdentity.runtime),
      tenantDigest: hmac("1"), channelDigest: hmac("2"), configDigest: hmac("3"),
      cycleIGateDigest: hmac("4"), cycleIDecision: "NO_GO" as const,
      qualitativeStatus: "pending_human_review" as const,
      criteria: [
        "h_safety_entailment_preserved", "tasks_1_7_closed", "architecture_review_clear",
        "final_build_measurement_recorded", "single_router_boundary", "tenant_flag_fail_closed",
        "same_turn_fallback_absent", "isolation_dedupe_state_booking_outbox_sender_green",
        "bidirectional_rollback_green", "verify_green", "single_internal_target",
      ] as const,
      evidenceDigests: [
        { kind: "verification" as const, digest: hmac("9") },
        { kind: "architecture_review" as const, digest: hmac("b") },
      ],
      issuedAt: "2026-08-17T15:00:00.000Z", expiresAt: "2026-08-17T15:10:00.000Z",
    };
    const serialize = (value: typeof claims) => {
      const payload = JSON.stringify(value);
      return JSON.stringify({ claims: value, signature: `ed25519:${sign(null, Buffer.concat([
        Buffer.from(authorityModule.INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN), Buffer.from([0]), Buffer.from(payload),
      ]), internal.privateKey).toString("hex")}` });
    };
    const parse = (serializedApproval: string, deployment = deploymentIdentity) => {
      process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = serializedApproval;
      return approvalModule.parseAndRegisterDeployedInternalLabApproval({
        serializedApproval,
        authority: authorityModule.loadConfiguredInternalLabAuthority(),
        runtimeIdentity,
        deploymentIdentity: deployment,
        expectedTenantDigest: hmac("1"), expectedChannelDigest: hmac("2"), expectedConfigDigest: hmac("3"),
        now: new Date("2026-08-17T15:05:00.000Z"),
      });
    };

    const approval = parse(serialize(claims));
    expect(approval.claims).toMatchObject({ treeSha: "b".repeat(40), sourceDigest: hmac("8") });
    expect(approvalModule.isRegisteredInternalLabApproval(approval, {
      decision: claims.decision, runtimeIdentity, tenantDigest: hmac("1"), channelDigest: hmac("2"),
      configDigest: hmac("3"), now: new Date("2026-08-17T15:05:00.000Z"),
    })).toBe(true);
    expect(() => parse(serialize({ ...claims, commitSha: "c".repeat(40) }))).toThrow(/commit/i);
    expect(() => parse(serialize({ ...claims, runtimeDigest: hmac("c") }))).toThrow(/runtime/i);
    expect(() => parse(serialize(claims), { ...deploymentIdentity })).toThrow(/deployment|registered/i);
  });
});
