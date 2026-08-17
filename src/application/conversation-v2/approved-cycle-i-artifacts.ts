import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseApprovedEvalRecord, pairApprovedEvalRecords, type ApprovedEvalRecord, type HmacRef } from "@/application/conversation-v2/comparison-record";
import { isRegisteredAuthorizedCycleIRunManifest, type AuthorizedCycleIRunManifest } from "@/application/conversation-v2/run-manifest-authority";
import { verifyReplayDatasetApproval } from "@/application/replay/replay-dataset-approval";
import type { ReplayDatasetV2 } from "@/application/replay/contracts";

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

export type ApprovedFullTurnEvidence = Readonly<z.infer<typeof fullTurnSchema>>;
const registeredFullTurnEvidence = new WeakSet<object>();
function freeze<T>(value: T): T { if (Array.isArray(value)) value.forEach(freeze); else if (value !== null && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze); return Object.freeze(value); }
function contentDigest(raw: string, domain: string): HmacRef { return `hmac:${createHmac("sha256", domain).update(raw).digest("hex")}`; }
function requireAuthority(authority: AuthorizedCycleIRunManifest): void { if (!isRegisteredAuthorizedCycleIRunManifest(authority)) throw new Error("Cycle I artifact requires a registered run authority"); }

export function digestCycleIProseManifestContent(raw: string): HmacRef { return contentDigest(raw, "cycle-i-approved-prose-content.v1"); }
export function loadAuthorizedCycleIProseRecords(input: Readonly<{ authority: AuthorizedCycleIRunManifest; expectedCaseIds: readonly string[] }>): readonly ApprovedEvalRecord[] {
  requireAuthority(input.authority);
  const approved = input.authority.proseManifest;
  if (approved === null) return freeze([]);
  const raw = readFileSync(approved.path, "utf8");
  if (digestCycleIProseManifestContent(raw) !== approved.digest) throw new Error("approved prose manifest content digest mismatch");
  const parsed = proseSchema.parse(JSON.parse(raw));
  if (parsed.corpusDigest !== input.authority.corpusDigest) throw new Error("approved prose corpus digest mismatch");
  const records = parsed.records.map(parseApprovedEvalRecord);
  const pairs = pairApprovedEvalRecords(records);
  const expected = input.expectedCaseIds.flatMap((caseId) => [1, 2, 3, 4, 5, 6].map((run) => `${run}:${caseId}`)).sort();
  const actual = pairs.map((pair) => `${pair.run}:${pair.caseId}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("approved prose pairs do not cover the exact comparable population");
  for (const record of records) {
    if (record.source.kind === "committed_corpus" && record.source.corpusDigest !== input.authority.corpusDigest) throw new Error("approved prose source corpus digest mismatch");
  }
  return freeze(records);
}

export function digestCycleIFullTurnEvidenceContent(raw: string): HmacRef { return contentDigest(raw, "cycle-i-full-turn-evidence-content.v1"); }
export function loadAuthorizedCycleIFullTurnEvidence(input: Readonly<{ authority: AuthorizedCycleIRunManifest; replayApprovalPublicKey: string | Buffer }>): ApprovedFullTurnEvidence | null {
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
  verifyReplayDatasetApproval(replayInput as ReplayDatasetV2, input.replayApprovalPublicKey);
  const evidence = freeze(parsed) as ApprovedFullTurnEvidence;
  registeredFullTurnEvidence.add(evidence);
  return evidence;
}

export function isRegisteredApprovedFullTurnEvidence(input: ApprovedFullTurnEvidence | null): input is ApprovedFullTurnEvidence { return input !== null && registeredFullTurnEvidence.has(input); }
