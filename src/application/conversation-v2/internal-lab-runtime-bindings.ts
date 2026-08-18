import { createHash } from "node:crypto";
import {
  RUNTIME_CONFIG_SECRET_KEYS,
  sanitizeRuntimeConfig,
} from "@/application/config/runtime-config-fingerprint";
import { stableSerialize } from "@/application/replay/fingerprint-replay-config";
import type { ChannelConfigSnapshot } from "@/application/ports/channel-config-snapshot";

export const INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA =
  "conversation-v2.internal-lab-runtime-artifact.v1" as const;

export type InternalLabRuntimeArtifact = Readonly<{
  schemaVersion: typeof INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA;
  clinic: Record<string, unknown>;
  editorial: unknown;
  modules: readonly unknown[];
  treatments: readonly Record<string, unknown>[];
  channelCredentialDigests?: Readonly<Record<string, string>>;
}>;

export type InternalLabRuntimeBindings = Readonly<{
  tenantDigest: string;
  channelDigest: string;
  configDigest: string;
}>;

export type InternalLabRuntimeBindingsReader = Readonly<{
  resolve(clinicId: string): Promise<InternalLabRuntimeBindings>;
  resolveDeliverySnapshot?(clinicId: string): Promise<Readonly<{
    bindings: InternalLabRuntimeBindings;
    channelConfig: ChannelConfigSnapshot;
  }>>;
}>;

const channelKeys = Object.freeze([
  "channelProvider",
  "zapiInstanceId",
  "zapiToken",
  "zapiClientToken",
  "metaPhoneNumberId",
  "metaAccessToken",
]);
const channelSecretKeys = new Set(["zapiToken", "zapiClientToken", "metaAccessToken"]);

function digest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA}\0${domain}\0`)
    .update(stableSerialize(value))
    .digest("hex")}`;
}

function sortedRecords(
  values: readonly Record<string, unknown>[],
  identity: (value: Record<string, unknown>) => string,
): readonly Record<string, unknown>[] {
  return Object.freeze([...values].sort((left, right) =>
    identity(left).localeCompare(identity(right))));
}

/**
 * Canonical evidence for the exact tenant facts consumed by the live runtime.
 * Credential values contribute only domain-separated one-way digests to the
 * channel binding; raw or reversible credential material never leaves here.
 */
export function computeInternalLabRuntimeBindings(
  input: InternalLabRuntimeArtifact,
): InternalLabRuntimeBindings {
  if (input.schemaVersion !== INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA) {
    throw new Error("invalid Internal Lab runtime artifact schema");
  }
  const clinic = sanitizeRuntimeConfig(input.clinic) as Record<string, unknown>;
  const channel = Object.fromEntries(channelKeys.map((key) => {
    const raw = input.clinic[key];
    if (!channelSecretKeys.has(key)) return [key, clinic[key] ?? null];
    const protectedDigest = input.channelCredentialDigests?.[key];
    if (protectedDigest !== undefined) {
      if (!/^sha256:[a-f0-9]{64}$/.test(protectedDigest) || raw !== true) {
        throw new Error("invalid protected Internal Lab channel credential binding");
      }
      return [key, protectedDigest];
    }
    if (typeof raw !== "string" || raw.length === 0) return [key, null];
    return [key, digest(`channel-credential:${key}`, raw)];
  }));
  const modules = sortedRecords(
    input.modules.map((item) => sanitizeRuntimeConfig(item) as Record<string, unknown>),
    (item) => String(item.key ?? item.moduleKey ?? ""),
  );
  const treatments = sortedRecords(
    input.treatments.map((item) => sanitizeRuntimeConfig(item) as Record<string, unknown>),
    (item) => String(item.id ?? ""),
  );
  const editorial = sanitizeRuntimeConfig(input.editorial);

  return Object.freeze({
    tenantDigest: digest("tenant", clinic),
    channelDigest: digest("channel", channel),
    configDigest: digest("config", {
      clinic,
      editorial,
      modules,
      treatments,
    }),
  });
}

/**
 * Converte o artifact resolvido em um arquivo operacional sem credenciais. A
 * presença continua participando de tenant/config digests, enquanto o channel
 * binding conserva exatamente o digest domain-separated calculado do valor em
 * memória. O signer aceita esse formato; os bytes da credencial não saem daqui.
 */
export function protectInternalLabRuntimeArtifactForFile(
  input: InternalLabRuntimeArtifact,
): InternalLabRuntimeArtifact {
  const clinic = { ...input.clinic };
  const channelCredentialDigests: Record<string, string> = {};
  for (const key of RUNTIME_CONFIG_SECRET_KEYS) {
    if (!Object.hasOwn(input.clinic, key)) continue;
    const raw = input.clinic[key];
    const present = raw !== null && raw !== undefined && String(raw).trim().length > 0;
    clinic[key] = present ? true : null;
    if (channelSecretKeys.has(key) && present) {
      const protectedDigest = input.channelCredentialDigests?.[key];
      if (raw === true && protectedDigest) {
        channelCredentialDigests[key] = protectedDigest;
      } else if (typeof raw === "string") {
        channelCredentialDigests[key] = digest(`channel-credential:${key}`, raw);
      }
    }
  }
  return Object.freeze({
    ...input,
    clinic: Object.freeze(clinic),
    channelCredentialDigests: Object.freeze(channelCredentialDigests),
  });
}

export function assertInternalLabRuntimeArtifactBindings(
  expected: InternalLabRuntimeBindings,
  artifact: InternalLabRuntimeArtifact,
): void {
  const actual = computeInternalLabRuntimeBindings(artifact);
  for (const key of ["tenantDigest", "channelDigest", "configDigest"] as const) {
    if (expected[key] !== actual[key]) {
      throw new Error(`Internal Lab resolved artifact ${key} mismatch`);
    }
  }
}
