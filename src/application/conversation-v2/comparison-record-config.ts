import { isProxy } from "node:util/types";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";

export type CanonicalComparisonRecordConfig = Readonly<{
  hmacKey: string;
  commit: string;
  datasetDigest: HmacRef | null;
  allowedModelIds: readonly string[];
}>;

export function snapshotExactPlainRecord(
  input: unknown,
  expectedKeys: readonly string[],
  error: string,
): Readonly<Record<string, unknown>> {
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype
  ) throw new Error(error);
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) throw new Error(error);
  const snapshot: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error(error);
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

export function canonicalizeModelIdAllowlist(input: unknown): readonly string[] {
  if (
    typeof input !== "object"
    || input === null
    || isProxy(input)
    || !Array.isArray(input)
    || Object.getPrototypeOf(input) !== Array.prototype
  ) throw new Error("invalid comparison model allowlist");
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  const keys = Reflect.ownKeys(input);
  if (!lengthDescriptor || !("value" in lengthDescriptor)) {
    throw new Error("invalid comparison model allowlist");
  }
  const length = lengthDescriptor.value;
  if (
    !Number.isSafeInteger(length)
    || length < 0
    || keys.length !== length + 1
    || !keys.includes("length")
  ) throw new Error("invalid comparison model allowlist");
  const models: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid comparison model allowlist");
    }
    if (
      typeof descriptor.value !== "string"
      || descriptor.value.length === 0
      || descriptor.value.length > 128
      || models.includes(descriptor.value)
    ) throw new Error("invalid comparison model allowlist");
    models.push(descriptor.value);
  }
  return Object.freeze(models);
}

export function canonicalizeComparisonRecordConfig(
  input: unknown,
): CanonicalComparisonRecordConfig {
  const source = snapshotExactPlainRecord(
    input,
    ["hmacKey", "commit", "datasetDigest", "allowedModelIds"],
    "invalid comparison record config",
  );
  if (
    typeof source.hmacKey !== "string"
    || source.hmacKey.length < 32
    || source.hmacKey.length > 4_096
  ) throw new Error("invalid comparison record config HMAC key");
  if (
    typeof source.commit !== "string"
    || !/^[a-f0-9]{7,64}$/.test(source.commit)
  ) throw new Error("invalid comparison record config commit");
  if (
    source.datasetDigest !== null
    && (
      typeof source.datasetDigest !== "string"
      || !/^hmac:[a-f0-9]{64}$/.test(source.datasetDigest)
    )
  ) throw new Error("invalid comparison record config dataset digest");
  return Object.freeze({
    hmacKey: source.hmacKey,
    commit: source.commit,
    datasetDigest: source.datasetDigest as HmacRef | null,
    allowedModelIds: canonicalizeModelIdAllowlist(source.allowedModelIds),
  });
}
