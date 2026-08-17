import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseApprovedEvalRecord, pairApprovedEvalRecords, type ApprovedEvalRecord, type HmacRef } from "@/application/conversation-v2/comparison-record";
import {
  CYCLE_I_GATE_ARTIFACT_KINDS,
  isRegisteredAuthorizedCycleIRunManifest,
  type AuthorizedCycleIRunManifest,
  type CycleIGateArtifactKind,
} from "@/application/conversation-v2/run-manifest-authority";
import type { ReplayDatasetV2 } from "@/application/replay/contracts";
import { verifyConfiguredCycleIReplayDatasetAuthority } from "@/application/conversation-v2/configured-cycle-i-authority";

const hmac = z.string().regex(/^hmac:[a-f0-9]{64}$/);
const proseSchema = z.object({
  version: z.literal("conversation-v2-approved-prose-pairs.v1"),
  corpusDigest: hmac,
  records: z.array(z.unknown()).length(180),
}).strict();
const fullTurnSchema = z.object({
  version: z.literal("conversation-v2-full-turn-evidence.v1"),
  replayDatasetPath: z.string().min(1), replayDatasetDigest: hmac,
  lab: z.object({ kind: z.literal("systemops_lab"), isolated: z.literal(true), automationEnabled: z.literal(false), evidenceDigest: hmac }).strict(),
  sampleCount: z.number().int().positive(), v1MeanMinor: z.number().int().min(0), v2MeanMinor: z.number().int().min(0),
  v1P95Ms: z.number().int().min(0), v2P95Ms: z.number().int().min(0), evidenceDigest: hmac,
}).strict();
const gateArtifactSchema = z.object({
  version: z.literal("conversation-v2-gate-evidence.v1"),
  kind: z.enum(CYCLE_I_GATE_ARTIFACT_KINDS),
  runConfigDigest: hmac,
  populationDigest: hmac,
  datasetDigest: hmac,
  configDigest: hmac,
  result: z.union([
    z.object({ passed: z.boolean() }).strict(),
    z.object({ sideEffects: z.number().int().min(0), contamination: z.number().int().min(0) }).strict(),
  ]),
}).strict();

export type ApprovedFullTurnEvidence = Readonly<z.infer<typeof fullTurnSchema>>;
const registeredFullTurnEvidence = new WeakMap<object, AuthorizedCycleIRunManifest>();
export type AuthorizedCycleIGateArtifact = Readonly<z.infer<typeof gateArtifactSchema>>
  & Readonly<{ evidenceDigest: HmacRef }>;
export type AuthorizedCycleIGateArtifacts = Readonly<
  Record<CycleIGateArtifactKind, AuthorizedCycleIGateArtifact | null>
>;
const registeredGateArtifacts = new WeakMap<object, AuthorizedCycleIRunManifest>();
function freeze<T>(value: T): T { if (Array.isArray(value)) value.forEach(freeze); else if (value !== null && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze); return Object.freeze(value); }
function contentDigest(raw: string, domain: string): HmacRef { return `hmac:${createHmac("sha256", domain).update(raw).digest("hex")}`; }
function requireAuthority(authority: AuthorizedCycleIRunManifest): void { if (!isRegisteredAuthorizedCycleIRunManifest(authority)) throw new Error("Cycle I artifact requires a registered run authority"); }

