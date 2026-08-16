import { z } from "zod";

export type ProtocolCase = Readonly<{ caseId: string; stratum: "stable_primary" | "d0_sensitivity"; critical: boolean }>;
export type ProtocolObservation = Readonly<{ run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; arm: "v1" | "v2"; status: "observed" | "infrastructure_error"; payloadDigest: string }>;
type ProtocolOrder = Readonly<{ run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; arm: "v1" | "v2" }>;

const digest = z.string().regex(/^hmac:[a-f0-9]{64}$/);
const manifestSchema = z.object({ version: z.literal("cycle-f-dental.v1"), population: z.literal("cycle-f-supported-dental-corpus"), cases: z.array(z.object({ caseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{4}$/), requiredAxes: z.array(z.enum(["request", "dialogueMove", "entities.service"])).min(1), critical: z.boolean() }).strict()), exclusions: z.array(z.object({ requests: z.array(z.string().min(1)).min(1), reason: z.string().min(1) }).strict()).min(1) }).strict();
const d0Schema = z.object({ unstableAcrossRuns: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{4}$/)) }).passthrough();
const observationSchema = z.object({ run: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), caseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{4}$/), arm: z.enum(["v1", "v2"]), status: z.enum(["observed", "infrastructure_error"]), payloadDigest: digest }).strict();
function freeze<T>(value: T): T { if (Array.isArray(value)) value.forEach(freeze); else if (value !== null && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze); return Object.freeze(value); }

export function createCycleIProtocol(input: { manifest: unknown; d0: unknown; corpusDigest: string; runs?: number }): Readonly<{ runs: 6; cases: readonly ProtocolCase[]; order: readonly ProtocolOrder[] }> {
  if (input.runs !== undefined && input.runs !== 6) throw new Error("Cycle I requires exactly N = 6 runs");
  digest.parse(input.corpusDigest);
  const manifest = manifestSchema.parse(input.manifest);
  if (manifest.cases.length !== 17) throw new Error("Cycle I requires exactly 17 manifest cases");
  const ids = new Set(manifest.cases.map(({ caseId }) => caseId));
  if (ids.size !== 17) throw new Error("duplicate manifest caseId");
  const unstable = new Set(d0Schema.parse(input.d0).unstableAcrossRuns);
  const cases = manifest.cases.map((item) => freeze({ caseId: item.caseId, critical: item.critical, stratum: unstable.has(item.caseId) ? "d0_sensitivity" as const : "stable_primary" as const }));
  const order: ProtocolOrder[] = [];
  for (const run of [1, 2, 3, 4, 5, 6] as const) for (const item of cases) { order.push(freeze({ run, caseId: item.caseId, arm: "v1" })); order.push(freeze({ run, caseId: item.caseId, arm: "v2" })); }
  return freeze({ runs: 6 as const, cases, order });
}

export function validateProtocolObservations(protocol: ReturnType<typeof createCycleIProtocol>, observations: readonly ProtocolObservation[]): void {
  const expected = new Set(protocol.order.map((item) => `${item.run}:${item.caseId}:${item.arm}`));
  const seen = new Set<string>();
  for (const input of observations) {
    const item = observationSchema.parse(input);
    const key = `${item.run}:${item.caseId}:${item.arm}`;
    if (!expected.has(key)) throw new Error(`observation is outside frozen protocol: ${key}`);
    if (seen.has(key)) throw new Error(`duplicate protocol observation: ${key}`);
    if (item.status === "infrastructure_error") throw new Error(`infrastructure error invalidates the paired protocol: ${key}`);
    seen.add(key);
  }
  for (const expectedKey of expected) if (!seen.has(expectedKey)) throw new Error(`missing protocol observation: ${expectedKey}`);
}
