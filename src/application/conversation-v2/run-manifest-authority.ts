import { createHmac } from "node:crypto";
import { isProxy } from "node:util/types";
import { z } from "zod";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";
import {
  CYCLE_I_RUN_MANIFEST_AUTHORITY_DOMAIN,
  verifyConfiguredCycleIRunManifestAuthority,
  type Ed25519SignatureRef,
} from "@/application/conversation-v2/configured-cycle-i-authority";

export { CYCLE_I_RUN_MANIFEST_AUTHORITY_DOMAIN };
export const CYCLE_I_RUN_MANIFEST_VERSION =
  "conversation-v2-cycle-i-run-manifest.v3" as const;
export const CYCLE_I_GATE_ARTIFACT_KINDS = [
  "h_entailment", "shadow_no_effects", "cycle_f_axes", "rollback",
  "observability", "verification", "adversarial_review",
] as const;
export type CycleIGateArtifactKind = typeof CYCLE_I_GATE_ARTIFACT_KINDS[number];
export type CycleIArtifactRef = Readonly<{ path: string; digest: HmacRef }>;

export type CycleIRunManifestSnapshot = Readonly<{
  version: typeof CYCLE_I_RUN_MANIFEST_VERSION;
  implementationCommit: string;
  implementationTreeDigest: HmacRef;
  implementationSourceDigest: HmacRef;
  corpusRoot: string;
  manifestPath: string;
  d0Path: string;
  comparabilityPath: string;
  comparabilityDigest: HmacRef;
  tenantConfigDigest: HmacRef;
  corpusDigest: HmacRef;
  populationDigest: HmacRef;
  d0Digest: HmacRef;
  runs: 6;
  v1: Readonly<{ modelId: string; adapterId: "intent-classifier.v1"; promptDigest: HmacRef }>;
  v2: Readonly<{ modelId: string; adapterId: "dental-understanding-provider.v1"; promptDigest: HmacRef }>;
  decisionManifest: Readonly<{ path: string; digest: HmacRef; populationDigest: HmacRef }> | null;
  proseManifest: Readonly<{ path: string; digest: HmacRef }> | null;
  fullTurnEvidence: Readonly<{ path: string; digest: HmacRef; replayApprovalKeyId: string }> | null;
  configDigest: HmacRef;
  manifestDigest: HmacRef;
  judge: "experimental_non_gating";
  evidence: Readonly<Record<CycleIGateArtifactKind, CycleIArtifactRef | null>>;
  authoritySignature: Ed25519SignatureRef | null;
}>;
export type AuthorizedCycleIRunManifest = CycleIRunManifestSnapshot & Readonly<{
  authoritySignature: Ed25519SignatureRef;
}>;

const hmac = z.string().regex(/^hmac:[a-f0-9]{64}$/);
const signature = z.string().regex(/^ed25519:[a-f0-9]{128}$/);
const model = (adapterId: "intent-classifier.v1" | "dental-understanding-provider.v1") => z.object({
  modelId: z.string().min(1).max(128), adapterId: z.literal(adapterId), promptDigest: hmac,
}).strict();
const schema = z.object({
  version: z.literal(CYCLE_I_RUN_MANIFEST_VERSION),
  implementationCommit: z.string().regex(/^[a-f0-9]{7,64}$/),
  implementationTreeDigest: hmac,
  implementationSourceDigest: hmac,
  corpusRoot: z.string().min(1), manifestPath: z.string().min(1),
  d0Path: z.string().min(1), comparabilityPath: z.string().min(1),
  comparabilityDigest: hmac, tenantConfigDigest: hmac,
  corpusDigest: hmac, populationDigest: hmac, d0Digest: hmac, runs: z.literal(6),
  v1: model("intent-classifier.v1"),
  v2: model("dental-understanding-provider.v1"),
  decisionManifest: z.object({ path: z.string().min(1), digest: hmac, populationDigest: hmac }).strict().nullable(),
  proseManifest: z.object({ path: z.string().min(1), digest: hmac }).strict().nullable(),
  fullTurnEvidence: z.object({ path: z.string().min(1), digest: hmac, replayApprovalKeyId: z.string().regex(/^[a-f0-9]{24}$/) }).strict().nullable(),
  configDigest: hmac, manifestDigest: hmac,
  judge: z.literal("experimental_non_gating"),
  evidence: z.object({
    h_entailment: z.object({ path: z.string().min(1), digest: hmac }).strict().nullable(),
    shadow_no_effects: z.object({ path: z.string().min(1), digest: hmac }).strict().nullable(),
    cycle_f_axes: z.object({ path: z.string().min(1), digest: hmac }).strict().nullable(),
    rollback: z.object({ path: z.string().min(1), digest: hmac }).strict().nullable(),
    observability: z.object({ path: z.string().min(1), digest: hmac }).strict().nullable(),
    verification: z.object({ path: z.string().min(1), digest: hmac }).strict().nullable(),
    adversarial_review: z.object({ path: z.string().min(1), digest: hmac }).strict().nullable(),
  }).strict(),
  authoritySignature: signature.nullable(),
}).strict();
const registered = new WeakSet<object>();

