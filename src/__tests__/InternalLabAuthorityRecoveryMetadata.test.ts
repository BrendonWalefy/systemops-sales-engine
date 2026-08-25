import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeInternalLabRuntimeDigest,
  serializeInternalLabApprovalClaims,
} from "@/application/conversation-v2/internal-lab-approval";
import { INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN } from
  "@/infrastructure/conversation-v2/configured-internal-lab-authority";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/session", () => ({
  verifyToken: mocks.verifyToken,
  COOKIE_NAME: "sops_session",
}));

import { describeInternalLabAuthorityRecoveryMetadata } from
  "@/application/conversation-v2/internal-lab-authority-recovery-metadata";
import { GET } from "@/app/api/owner/internal-lab-authority-status/route";

const ENV_KEYS = [
  "SYSTEMOPS_LAB_CLINIC_ID",
  "CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON",
  "CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST",
  "CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST",
  "CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST",
  "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_GATE_REPORT_DIGEST",
  "CONVERSATION_V2_POPULATION_DIGEST",
  "CONVERSATION_V2_DATASET_DIGEST",
  "CONVERSATION_V2_CONFIG_DIGEST",
  "VERCEL_GIT_COMMIT_SHA",
  "DATABASE_URL",
  "OPENAI_API_KEY",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const digest = (character: string) => `hmac:${character.repeat(64)}`;
const internalAuthority = generateKeyPairSync("ed25519");
const gateAuthority = generateKeyPairSync("ed25519");
const activationAuthority = generateKeyPairSync("ed25519");
const publicKey = (key: typeof internalAuthority.publicKey) => key.export({
  type: "spki",
  format: "pem",
}).toString().trim();

function approval(input: Readonly<{
  commitSha?: string;
  runtimeDigest?: string;
  criteria?: readonly string[];
  signature?: string;
}> = {}): string {
  const claims = {
      schemaVersion: 1,
      decision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
      authorityDomain: "systemops.conversation-v2.internal-lab-approval.v1",
      commitSha: input.commitSha ?? "a".repeat(40),
      treeSha: "b".repeat(40),
      sourceDigest: digest("1"),
      runtimeDigest: input.runtimeDigest ?? `sha256:${"2".repeat(64)}`,
      tenantDigest: digest("3"),
      channelDigest: digest("4"),
      configDigest: digest("5"),
      cycleIGateDigest: digest("6"),
      cycleIDecision: "NO_GO",
      qualitativeStatus: "not_measurable",
      criteria: input.criteria ?? [
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
      ],
      evidenceDigests: [
        { kind: "verification", digest: digest("7") },
        { kind: "architecture_review", digest: digest("8") },
      ],
      issuedAt: "2026-08-19T00:00:00.000Z",
      expiresAt: "2026-08-20T00:00:00.000Z",
  } as const;
  const canonicalClaims = serializeInternalLabApprovalClaims(claims);
  const signature = input.signature ?? `ed25519:${sign(
    null,
    Buffer.from(`${INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN}\0${canonicalClaims}`),
    internalAuthority.privateKey,
  ).toString("hex")}`;
  return JSON.stringify({ claims, signature });
}

function configureEnvironment(): void {
  process.env.SYSTEMOPS_LAB_CLINIC_ID = "92fe7ecf-f383-4ddc-8c4e-53271af8e3a0";
  process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = approval();
  process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = publicKey(
    internalAuthority.publicKey,
  );
  process.env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST = digest("3");
  process.env.CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST = digest("4");
  process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST = digest("5");
  process.env.CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY = publicKey(gateAuthority.publicKey);
  process.env.CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY = publicKey(
    activationAuthority.publicKey,
  );
  process.env.CONVERSATION_V2_GATE_REPORT_DIGEST = digest("6");
  process.env.CONVERSATION_V2_POPULATION_DIGEST = digest("a");
  process.env.CONVERSATION_V2_DATASET_DIGEST = digest("b");
  process.env.CONVERSATION_V2_CONFIG_DIGEST = digest("c");
  process.env.VERCEL_GIT_COMMIT_SHA = "d".repeat(40);
  process.env.DATABASE_URL = "postgres://must-not-leak";
  process.env.OPENAI_API_KEY = "must-not-leak";
}

function restoreEnvironment(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("Internal Lab authority recovery metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureEnvironment();
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "owner-token" }) });
    mocks.verifyToken.mockResolvedValue({ role: "owner" });
  });

  afterEach(restoreEnvironment);

  it("returns only the non-secret inputs needed to renew the exact deployed build", () => {
    const metadata = describeInternalLabAuthorityRecoveryMetadata(process.env, {
      nodeVersion: "v24.18.1",
      platform: "linux",
      arch: "x64",
    });

    expect(metadata).toEqual({
      schemaVersion: 1,
      deployment: {
        commit: "d".repeat(40),
        nodeVersion: "v24.18.1",
        platform: "linux",
        arch: "x64",
      },
      target: {
        clinicId: "92fe7ecf-f383-4ddc-8c4e-53271af8e3a0",
        tenantDigest: digest("3"),
        channelDigest: digest("4"),
        configDigest: digest("5"),
      },
      cycleI: {
        gateReportAuthorityPublicKey: publicKey(gateAuthority.publicKey),
        activationApprovalAuthorityPublicKey: publicKey(activationAuthority.publicKey),
        gateReportDigest: digest("6"),
        populationDigest: digest("a"),
        datasetDigest: digest("b"),
        configDigest: digest("c"),
      },
      internalLabAuthorityPublicKey: publicKey(internalAuthority.publicKey),
      approval: {
        parsed: true,
        decision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
        commitSha: "a".repeat(40),
        issuedAt: "2026-08-19T00:00:00.000Z",
        expiresAt: "2026-08-20T00:00:00.000Z",
        expired: true,
        currentBuild: false,
        claims: expect.objectContaining({
          evidenceDigests: [
            { kind: "verification", digest: digest("7") },
            { kind: "architecture_review", digest: digest("8") },
          ],
        }),
      },
    });
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain("ed25519:");
    expect(serialized).not.toContain("postgres://must-not-leak");
    expect(serialized).not.toContain("must-not-leak");
  });

  it("fails closed when the configured approval is malformed", () => {
    process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = "not-json";

    const metadata = describeInternalLabAuthorityRecoveryMetadata(process.env, {
      nodeVersion: "v24.18.1",
      platform: "linux",
      arch: "x64",
    });

    expect(metadata.approval).toEqual({
      parsed: false,
      decision: null,
      commitSha: null,
      issuedAt: null,
      expiresAt: null,
      expired: null,
      currentBuild: false,
      claims: null,
    });
  });

  it("fails closed for forged or semantically incomplete approval evidence", () => {
    process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = approval({
      signature: `ed25519:${"9".repeat(128)}`,
    });
    expect(describeInternalLabAuthorityRecoveryMetadata(process.env, {
      nodeVersion: "v24.18.1",
      platform: "linux",
      arch: "x64",
    }).approval.parsed).toBe(false);

    process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = approval({
      criteria: ["verify_green"],
    });
    expect(describeInternalLabAuthorityRecoveryMetadata(process.env, {
      nodeVersion: "v24.18.1",
      platform: "linux",
      arch: "x64",
    }).approval.parsed).toBe(false);
  });

  it("fails closed instead of echoing malformed public roots or digests", () => {
    process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = "private-or-secret-value";
    expect(() => describeInternalLabAuthorityRecoveryMetadata(process.env, {
      nodeVersion: "v24.18.1",
      platform: "linux",
      arch: "x64",
    })).toThrow(/public key/i);

    process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = publicKey(
      internalAuthority.publicKey,
    );
    process.env.CONVERSATION_V2_GATE_REPORT_DIGEST = "secret-without-a-public-digest-format";
    expect(() => describeInternalLabAuthorityRecoveryMetadata(process.env, {
      nodeVersion: "v24.18.1",
      platform: "linux",
      arch: "x64",
    })).toThrow(/digest/i);
  });

  it("returns only canonical public material and supports the configured SPKI form", () => {
    const canonicalPem = publicKey(internalAuthority.publicKey);
    process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = [
      canonicalPem,
      "embedded-secret-value",
      "-----END PUBLIC KEY-----",
    ].join("\n");
    expect(() => describeInternalLabAuthorityRecoveryMetadata(process.env, {
      nodeVersion: "v24.18.1",
      platform: "linux",
      arch: "x64",
    })).toThrow(/public key/i);

    const spki = `spki-der-base64:${internalAuthority.publicKey.export({
      type: "spki",
      format: "der",
    }).toString("base64")}`;
    process.env.CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY = spki;
    expect(describeInternalLabAuthorityRecoveryMetadata(process.env, {
      nodeVersion: "v24.18.1",
      platform: "linux",
      arch: "x64",
    }).internalLabAuthorityPublicKey).toBe(spki);
  });

  it("requires both commit and runtime identity before reporting the current build", () => {
    const runtime = {
      nodeVersion: "v24.18.1",
      platform: "linux" as const,
      arch: "x64",
    };
    process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = approval({
      commitSha: "d".repeat(40),
      runtimeDigest: `sha256:${"2".repeat(64)}`,
    });

    expect(describeInternalLabAuthorityRecoveryMetadata(process.env, runtime)
      .approval.currentBuild).toBe(false);

    process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = approval({
      commitSha: "d".repeat(40),
      runtimeDigest: computeInternalLabRuntimeDigest(runtime),
    });
    expect(describeInternalLabAuthorityRecoveryMetadata(process.env, runtime)
      .approval.currentBuild).toBe(true);
  });

  it("rejects non-owner sessions", async () => {
    mocks.verifyToken.mockResolvedValue({ role: "org_admin" });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("serves recovery metadata to the authenticated owner without raw secrets", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deployment.commit).toBe("d".repeat(40));
    expect(body.approval.currentBuild).toBe(false);
    expect(body.signature).toBeUndefined();
    expect(body.databaseUrl).toBeUndefined();
    expect(body.openAiApiKey).toBeUndefined();
  });
});
