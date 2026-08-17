import { createPublicKey, verify, type KeyObject } from "node:crypto";

export const INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN =
  "systemops.conversation-v2.internal-lab-approval.v1" as const;

export type ConfiguredInternalLabAuthority = Readonly<{
  domain: typeof INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN;
  verifyCanonicalPayload(payload: Uint8Array, signature: Uint8Array): boolean;
}>;

const configuredAuthorities = new WeakSet<object>();
const cycleIRootEnvironmentNames = Object.freeze([
  "CONVERSATION_V2_GATE_REPORT_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_ACTIVATION_APPROVAL_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_REVIEW_AUTHORITY_PUBLIC_KEY",
  "CONVERSATION_V2_REPLAY_APPROVAL_PUBLIC_KEY",
]);
let configuredAuthority: ConfiguredInternalLabAuthority | null | undefined;

function readEd25519PublicKey(name: string, required: boolean): KeyObject | null {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    if (!required) return null;
    throw new Error(`Internal Lab trusted authority root is not configured: ${name}`);
  }

  const encoded = value.trim();
  let key: KeyObject;
  if (
    encoded.startsWith("-----BEGIN PUBLIC KEY-----")
    && encoded.endsWith("-----END PUBLIC KEY-----")
  ) {
    key = createPublicKey(encoded);
  } else if (encoded.startsWith("spki-der-base64:")) {
    const base64 = encoded.slice("spki-der-base64:".length);
    const der = Buffer.from(base64, "base64");
    if (base64.length === 0 || der.toString("base64") !== base64) {
      throw new Error(`Internal Lab authority root must be explicit SPKI public material: ${name}`);
    }
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } else {
    throw new Error(`Internal Lab authority root must be explicit SPKI public material: ${name}`);
  }

  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
    throw new Error(`Internal Lab authority root must be an Ed25519 SPKI public key: ${name}`);
  }
  return key;
}

function samePublicKey(left: KeyObject, right: KeyObject): boolean {
  return left.export({ type: "spki", format: "der" })
    .equals(right.export({ type: "spki", format: "der" }));
}

export function loadConfiguredInternalLabAuthority(): ConfiguredInternalLabAuthority {
  if (configuredAuthority === null) {
    throw new Error("Internal Lab trusted authority root is unavailable");
  }
  if (configuredAuthority) return configuredAuthority;

  try {
    const publicKey = readEd25519PublicKey(
      "CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY",
      true,
    )!;
    for (const name of cycleIRootEnvironmentNames) {
      const cycleIRoot = readEd25519PublicKey(name, false);
      if (cycleIRoot && samePublicKey(publicKey, cycleIRoot)) {
        throw new Error(`Internal Lab authority must be distinct from Cycle I root: ${name}`);
      }
    }

    const authority = Object.freeze({
      domain: INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
      verifyCanonicalPayload(payload: Uint8Array, signature: Uint8Array): boolean {
        if (!(payload instanceof Uint8Array) || !(signature instanceof Uint8Array)) return false;
        if (signature.byteLength !== 64) return false;
        try {
          return verify(
            null,
            Buffer.concat([
              Buffer.from(INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
              Buffer.from([0]),
              Buffer.from(payload),
            ]),
            publicKey,
            Buffer.from(signature),
          );
        } catch {
          return false;
        }
      },
    }) satisfies ConfiguredInternalLabAuthority;
    configuredAuthorities.add(authority);
    configuredAuthority = authority;
    return authority;
  } catch (error) {
    configuredAuthority = null;
    throw error;
  }
}

export function isRegisteredConfiguredInternalLabAuthority(
  authority: unknown,
): authority is ConfiguredInternalLabAuthority {
  return typeof authority === "object"
    && authority !== null
    && configuredAuthorities.has(authority);
}
