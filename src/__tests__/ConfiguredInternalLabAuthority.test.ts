import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const internalEnv = "CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY";
const cycleRootEnvs = [
  "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_REVIEW_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_REPLAY_APPROVAL_PUBLIC_KEY",
] as const;
const targetEnvs = [
  "CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON",
  "CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST",
  "CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST",
  "CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST",
] as const;
const trackedEnvs = [internalEnv, ...cycleRootEnvs, ...targetEnvs] as const;
const originals = Object.fromEntries(trackedEnvs.map((name) => [name, process.env[name]]));

function pem(key: ReturnType<typeof generateKeyPairSync>["publicKey"]): string {
  return key.export({ type: "spki", format: "pem" }).toString();
}

function restore(): void {
  for (const name of trackedEnvs) {
    const original = originals[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

function configureTarget(): void {
  process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = "configured-approval-artifact";
  process.env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST = `hmac:${"1".repeat(64)}`;
  process.env.CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST = `hmac:${"2".repeat(64)}`;
  process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST = `hmac:${"3".repeat(64)}`;
}

function runSignerExpectingFailure(
  privateKeyPath: string,
  claimsPath = resolve(process.cwd(), "package.json"),
): string {
  try {
    execFileSync(
      resolve(process.cwd(), "node_modules/.bin/tsx"),
      [
        resolve(process.cwd(), "scripts/sign-internal-lab-approval.ts"),
        "--private-key-file",
        privateKeyPath,
        "--claims-file",
        claimsPath,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
  throw new Error("signer unexpectedly succeeded");
}

beforeEach(configureTarget);

afterEach(() => {
  restore();
  vi.resetModules();
});

describe("configured Internal Lab authority", () => {
  it("fails closed without its dedicated deployment public key", async () => {
    delete process.env[internalEnv];
    const authority = await import(
      "@/infrastructure/conversation-v2/configured-internal-lab-authority"
    );
    expect(() => authority.loadConfiguredInternalLabAuthority())
      .toThrow(/Internal Lab|authority|configured/i);
  });

  it("fails closed without every configured target binding", async () => {
    const key = generateKeyPairSync("ed25519");
    process.env[internalEnv] = pem(key.publicKey);
    delete process.env.CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST;
    const authority = await import(
      "@/infrastructure/conversation-v2/configured-internal-lab-authority"
    );

    expect(() => authority.loadConfiguredInternalLabAuthority())
      .toThrow(/target binding|TENANT_DIGEST|configured/i);
  });

  it("loads a nominal authority and verifies only domain-separated canonical bytes", async () => {
    const key = generateKeyPairSync("ed25519");
    process.env[internalEnv] = pem(key.publicKey);
    for (const name of cycleRootEnvs) process.env[name] = pem(generateKeyPairSync("ed25519").publicKey);
    const authorityModule = await import(
      "@/infrastructure/conversation-v2/configured-internal-lab-authority"
    );
    const authority = authorityModule.loadConfiguredInternalLabAuthority();
    const payload = Buffer.from("canonical-payload");
    const signature = sign(null, Buffer.concat([
      Buffer.from(authorityModule.INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
      Buffer.from([0]),
      payload,
    ]), key.privateKey);
    const wrongDomainSignature = sign(null, Buffer.concat([
      Buffer.from("systemops.conversation-v2.cycle-i.activation-approval.v1"),
      Buffer.from([0]),
      payload,
    ]), key.privateKey);

    expect(authorityModule.isRegisteredConfiguredInternalLabAuthority(authority)).toBe(true);
    expect(authority.verifyCanonicalPayload(payload, signature)).toBe(true);
    expect(authority.verifyCanonicalPayload(payload, wrongDomainSignature)).toBe(false);
    expect(authorityModule.isRegisteredConfiguredInternalLabAuthority({
      domain: authorityModule.INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
      verifyCanonicalPayload: () => true,
    })).toBe(false);
    expect(Object.isFrozen(authority)).toBe(true);
  });

  it("accepts explicit Ed25519 SPKI DER and snapshots the trusted root once", async () => {
    const trusted = generateKeyPairSync("ed25519");
    const attacker = generateKeyPairSync("ed25519");
    const der = trusted.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    process.env[internalEnv] = `spki-der-base64:${der}`;
    const authorityModule = await import(
      "@/infrastructure/conversation-v2/configured-internal-lab-authority"
    );
    const authority = authorityModule.loadConfiguredInternalLabAuthority();
    process.env[internalEnv] = pem(attacker.publicKey);
    const payload = Buffer.from("payload");
    const signed = (privateKey: typeof trusted.privateKey) => sign(null, Buffer.concat([
      Buffer.from(authorityModule.INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
      Buffer.from([0]),
      payload,
    ]), privateKey);

    const reloaded = authorityModule.loadConfiguredInternalLabAuthority();
    expect(reloaded).not.toBe(authority);
    expect(reloaded.verifyCanonicalPayload(payload, signed(trusted.privateKey))).toBe(true);
    expect(reloaded.verifyCanonicalPayload(payload, signed(attacker.privateKey))).toBe(false);
  });

  it.each(cycleRootEnvs)("rejects reuse of Cycle I root %s", async (cycleRootEnv) => {
    const shared = generateKeyPairSync("ed25519");
    process.env[internalEnv] = pem(shared.publicKey);
    process.env[cycleRootEnv] = pem(shared.publicKey);
    const authorityModule = await import(
      "@/infrastructure/conversation-v2/configured-internal-lab-authority"
    );

    expect(() => authorityModule.loadConfiguredInternalLabAuthority()).toThrow(/distinct|Cycle I/i);
  });

  it("rejects private, non-Ed25519, and ambiguous public material", async () => {
    const ed25519 = generateKeyPairSync("ed25519");
    process.env[internalEnv] = ed25519.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    let authorityModule = await import(
      "@/infrastructure/conversation-v2/configured-internal-lab-authority"
    );
    expect(() => authorityModule.loadConfiguredInternalLabAuthority()).toThrow(/public|SPKI|private/i);

    vi.resetModules();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env[internalEnv] = pem(rsa.publicKey);
    authorityModule = await import("@/infrastructure/conversation-v2/configured-internal-lab-authority");
    expect(() => authorityModule.loadConfiguredInternalLabAuthority()).toThrow(/Ed25519/i);

    vi.resetModules();
    process.env[internalEnv] = "not-a-key";
    authorityModule = await import("@/infrastructure/conversation-v2/configured-internal-lab-authority");
    expect(() => authorityModule.loadConfiguredInternalLabAuthority()).toThrow(/SPKI|public/i);
  });

  it("rejects a lexical worktree key path even when it symlinks outside", () => {
    const external = mkdtempSync(join(tmpdir(), "internal-lab-key-external-"));
    const inside = mkdtempSync(resolve(process.cwd(), "node_modules/.internal-lab-key-link-"));
    try {
      const externalFile = join(external, "not-a-key.pem");
      const worktreeLink = join(inside, "key.pem");
      writeFileSync(externalFile, "not key material", { mode: 0o600 });
      symlinkSync(externalFile, worktreeLink);

      expect(runSignerExpectingFailure(worktreeLink)).toMatch(/outside.*worktree/i);
    } finally {
      rmSync(inside, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  it("rejects an external key path with a hard-link alias", () => {
    const external = mkdtempSync(join(tmpdir(), "internal-lab-key-hardlink-"));
    try {
      const firstPath = join(external, "first.pem");
      const secondPath = join(external, "second.pem");
      writeFileSync(firstPath, "not key material", { mode: 0o600 });
      linkSync(firstPath, secondPath);
      chmodSync(secondPath, 0o600);

      expect(runSignerExpectingFailure(secondPath)).toMatch(/hard.?link|single link/i);
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  });

  it("rejects non-configured target claims before it reads or signs with a private key", () => {
    const external = mkdtempSync(join(tmpdir(), "internal-lab-target-binding-"));
    try {
      const keyPath = join(external, "not-a-key.pem");
      const claimsPath = join(external, "claims.json");
      const key = generateKeyPairSync("ed25519");
      process.env[internalEnv] = pem(key.publicKey);
      writeFileSync(keyPath, "not key material", { mode: 0o600 });
      writeFileSync(claimsPath, JSON.stringify({
        schemaVersion: 1,
        decision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
        authorityDomain: "systemops.conversation-v2.internal-lab-approval.v1",
        commitSha: "a".repeat(40),
        treeSha: "b".repeat(40),
        sourceDigest: `hmac:${"d".repeat(64)}`,
        runtimeDigest: `hmac:${"e".repeat(64)}`,
        tenantDigest: `hmac:${"f".repeat(64)}`,
        channelDigest: `hmac:${"0".repeat(64)}`,
        configDigest: `hmac:${"a".repeat(64)}`,
        cycleIGateDigest: `hmac:${"1".repeat(64)}`,
        cycleIDecision: "NO_GO",
        qualitativeStatus: "not_measurable",
        criteria: [
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
          { kind: "verification", digest: `hmac:${"5".repeat(64)}` },
          { kind: "architecture_review", digest: `hmac:${"6".repeat(64)}` },
        ],
        issuedAt: "2026-08-17T15:00:00.000Z",
        expiresAt: "2026-08-18T15:00:00.000Z",
      }));

      expect(runSignerExpectingFailure(keyPath, claimsPath)).toMatch(/configured target|tenantDigest/i);
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  });
});