export function digestCycleIProseManifestContent(raw: string): HmacRef { return contentDigest(raw, "cycle-i-approved-prose-content.v1"); }
export function loadAuthorizedCycleIProseRecords(input: Readonly<{ authority: AuthorizedCycleIRunManifest; expectedInputDigests: Readonly<Record<string, HmacRef>> }>): readonly ApprovedEvalRecord[] {
  requireAuthority(input.authority);
  const approved = input.authority.proseManifest;
  if (approved === null) return freeze([]);
  const raw = readFileSync(approved.path, "utf8");
  if (digestCycleIProseManifestContent(raw) !== approved.digest) throw new Error("approved prose manifest content digest mismatch");
  const parsed = proseSchema.parse(JSON.parse(raw));
  if (parsed.corpusDigest !== input.authority.corpusDigest) throw new Error("approved prose corpus digest mismatch");
  const records = parsed.records.map(parseApprovedEvalRecord);
  const pairs = pairApprovedEvalRecords(records);
  const expectedCaseIds = Object.keys(input.expectedInputDigests);
  const expected = expectedCaseIds.flatMap((caseId) => [1, 2, 3, 4, 5, 6].map((run) => `${run}:${caseId}`)).sort();
  const actual = pairs.map((pair) => `${pair.run}:${pair.caseId}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("approved prose pairs do not cover the exact comparable population");
  for (const record of records) {
    if (record.snapshotDigest !== input.expectedInputDigests[record.caseId]) {
      throw new Error(`approved prose snapshot does not match run input: ${record.caseId}`);
    }
    if (record.source.kind === "committed_corpus" && record.source.corpusDigest !== input.authority.corpusDigest) throw new Error("approved prose source corpus digest mismatch");
  }
  return freeze(records);
}

export function digestCycleIGateArtifactContent(raw: string): HmacRef {
  return contentDigest(raw, "cycle-i-gate-evidence-content.v1");
}

export function loadAuthorizedCycleIGateArtifacts(
  authority: AuthorizedCycleIRunManifest,
): AuthorizedCycleIGateArtifacts {
  requireAuthority(authority);
  const output = {} as Record<CycleIGateArtifactKind, AuthorizedCycleIGateArtifact | null>;
  for (const kind of CYCLE_I_GATE_ARTIFACT_KINDS) {
    const approved = authority.evidence[kind];
    if (approved === null) {
      output[kind] = null;
      continue;
    }
    const raw = readFileSync(approved.path, "utf8");
    if (digestCycleIGateArtifactContent(raw) !== approved.digest) {
      throw new Error(`Cycle I ${kind} evidence content digest mismatch`);
    }
    const artifact = gateArtifactSchema.parse(JSON.parse(raw));
    if (
      artifact.kind !== kind
      || artifact.runConfigDigest !== authority.configDigest
      || artifact.populationDigest !== authority.populationDigest
      || artifact.datasetDigest !== authority.corpusDigest
      || artifact.configDigest !== authority.configDigest
    ) throw new Error(`Cycle I ${kind} evidence is not bound to the authorized run manifest`);
    if (kind === "shadow_no_effects") {
      if (!("sideEffects" in artifact.result)) throw new Error("shadow evidence has the wrong result contract");
    } else if (!("passed" in artifact.result)) {
      throw new Error(`${kind} evidence has the wrong result contract`);
    }
    output[kind] = freeze({ ...artifact, evidenceDigest: approved.digest });
  }
  const artifacts = freeze(output) as AuthorizedCycleIGateArtifacts;
  registeredGateArtifacts.set(artifacts, authority);
  return artifacts;
}

export function isRegisteredAuthorizedCycleIGateArtifacts(
  input: AuthorizedCycleIGateArtifacts,
  authority: AuthorizedCycleIRunManifest,
): boolean {
  return registeredGateArtifacts.get(input) === authority;
}

export function digestCycleIFullTurnEvidenceContent(raw: string): HmacRef { return contentDigest(raw, "cycle-i-full-turn-evidence-content.v1"); }
export function loadAuthorizedCycleIFullTurnEvidence(input: Readonly<{ authority: AuthorizedCycleIRunManifest }>): ApprovedFullTurnEvidence | null {
  requireAuthority(input.authority);
  const approved = input.authority.fullTurnEvidence;
  if (approved === null) return null;
  const raw = readFileSync(approved.path, "utf8");
  if (digestCycleIFullTurnEvidenceContent(raw) !== approved.digest) throw new Error("full-turn evidence content digest mismatch");
  const parsed = fullTurnSchema.parse(JSON.parse(raw));
  const replayRaw = readFileSync(parsed.replayDatasetPath, "utf8");
  if (contentDigest(replayRaw, "cycle-i-replay-dataset-content.v1") !== parsed.replayDatasetDigest) throw new Error("full-turn replay dataset digest mismatch");
  const replayInput: unknown = JSON.parse(replayRaw);
  if (typeof replayInput !== "object" || replayInput === null || Array.isArray(replayInput)) throw new Error("full-turn replay dataset is invalid");
  verifyConfiguredCycleIReplayDatasetAuthority(
    replayInput as ReplayDatasetV2,
    approved.replayApprovalKeyId,
  );
  const evidence = freeze(parsed) as ApprovedFullTurnEvidence;
  registeredFullTurnEvidence.set(evidence, input.authority);
  return evidence;
}

export function isRegisteredApprovedFullTurnEvidence(input: ApprovedFullTurnEvidence | null, authority: AuthorizedCycleIRunManifest): input is ApprovedFullTurnEvidence { return input !== null && registeredFullTurnEvidence.get(input) === authority; }
