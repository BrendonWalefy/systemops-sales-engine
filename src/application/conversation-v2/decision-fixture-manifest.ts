import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseCapturedV2TurnReads, type CapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";
import { isRegisteredAuthorizedCycleIRunManifest, type AuthorizedCycleIRunManifest } from "@/application/conversation-v2/run-manifest-authority";
import { DENTAL_OUTCOME_SCHEMA, type DentalOutcomeType } from "@/domain-packs/dental";

export const CYCLE_I_DECISION_FIXTURE_MANIFEST_VERSION = "conversation-v2-decision-fixtures.v2" as const;
export type CycleIDecisionFixture = Readonly<{
  caseId: string; snapshotDigest: HmacRef; reads: CapturedV2TurnReads;
  executionReceipt: Readonly<{
    caseId: string; snapshotDigest: HmacRef;
    effect: Readonly<{ action: "book_slot" | "confirm_appointment"; payloadHash: string }>;
    outcomeType: DentalOutcomeType; sourceEvidenceDigest: HmacRef; receiptDigest: HmacRef;
  }> | null;
}>;
export type AuthorizedCycleIDecisionFixtureManifest = Readonly<{
  version: typeof CYCLE_I_DECISION_FIXTURE_MANIFEST_VERSION; populationDigest: HmacRef;
  population: readonly Readonly<{ caseId: string; applicability: "applicable" | "not_applicable"; reason: string | null }>[];
  fixtures: readonly CycleIDecisionFixture[];
}>;

const hmac = z.string().regex(/^hmac:[a-f0-9]{64}$/), sha = z.string().regex(/^[a-f0-9]{64}$/);
const caseId = z.string().regex(/^[a-z][a-z0-9-]*-\d{4}$/);
const outcomeTypes = Object.keys(DENTAL_OUTCOME_SCHEMA) as [DentalOutcomeType, ...DentalOutcomeType[]];
const receiptSchema = z.object({ caseId, snapshotDigest: hmac,
  effect: z.object({ action: z.enum(["book_slot", "confirm_appointment"]), payloadHash: sha }).strict(),
  outcomeType: z.enum(outcomeTypes), sourceEvidenceDigest: hmac, receiptDigest: hmac }).strict();
const fixtureSchema = z.object({ caseId, snapshotDigest: hmac, reads: z.unknown(), executionReceipt: receiptSchema.nullable() }).strict();
const manifestSchema = z.object({
  version: z.literal(CYCLE_I_DECISION_FIXTURE_MANIFEST_VERSION), populationDigest: hmac,
  population: z.array(z.object({ caseId, applicability: z.enum(["applicable", "not_applicable"]), reason: z.string().min(1).nullable() }).strict()).length(17),
  fixtures: z.array(fixtureSchema),
}).strict();

function canonicalJson(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonicalJson); if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonicalJson(nested)])); return value; }
function freeze<T>(value: T): T { if (Array.isArray(value)) value.forEach(freeze); else if (value !== null && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze); return Object.freeze(value); }
function digest(value: unknown, domain: string): HmacRef { return `hmac:${createHmac("sha256", domain).update(typeof value === "string" ? value : JSON.stringify(canonicalJson(value))).digest("hex")}`; }
export function digestCycleIDecisionSnapshot(reads: CapturedV2TurnReads): HmacRef { return digest(reads, "cycle-i-decision-snapshot.v1"); }
export function digestCycleIDecisionReceipt(input: Readonly<{ caseId: string; snapshotDigest: HmacRef; effect: Readonly<{ action: "book_slot" | "confirm_appointment"; payloadHash: string }>; outcomeType: DentalOutcomeType; sourceEvidenceDigest: HmacRef }>): HmacRef { return digest(input, "cycle-i-decision-receipt.v2"); }
export function digestCycleIDecisionManifestContent(raw: string): HmacRef { return digest(raw, "cycle-i-decision-manifest-content.v2"); }

export function loadAuthorizedCycleIDecisionFixtureManifest(input: Readonly<{ path: string; authority: AuthorizedCycleIRunManifest; expectedCaseIds: readonly string[] }>): AuthorizedCycleIDecisionFixtureManifest {
  if (!isRegisteredAuthorizedCycleIRunManifest(input.authority)) throw new Error("Decision fixtures require a registered Cycle I authority");
  const approved = input.authority.decisionManifest;
  if (approved === null || approved.path !== input.path) throw new Error("Decision fixture manifest is absent from the authorized run manifest");
  const raw = readFileSync(input.path, "utf8");
  if (digestCycleIDecisionManifestContent(raw) !== approved.digest) throw new Error("Decision fixture manifest content digest mismatch");
  const parsed = manifestSchema.parse(JSON.parse(raw));
  if (parsed.populationDigest !== input.authority.populationDigest || parsed.populationDigest !== approved.populationDigest) throw new Error("Decision fixture population digest mismatch");
  const expected = [...input.expectedCaseIds].sort(), declared = parsed.population.map((entry) => entry.caseId).sort();
  if (new Set(declared).size !== 17 || JSON.stringify(declared) !== JSON.stringify(expected)) throw new Error("Decision fixture applicability must predeclare the exact frozen population");
  for (const entry of parsed.population) if ((entry.applicability === "applicable") !== (entry.reason === null)) throw new Error(`invalid Decision applicability declaration: ${entry.caseId}`);
  const applicable = new Set(parsed.population.filter((entry) => entry.applicability === "applicable").map((entry) => entry.caseId));
  const fixtureIds = parsed.fixtures.map((entry) => entry.caseId);
  if (new Set(fixtureIds).size !== fixtureIds.length || JSON.stringify([...fixtureIds].sort()) !== JSON.stringify([...applicable].sort())) throw new Error("Decision fixtures must exactly cover the predeclared applicable population");
  const fixtures = parsed.fixtures.map((fixture) => {
    const reads = parseCapturedV2TurnReads(fixture.reads);
    if (digestCycleIDecisionSnapshot(reads) !== fixture.snapshotDigest) throw new Error(`Cycle I decision fixture snapshot digest mismatch: ${fixture.caseId}`);
    const receipt = fixture.executionReceipt;
    if (receipt !== null) {
      const material = { caseId: receipt.caseId, snapshotDigest: receipt.snapshotDigest, effect: receipt.effect, outcomeType: receipt.outcomeType, sourceEvidenceDigest: receipt.sourceEvidenceDigest };
      if (receipt.caseId !== fixture.caseId || receipt.snapshotDigest !== fixture.snapshotDigest || digestCycleIDecisionReceipt(material as Parameters<typeof digestCycleIDecisionReceipt>[0]) !== receipt.receiptDigest) throw new Error(`Cycle I decision receipt binding mismatch: ${fixture.caseId}`);
    }
    return freeze({ caseId: fixture.caseId, snapshotDigest: fixture.snapshotDigest as HmacRef, reads, executionReceipt: receipt as CycleIDecisionFixture["executionReceipt"] });
  });
  return freeze({ version: parsed.version, populationDigest: parsed.populationDigest as HmacRef, population: parsed.population, fixtures });
}
