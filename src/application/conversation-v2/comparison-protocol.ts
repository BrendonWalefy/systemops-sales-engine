import { z } from "zod";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";

export type ProtocolCase = Readonly<{ caseId: string; stratum: "stable_primary" | "d0_sensitivity"; critical: boolean }>;
export type ProtocolObservation = Readonly<{ run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; arm: "v1" | "v2"; stratum: "stable_primary" | "d0_sensitivity"; status: "observed" | "infrastructure_error" | "not_measurable"; payloadDigest: HmacRef; corpusDigest: HmacRef; d0Digest: HmacRef; populationDigest: HmacRef }>;
type ProtocolOrder = Readonly<{ run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; arm: "v1" | "v2" }>;
export type CycleIProtocol = Readonly<{ runs: 6; corpusDigest: HmacRef; d0Digest: HmacRef; populationDigest: HmacRef; cases: readonly ProtocolCase[]; order: readonly ProtocolOrder[] }>;

const hmac = z.string().regex(/^hmac:[a-f0-9]{64}$/, "invalid HmacRef");
const run = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{4}$/);
const manifestSchema = z.object({ version: z.literal("cycle-f-dental.v1"), population: z.literal("cycle-f-supported-dental-corpus"), cases: z.array(z.object({ caseId: id, requiredAxes: z.array(z.enum(["request", "dialogueMove", "entities.service"])).min(1), critical: z.boolean() }).strict()), exclusions: z.array(z.object({ requests: z.array(z.string().min(1)).min(1), reason: z.string().min(1) }).strict()).min(1) }).strict();
const d0Schema = z.object({ unstableAcrossRuns: z.array(id) }).passthrough();
const observationSchema = z.object({ run, caseId: id, arm: z.enum(["v1", "v2"]), stratum: z.enum(["stable_primary", "d0_sensitivity"]), status: z.enum(["observed", "infrastructure_error", "not_measurable"]), payloadDigest: hmac, corpusDigest: hmac, d0Digest: hmac, populationDigest: hmac }).strict();
function freeze<T>(value: T): T { if (Array.isArray(value)) value.forEach(freeze); else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze); return Object.freeze(value); }

export function createCycleIProtocol(input: { manifest: unknown; d0: unknown; corpusDigest: string; d0Digest: string; populationDigest: string; runs?: number }): CycleIProtocol {
  if (input.runs !== undefined && input.runs !== 6) throw new Error("Cycle I requires exactly N = 6 runs");
  const manifest = manifestSchema.parse(input.manifest);
  if (manifest.cases.length !== 17) throw new Error("Cycle I requires exactly 17 manifest cases");
  if (new Set(manifest.cases.map((item) => item.caseId)).size !== 17) throw new Error("duplicate manifest caseId");
  const unstable = new Set(d0Schema.parse(input.d0).unstableAcrossRuns);
  const cases = manifest.cases.map((item) => freeze({ caseId: item.caseId, critical: item.critical, stratum: unstable.has(item.caseId) ? "d0_sensitivity" as const : "stable_primary" as const }));
  const order: ProtocolOrder[] = [];
  for (const currentRun of [1, 2, 3, 4, 5, 6] as const) for (const item of cases) { order.push(freeze({ run: currentRun, caseId: item.caseId, arm: "v1" })); order.push(freeze({ run: currentRun, caseId: item.caseId, arm: "v2" })); }
  return freeze({ runs: 6 as const, corpusDigest: hmac.parse(input.corpusDigest) as HmacRef, d0Digest: hmac.parse(input.d0Digest) as HmacRef, populationDigest: hmac.parse(input.populationDigest) as HmacRef, cases, order });
}

export function validateProtocolObservations(protocol: CycleIProtocol, observations: readonly ProtocolObservation[]): void {
  const seen = new Set<string>();
  for (const item of observations) {
    const key = `${item.run}:${item.caseId}:${item.arm}`;
    if (seen.has(key)) throw new Error(`duplicate protocol observation: ${key}`);
    seen.add(key);
  }
  if (observations.length !== protocol.order.length) throw new Error("missing or extra protocol observation");
  const strata = new Map(protocol.cases.map((item) => [item.caseId, item.stratum]));
  for (let index = 0; index < protocol.order.length; index += 1) {
    const actual = observationSchema.parse(observations[index]); const expected = protocol.order[index]!;
    if (actual.run !== expected.run || actual.caseId !== expected.caseId || actual.arm !== expected.arm) throw new Error(`protocol order mismatch at ${index}`);
    if (actual.stratum !== strata.get(actual.caseId)) throw new Error(`protocol stratum mismatch: ${actual.caseId}`);
    if (actual.corpusDigest !== protocol.corpusDigest || actual.d0Digest !== protocol.d0Digest || actual.populationDigest !== protocol.populationDigest) throw new Error("protocol digest mismatch");
    if (actual.status === "infrastructure_error") throw new Error(`infrastructure error invalidates the paired protocol: ${actual.run}:${actual.caseId}:${actual.arm}`);
  }
}
