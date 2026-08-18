import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const gateEnv = "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY";
const approvalEnv = "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY";
const originalGateKey = process.env[gateEnv];
const originalApprovalKey = process.env[approvalEnv];

function publicPem(key: ReturnType<typeof generateKeyPairSync>["publicKey"]): string {
  return key.export({ type: "spki", format: "pem" }).toString();
}

afterEach(() => {
  if (originalGateKey === undefined) delete process.env[gateEnv];
  else process.env[gateEnv] = originalGateKey;
  if (originalApprovalKey === undefined) delete process.env[approvalEnv];
  else process.env[approvalEnv] = originalApprovalKey;
  vi.resetModules();
});

describe("Cycle I configured authority root", () => {
  it("fails closed without both trusted deployment public keys", async () => {
    delete process.env[gateEnv];
    delete process.env[approvalEnv];
    const authority = await import("@/application/conversation-v2/configured-cycle-i-authority");

    expect(() => authority.verifyConfiguredCycleIGateReportAuthority(
      "payload",
      `ed25519:${"a".repeat(128)}`,
    )).toThrow(/trusted authority root|configured/i);
  });

  it("requires distinct keys and domain-separates gate from approval signatures", async () => {
    const gate = generateKeyPairSync("ed25519");
    const approval = generateKeyPairSync("ed25519");
    process.env[gateEnv] = publicPem(gate.publicKey);
    process.env[approvalEnv] = publicPem(approval.publicKey);
    const authority = await import("@/application/conversation-v2/configured-cycle-i-authority");
    const payload = "canonical-payload";
    const gateSignature = `ed25519:${sign(
      null,
      Buffer.from(`${authority.CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN}\0${payload}`),
      gate.privateKey,
    ).toString("hex")}` as const;
    const approvalSignature = `ed25519:${sign(
      null,
      Buffer.from(`${authority.CYCLE_I_ACTIVATION_APPROVAL_AUTHORITY_DOMAIN}\0${payload}`),
      approval.privateKey,
    ).toString("hex")}` as const;

    expect(authority.verifyConfiguredCycleIGateReportAuthority(payload, gateSignature)).toBe(true);
    expect(authority.verifyConfiguredCycleIApprovalAuthority(payload, gateSignature)).toBe(false);
    expect(authority.verifyConfiguredCycleIApprovalAuthority(payload, approvalSignature)).toBe(true);
    expect(Object.values(authority).some((value) => typeof value === "object")).toBe(false);
  });

  it("accepts an explicitly tagged Ed25519 SPKI DER public key", async () => {
    const gate = generateKeyPairSync("ed25519");
    const approval = generateKeyPairSync("ed25519");
    const gateDer = gate.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    process.env[gateEnv] = `spki-der-base64:${gateDer}`;
    process.env[approvalEnv] = publicPem(approval.publicKey);
    const authority = await import("@/application/conversation-v2/configured-cycle-i-authority");
    const payload = "canonical-payload";
    const signature = `ed25519:${sign(
      null,
      Buffer.from(`${authority.CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN}\0${payload}`),
      gate.privateKey,
    ).toString("hex")}` as const;

    expect(authority.verifyConfiguredCycleIGateReportAuthority(payload, signature)).toBe(true);
  });

  it("snapshots the trusted public root once and ignores later attacker configuration", async () => {
    const trustedGate = generateKeyPairSync("ed25519");
    const trustedApproval = generateKeyPairSync("ed25519");
    const attackerGate = generateKeyPairSync("ed25519");
    process.env[gateEnv] = publicPem(trustedGate.publicKey);
    process.env[approvalEnv] = publicPem(trustedApproval.publicKey);
    const authority = await import("@/application/conversation-v2/configured-cycle-i-authority");
    const payload = "canonical-payload";
    const trustedSignature = `ed25519:${sign(
      null,
      Buffer.from(`${authority.CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN}\0${payload}`),
      trustedGate.privateKey,
    ).toString("hex")}` as const;
    expect(authority.verifyConfiguredCycleIGateReportAuthority(payload, trustedSignature)).toBe(true);

    process.env[gateEnv] = publicPem(attackerGate.publicKey);
    const attackerSignature = `ed25519:${sign(
      null,
      Buffer.from(`${authority.CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN}\0${payload}`),
      attackerGate.privateKey,
    ).toString("hex")}` as const;
    expect(authority.verifyConfiguredCycleIGateReportAuthority(payload, attackerSignature)).toBe(false);
    expect(authority.verifyConfiguredCycleIGateReportAuthority(payload, trustedSignature)).toBe(true);
  });

  it("rejects using the same public key for both authorities", async () => {
    const shared = generateKeyPairSync("ed25519");
    process.env[gateEnv] = publicPem(shared.publicKey);
    process.env[approvalEnv] = publicPem(shared.publicKey);
    const authority = await import("@/application/conversation-v2/configured-cycle-i-authority");

    expect(() => authority.verifyConfiguredCycleIGateReportAuthority(
      "payload",
      `ed25519:${"a".repeat(128)}`,
    )).toThrow(/distinct/i);
  });

  it.each([gateEnv, approvalEnv])(
    "rejects PKCS8 private key material in %s instead of deriving its public key",
    async (privateKeyEnv) => {
      const gate = generateKeyPairSync("ed25519");
      const approval = generateKeyPairSync("ed25519");
      process.env[gateEnv] = publicPem(gate.publicKey);
      process.env[approvalEnv] = publicPem(approval.publicKey);
      const privateKey = privateKeyEnv === gateEnv ? gate.privateKey : approval.privateKey;
      process.env[privateKeyEnv] = privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString();
      const authority = await import("@/application/conversation-v2/configured-cycle-i-authority");

      expect(() => authority.verifyConfiguredCycleIGateReportAuthority(
        "payload",
        `ed25519:${"a".repeat(128)}`,
      )).toThrow(/public|SPKI|private/i);
    },
  );
});
