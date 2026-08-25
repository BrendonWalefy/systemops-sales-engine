import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { assertUuid } from "./validate-whatsapp-stream-authority";
import {
  buildAuthorityBackfillEvidenceQuery,
  reconstructHistoricalAliases,
  type AuthorityEvidenceRow,
  type CandidateEventRow,
} from "./backfill-whatsapp-stream-authority";
import {
  readTerminalLegacyEligibility,
  readVersionOneAuthorityCutoff,
} from "./whatsapp-terminal-legacy-policy";

export type TerminalLegacySettlementOptions = Readonly<{
  clinicId: string;
  actor: string;
  apply: boolean;
  batchSize: number;
  afterId: string | null;
  reviewedEventIds: readonly string[];
  reviewDigest: string | null;
}>;

export type TerminalLegacySettlementResult = Readonly<{
  mode: "dry-run" | "apply";
  clinicId: string;
  actor: string;
  cutoff: string;
  scanned: number;
  selected: number;
  eligible: number;
  settled: number;
  ineligible: number;
  conflicts: number;
  eventIds: readonly string[];
  reviewDigest: string;
  nextAfterId: string | null;
}>;

export async function settleWhatsAppTerminalLegacyHistory(
  options: TerminalLegacySettlementOptions,
): Promise<TerminalLegacySettlementResult> {
  validateOptions(options);
  const cutoffValue = await readVersionOneAuthorityCutoff(options.clinicId);
  if (!cutoffValue) {
    throw new Error("terminal legacy settlement requires authority version 1");
  }
  const authority = { cutoff: cutoffValue };
  const candidates = options.apply
    ? await readReviewedCandidates(options.clinicId, options.reviewedEventIds)
    : await readCandidateBatch(options);
  const reviewed = candidates.map((candidate) => ({
    ...candidate,
    aliases: reconstructHistoricalAliases(candidate),
  }));
  const evidence = reviewed.length === 0
    ? []
    : await db.execute<AuthorityEvidenceRow>(buildAuthorityBackfillEvidenceQuery({
        clinicId: options.clinicId,
        candidates: reviewed.map((candidate) => ({
          eventId: candidate.event_id,
          providerMessageId: candidate.provider_message_id,
          aliases: candidate.aliases,
        })),
      })).then((result) => result.rows);
  const eligibility = evidence.length === 0
    ? new Map<string, boolean>()
    : await readTerminalLegacyEligibility({
        clinicId: options.clinicId,
        cutoff: authority.cutoff,
        eventIds: evidence
          .filter((row) => row.resolution === "unresolved")
          .map((row) => row.event_id),
      });
  const conflicts = evidence.filter((row) => row.resolution === "conflict").length;
  const unresolved = evidence.filter((row) => row.resolution === "unresolved");
  const eventIds = unresolved
    .filter((row) => eligibility.get(row.event_id) === true)
    .map((row) => row.event_id)
    .sort();
  const ineligible = unresolved.length - eventIds.length;
  const cutoff = authority.cutoff.toISOString();
  const reviewDigest = digestReview({
    clinicId: options.clinicId,
    actor: options.actor,
    cutoff,
    eventIds,
  });

  if (options.apply) {
    const reviewedIds = [...new Set(options.reviewedEventIds)].sort();
    if (conflicts > 0 || ineligible > 0 || eventIds.length !== reviewedIds.length
      || eventIds.some((id, index) => id !== reviewedIds[index])) {
      throw new Error(
        `terminal legacy settlement review changed: eligible=${eventIds.length}, ineligible=${ineligible}, conflicts=${conflicts}`,
      );
    }
    if (options.reviewDigest !== reviewDigest) {
      throw new Error("terminal legacy settlement review digest mismatch");
    }
    const settled = await applyReviewedSettlement({
      clinicId: options.clinicId,
      cutoff: authority.cutoff,
      reviewed,
      reviewDigest,
    });
    return buildResult({
      options,
      cutoff,
      candidates,
      eventIds,
      ineligible,
      conflicts,
      reviewDigest,
      settled,
    });
  }

  return buildResult({
    options,
    cutoff,
    candidates,
    eventIds,
    ineligible,
    conflicts,
    reviewDigest,
    settled: 0,
  });
}

type ReviewedCandidate = CandidateEventRow & Readonly<{
  aliases: ReturnType<typeof reconstructHistoricalAliases>;
}>;

async function readCandidateBatch(
  options: TerminalLegacySettlementOptions,
): Promise<CandidateEventRow[]> {
  const result = await db.execute<CandidateEventRow>(sql`
    select
      event.id::text as event_id,
      event.provider,
      event.provider_message_id,
      event.conversation_key,
      event.payload
    from inbound_events event
    where event.organization_id = ${options.clinicId}::uuid
      and event.stream_id is null
      and event.stream_generation is null
      and event.processing_status not in ('identity_conflict', 'history_only')
      and (${options.afterId}::uuid is null or event.id > ${options.afterId}::uuid)
    order by event.id
    limit ${options.batchSize}
  `);
  return result.rows;
}

async function readReviewedCandidates(
  clinicId: string,
  reviewedEventIds: readonly string[],
): Promise<CandidateEventRow[]> {
  if (reviewedEventIds.length === 0) return [];
  const idsJson = JSON.stringify(reviewedEventIds);
  const result = await db.execute<CandidateEventRow>(sql`
    with reviewed as (
      select value::uuid as event_id
      from jsonb_array_elements_text(${idsJson}::jsonb)
    )
    select
      event.id::text as event_id,
      event.provider,
      event.provider_message_id,
      event.conversation_key,
      event.payload
    from reviewed
    join inbound_events event on event.id = reviewed.event_id
    where event.organization_id = ${clinicId}::uuid
      and event.stream_id is null
      and event.stream_generation is null
      and event.processing_status not in ('identity_conflict', 'history_only')
    order by event.id
  `);
  return result.rows;
}

