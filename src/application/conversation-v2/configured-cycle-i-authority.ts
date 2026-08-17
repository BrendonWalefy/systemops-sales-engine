import { createPublicKey, verify, type KeyObject } from "node:crypto";

export const CYCLE_I_GATE_REPORT_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.cycle-i.gate-report.v1" as const;
export const CYCLE_I_ACTIVATION_APPROVAL_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.cycle-i.activation-approval.v1" as const;

export type Ed25519SignatureRef = `ed25519:${string}`;

type ConfiguredAuthorityRoot = Readonly<{
  gateReportPublicKey: KeyObject;
  activationApprovalPublicKey: KeyObject;
}>;

let configuredRoot: ConfiguredAuthorityRoot | null | undefined;

function readEd25519PublicKey(name: string): KeyObject {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Cycle I trusted authority root is not configured: ${name}`);
  }
  const key = createPublicKey(value);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`Cycle I trusted authority root must be Ed25519: ${name}`);
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
