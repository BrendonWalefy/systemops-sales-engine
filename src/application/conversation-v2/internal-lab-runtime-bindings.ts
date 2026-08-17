import { createHash } from "node:crypto";
import { sanitizeRuntimeConfig } from "@/application/config/runtime-config-fingerprint";
import { stableSerialize } from "@/application/replay/fingerprint-replay-config";

export const INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA =
  "conversation-v2.internal-lab-runtime-artifact.v1" as const;

export type InternalLabRuntimeArtifact = Readonly<{
  schemaVersion: typeof INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA;
  clinic: Record<string, unknown>;
  editorial: unknown;
  modules: readonly unknown[];
  treatments: readonly Record<string, unknown>[];
}>;

export type InternalLabRuntimeBindings = Readonly<{
  tenantDigest: string;
  channelDigest: string;
  configDigest: string;
}>;

export type InternalLabRuntimeBindingsReader = Readonly<{
  resolve(clinicId: string): Promise<InternalLabRuntimeBindings>;
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
 * Credential values are reduced to configured/not-configured by the shared
 * runtime sanitizer before any digest is computed.
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