function freeze<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return Object.freeze(value);
}

function snapshotPlainData(input: unknown, seen = new WeakSet<object>()): unknown {
  if (input === null || typeof input !== "object") return input;
  if (isProxy(input) || seen.has(input)) throw new Error("run manifest must be unaliased plain data");
  seen.add(input);
  const array = Array.isArray(input);
  if (Object.getPrototypeOf(input) !== (array ? Array.prototype : Object.prototype)) {
    throw new Error("run manifest must be plain data");
  }
  if (array) return input.map((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("run manifest must not contain accessors");
    }
    return snapshotPlainData(descriptor.value, seen);
  });
  const output: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string") throw new Error("run manifest must use string keys");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("run manifest must not contain accessors");
    }
    output[key] = snapshotPlainData(descriptor.value, seen);
  }
  return output;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]),
  );
  return value;
}

function digest(value: unknown, domain: string): HmacRef {
  return `hmac:${createHmac("sha256", domain)
    .update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function configMaterial(input: Record<string, unknown>): unknown {
  return Object.fromEntries(Object.entries(input).filter(([key]) =>
    !["configDigest", "manifestDigest", "authoritySignature", "evidence"].includes(key)));
}

export function digestCycleIRunConfig(input: unknown): HmacRef {
  const snapshot = snapshotPlainData(input) as Record<string, unknown>;
  return digest(configMaterial(snapshot), "cycle-i-run-config.v3");
}

export function digestCycleIRunManifest(input: unknown): HmacRef {
  const snapshot = snapshotPlainData(input) as Record<string, unknown>;
  const material = Object.fromEntries(Object.entries(snapshot).filter(
    ([key]) => key !== "manifestDigest" && key !== "authoritySignature",
  ));
  return digest(material, "cycle-i-run-manifest.v3");
}

export function serializeCycleIRunManifestAuthorityPayload(input: unknown): string {
  const snapshot = snapshotPlainData(input) as Record<string, unknown>;
  return JSON.stringify(canonical(Object.fromEntries(Object.entries(snapshot).filter(
    ([key]) => key !== "authoritySignature",
  ))));
}

export function parseCycleIRunManifestSnapshot(input: unknown): CycleIRunManifestSnapshot {
  const snapshot = snapshotPlainData(input);
  const parsed = schema.parse(snapshot);
  if (digestCycleIRunConfig(parsed) !== parsed.configDigest) {
    throw new Error("Cycle I run manifest config digest mismatch");
  }
  if (digestCycleIRunManifest(parsed) !== parsed.manifestDigest) {
    throw new Error("Cycle I run manifest digest mismatch");
  }
  return freeze(parsed) as CycleIRunManifestSnapshot;
}

export function parseAuthorizedCycleIRunManifest(input: unknown): AuthorizedCycleIRunManifest {
  const parsed = parseCycleIRunManifestSnapshot(input);
  if (parsed.authoritySignature === null) {
    throw new Error("Cycle I run manifest is unsigned");
  }
  if (!verifyConfiguredCycleIRunManifestAuthority(
    serializeCycleIRunManifestAuthorityPayload(parsed),
    parsed.authoritySignature as Ed25519SignatureRef,
  )) throw new Error("Cycle I run manifest authority signature is invalid");
  const manifest = parsed as AuthorizedCycleIRunManifest;
  registered.add(manifest);
  return manifest;
}

export function isRegisteredAuthorizedCycleIRunManifest(
  input: AuthorizedCycleIRunManifest | null,
): input is AuthorizedCycleIRunManifest {
  return typeof input === "object" && input !== null && registered.has(input);
}
