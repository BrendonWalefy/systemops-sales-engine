import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  parseCapturedV2TurnReads,
  type CapturedV2TurnReads,
} from "@/application/conversation-v2/captured-turn-reads";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalOutcomeType,
} from "@/domain-packs/dental";

export const CYCLE_I_DECISION_FIXTURE_MANIFEST_VERSION =
  "conversation-v2-decision-fixtures.v1" as const;

export type CycleIDecisionFixture = Readonly<{
  caseId: string;
  snapshotDigest: HmacRef;
  reads: CapturedV2TurnReads;
  executionReceipt: Readonly<{
    outcomeType: DentalOutcomeType;
    evidenceDigest: HmacRef;
  }> | null;
  approval: Readonly<{
    source: "committed_fixture" | "signed_replay";
    digest: HmacRef;
  }>;
}>;

const hmac = z.string().regex(/^hmac:[a-f0-9]{64}$/);
const caseId = z.string().regex(/^[a-z][a-z0-9-]*-\d{4}$/);
const outcomeTypes = Object.keys(DENTAL_OUTCOME_SCHEMA) as [
  DentalOutcomeType,
  ...DentalOutcomeType[],
];
const fixtureSchema = z.object({
  caseId,
  snapshotDigest: hmac,
  reads: z.unknown(),
  executionReceipt: z.object({
    outcomeType: z.enum(outcomeTypes),
    evidenceDigest: hmac,
  }).strict().nullable(),
  approval: z.object({
    source: z.enum(["committed_fixture", "signed_replay"]),
    digest: hmac,
  }).strict(),
}).strict();
const manifestSchema = z.object({
  version: z.literal(CYCLE_I_DECISION_FIXTURE_MANIFEST_VERSION),
  fixtures: z.array(fixtureSchema),
}).strict();

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function freeze<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return Object.freeze(value);
}

export function digestCycleIDecisionSnapshot(reads: CapturedV2TurnReads): HmacRef {
  const canonical = JSON.stringify(canonicalJson(reads));
  return `hmac:${createHmac("sha256", "cycle-i-decision-snapshot.v1")
    .update(canonical)
    .digest("hex")}`;
}

export function loadCycleIDecisionFixtureManifest(
  path: string,
): readonly CycleIDecisionFixture[] {
  const parsed = manifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const seen = new Set<string>();
  const fixtures = parsed.fixtures.map((input) => {
    if (seen.has(input.caseId)) {
      throw new Error(`duplicate Cycle I decision fixture: ${input.caseId}`);
    }
    seen.add(input.caseId);
    const reads = parseCapturedV2TurnReads(input.reads);
    const digest = digestCycleIDecisionSnapshot(reads);
    if (digest !== input.snapshotDigest) {
      throw new Error(`Cycle I decision fixture snapshot digest mismatch: ${input.caseId}`);
    }
    return freeze({
      caseId: input.caseId,
      snapshotDigest: input.snapshotDigest as HmacRef,
      reads,
      executionReceipt: input.executionReceipt === null
        ? null
        : {
            outcomeType: input.executionReceipt.outcomeType,
            evidenceDigest: input.executionReceipt.evidenceDigest as HmacRef,
          },
      approval: {
        source: input.approval.source,
        digest: input.approval.digest as HmacRef,
      },
    });
  });
  return freeze(fixtures);
}