async function applyReviewedSettlement(input: Readonly<{
  clinicId: string;
  cutoff: Date;
  reviewed: readonly ReviewedCandidate[];
  reviewDigest: string;
}>): Promise<number> {
  if (input.reviewed.length === 0) return 0;
  const evidenceQuery = buildAuthorityBackfillEvidenceQuery({
    clinicId: input.clinicId,
    candidates: input.reviewed.map((candidate) => ({
      eventId: candidate.event_id,
      providerMessageId: candidate.provider_message_id,
      aliases: candidate.aliases,
    })),
  });
  const reviewedIdsJson = JSON.stringify(input.reviewed.map((candidate) => candidate.event_id));
  const result = await db.execute<{ event_id: string }>(sql`
    with reviewed_ids as (
      select value::uuid as event_id
      from jsonb_array_elements_text(${reviewedIdsJson}::jsonb)
    ),
    reviewed_evidence as (${evidenceQuery}),
    updated as (
      update inbound_events event
      set processing_status = 'history_only'
      from reviewed_ids reviewed
      join reviewed_evidence evidence
        on evidence.event_id::uuid = reviewed.event_id
       and evidence.resolution = 'unresolved'
      where event.id = reviewed.event_id
        and event.organization_id = ${input.clinicId}::uuid
        and event.processing_status in ('processed', 'ignored')
        and event.received_at < ${input.cutoff}
        and event.processed_at is not null
        and event.processed_at < ${input.cutoff}
        and event.stream_id is null
        and event.stream_generation is null
        and event.claim_token is null
        and event.claim_token_digest is null
        and event.claim_job_id is null
        and event.claimed_at is null
        and not exists (
          select 1 from jobs job where job.inbound_event_id = event.id
        )
        and not exists (
          select 1
          from outbound_messages outbound
          where outbound.organization_id = event.organization_id
            and (
              outbound.authorization_inbound_event_id = event.id
              or outbound.payload->>'turnId' = event.id::text
            )
            and outbound.status not in ('sent', 'cancelled')
        )
      returning event.id::text as event_id
    )
    select updated.event_id from updated order by updated.event_id
  `);
  if (result.rows.length !== input.reviewed.length) {
    throw new Error(
      `terminal legacy settlement changed after review ${input.reviewDigest}: expected=${input.reviewed.length}, settled=${result.rows.length}`,
    );
  }
  return result.rows.length;
}

function buildResult(input: Readonly<{
  options: TerminalLegacySettlementOptions;
  cutoff: string;
  candidates: readonly CandidateEventRow[];
  eventIds: readonly string[];
  ineligible: number;
  conflicts: number;
  reviewDigest: string;
  settled: number;
}>): TerminalLegacySettlementResult {
  return {
    mode: input.options.apply ? "apply" : "dry-run",
    clinicId: input.options.clinicId,
    actor: input.options.actor,
    cutoff: input.cutoff,
    scanned: input.candidates.length,
    selected: input.eventIds.length + input.ineligible,
    eligible: input.eventIds.length,
    settled: input.settled,
    ineligible: input.ineligible,
    conflicts: input.conflicts,
    eventIds: input.eventIds,
    reviewDigest: input.reviewDigest,
    nextAfterId: input.options.apply
      ? null
      : input.candidates.at(-1)?.event_id ?? null,
  };
}

function digestReview(input: Readonly<{
  clinicId: string;
  actor: string;
  cutoff: string;
  eventIds: readonly string[];
}>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function validateOptions(options: TerminalLegacySettlementOptions): void {
  assertUuid(options.clinicId, "clinic id");
  if (!options.actor.trim()) throw new Error("--actor is required");
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 500) {
    throw new Error("--batch-size must be an integer between 1 and 500");
  }
  if (options.afterId) assertUuid(options.afterId, "after id");
  if (options.reviewedEventIds.length > 500) {
    throw new Error("reviewed event IDs cannot exceed 500");
  }
  for (const id of options.reviewedEventIds) assertUuid(id, "reviewed event id");
  if (new Set(options.reviewedEventIds).size !== options.reviewedEventIds.length) {
    throw new Error("reviewed event IDs must be unique");
  }
  if (options.apply && !options.reviewDigest) {
    throw new Error("--review-digest is required with --apply");
  }
}

function valueAfter(flag: string, argv: readonly string[]): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

export function parseTerminalLegacySettlementOptions(
  argv: readonly string[],
): TerminalLegacySettlementOptions {
  const clinicId = valueAfter("--clinic-id", argv) ?? "";
  const actor = valueAfter("--actor", argv) ?? "";
  const rawBatch = valueAfter("--batch-size", argv);
  const reviewedIds = valueAfter("--reviewed-event-ids", argv);
  const options: TerminalLegacySettlementOptions = {
    clinicId,
    actor,
    apply: argv.includes("--apply"),
    batchSize: rawBatch === null ? 500 : Number(rawBatch),
    afterId: valueAfter("--after-id", argv),
    reviewedEventIds: reviewedIds
      ? reviewedIds.split(",").filter(Boolean)
      : [],
    reviewDigest: valueAfter("--review-digest", argv),
  };
  validateOptions(options);
  return options;
}

async function main(): Promise<void> {
  const result = await settleWhatsAppTerminalLegacyHistory(
    parseTerminalLegacySettlementOptions(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "terminal legacy settlement failed"}\n`);
    process.exitCode = 1;
  });
}
