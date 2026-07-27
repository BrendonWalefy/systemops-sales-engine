import { createHash } from "node:crypto";
import { stableSerialize } from "@/application/replay/fingerprint-replay-config";

export const RUNTIME_CONFIG_FINGERPRINT_SCHEMA = "runtime-config.v1" as const;

const SECRET_KEYS = new Set([
  "zapiToken",
  "zapiClientToken",
  "metaAccessToken",
  "metaAppSecret",
  "calendarSyncToken",
]);

const VOLATILE_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "billingStartedAt",
  "channelPairedAt",
]);

/**
 * Produz uma prova estável da configuração efetivamente carregada no turno.
 * O snapshot nunca é persistido: credenciais viram somente presença/ausência,
 * campos temporais sem efeito conversacional são removidos e apenas o SHA-256
 * do restante chega à Decision Trace.
 */
export function fingerprintRuntimeConfig(input: {
  clinic: Record<string, unknown>;
  editorial: unknown;
  modules: unknown;
}): { fingerprint: string; fieldCount: number } {
  const sanitized = sanitizeRuntimeConfig(input) as Record<string, unknown>;
  return {
    fingerprint: createHash("sha256").update(stableSerialize(sanitized)).digest("hex"),
    fieldCount: countLeafFields(sanitized),
  };
}

export function sanitizeRuntimeConfig(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeRuntimeConfig);
  if (typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (VOLATILE_KEYS.has(key)) continue;
    if (SECRET_KEYS.has(key)) {
      result[key] = item !== null && item !== undefined && String(item).trim().length > 0;
      continue;
    }
    result[key] = sanitizeRuntimeConfig(item);
  }
  return result;
}

function countLeafFields(value: unknown): number {
  if (value === null || typeof value !== "object") return 1;
  if (Array.isArray(value)) return value.reduce((total, item) => total + countLeafFields(item), 0);
  return Object.values(value).reduce((total, item) => total + countLeafFields(item), 0);
}
