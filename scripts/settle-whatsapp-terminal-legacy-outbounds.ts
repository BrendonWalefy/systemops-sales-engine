import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { assertUuid } from "./validate-whatsapp-stream-authority";

const LEGACY_AUTHORIZATION_VERSION = 1;

export type TerminalLegacyOutboundSettlementOptions = Readonly<{
  clinicId: string;
  actor: string;
  apply: boolean;
  batchSize: number;
  afterId: string | null;
  reviewedOutboundIds: readonly string[];
  reviewDigest: string | null;
}>;

export type TerminalLegacyOutboundSettlementResult = Readonly<{
  mode: "dry-run" | "apply";
  clinicId: string;
  actor: string;
  cutoff: string;
  selected: number;
  eligible: number;
  settled: number;
  ineligible: number;
  pendingOrProcessing: number;
  activeOrLockedJobs: number;
  crossTenantRows: number;
  categories: Readonly<{ reply: number; reminder: number }>;
  outboundIds: readonly string[];
  reviewDigest: string;
  nextAfterId: string | null;
}>;

type AuthorityRow = {
  version: number;
  activated_at: Date | string | null;
};

type CandidateRow = {
  outbound_id: string;
  organization_id: string;
  category: string;
  status: string;
  created_at: Date | string;
  sent_at: Date | string | null;
  authorization_kind: string | null;
  authorization_version: number | null;
  authorization_stream_id: string | null;
  authorization_generation: number | null;
  authorization_inbound_event_id: string | null;
  authorization_claim_job_id: string | null;
  authorization_claim_token_digest: string | null;
  pending_or_processing: boolean;
  active_or_locked_job: boolean;
  eligible: boolean;
};

export async function settleWhatsAppTerminalLegacyOutbounds(
  options: TerminalLegacyOutboundSettlementOptions,
): Promise<TerminalLegacyOutboundSettlementResult> {
  validateOptions(options);
  const cutoff = await readVersionTwoCutoff(options.clinicId);
  const reviewedCandidates = options.apply
    ? await readReviewedCandidates(options.reviewedOutboundIds, cutoff)
    : [];
  const crossTenantRows = reviewedCandidates.filter((candidate) => (
    candidate.organization_id !== options.clinicId
  )).length;
  if (crossTenantRows > 0) {
    throw new Error(`terminal legacy outbound review contains ${crossTenantRows} cross-tenant row(s)`);
  }
  if (options.apply && reviewedCandidates.length !== options.reviewedOutboundIds.length) {
    throw new Error("terminal legacy outbound review changed: reviewed row is missing");
  }
  const candidates = await readCandidateBatch(options, cutoff);
  const scopedCandidates = candidates.filter((candidate) => (
    candidate.organization_id === options.clinicId
  ));
  const eligible = scopedCandidates.filter((candidate) => candidate.eligible);
  const outboundIds = eligible.map((candidate) => candidate.outbound_id).sort();
  const cutoffText = cutoff.toISOString();
  const reviewDigest = digestReview({
    clinicId: options.clinicId,
    actor: options.actor,
    cutoff: cutoffText,
    outboundIds,
  });

  if (options.apply) {
    const reviewedIds = [...options.reviewedOutboundIds].sort();
    if (
      scopedCandidates.length !== reviewedIds.length
      || eligible.length !== reviewedIds.length
      || outboundIds.some((id, index) => id !== reviewedIds[index])
    ) {
      throw new Error(
        `terminal legacy outbound review changed: reviewed=${reviewedIds.length}, eligible=${eligible.length}`,
      );
    }
    if (options.reviewDigest !== reviewDigest) {
      throw new Error("terminal legacy outbound review digest mismatch");
    }
    const settled = await applyReviewedSettlement({
      clinicId: options.clinicId,
      cutoff,
      outboundIds,
      reviewDigest,
    });
    return buildResult({
      options,
      cutoff: cutoffText,
      candidates: scopedCandidates,
      eligible,
      outboundIds,
      reviewDigest,
      crossTenantRows,
      settled,
    });
  }

  return buildResult({
    options,
    cutoff: cutoffText,
    candidates: scopedCandidates,
    eligible,
    outboundIds,
    reviewDigest,
    crossTenantRows,
    settled: 0,
  });
}

async function readVersionTwoCutoff(clinicId: string): Promise<Date> {
  const result = await db.execute<AuthorityRow>(sql`
    select authority.version, authority.activated_at
    from conversation_authority authority
    where authority.organization_id = ${clinicId}::uuid
    limit 1
  `);
  const row = result.rows[0];
  if (!row || row.version !== 2 || row.activated_at === null) {
    throw new Error("terminal legacy outbound settlement requires authority version 2");
  }
  const cutoff = new Date(row.activated_at);
  if (!Number.isFinite(cutoff.getTime())) {
    throw new Error("terminal legacy outbound settlement found an invalid version-2 cutoff");
  }
  return cutoff;
}

async function readCandidateBatch(
  options: TerminalLegacyOutboundSettlementOptions,
  cutoff: Date,
): Promise<CandidateRow[]> {
  const result = await db.execute<CandidateRow>(sql`
    select
      outbound.id::text as outbound_id,
      outbound.organization_id::text as organization_id,
      outbound.category::text as category,
      outbound.status::text as status,
      outbound.created_at,
      outbound.sent_at,
      outbound.authorization_kind,
      outbound.authorization_version,
      outbound.authorization_stream_id,
      outbound.authorization_generation,
      outbound.authorization_inbound_event_id,
      outbound.authorization_claim_job_id,
      outbound.authorization_claim_token_digest,
      outbound.status in ('pending', 'processing') as pending_or_processing,
      exists (
        select 1 from jobs sender_job
        where sender_job.queue = 'message.send'
          and sender_job.payload->>'outboundMessageId' = outbound.id::text
          and (
            sender_job.status in ('pending', 'processing', 'failed')
            or sender_job.locked_at is not null
          )
      ) as active_or_locked_job,
      false as eligible
    from outbound_messages outbound
    where outbound.organization_id = ${options.clinicId}::uuid
      and outbound.authorization_kind is null
      and (${options.afterId}::uuid is null or outbound.id > ${options.afterId}::uuid)
    order by outbound.id
    limit ${options.batchSize}
  `);
  return evaluateEligibility(result.rows, cutoff);
}

async function readReviewedCandidates(
  reviewedOutboundIds: readonly string[],
  cutoff: Date,
): Promise<CandidateRow[]> {
  if (reviewedOutboundIds.length === 0) return [];
  const idsJson = JSON.stringify(reviewedOutboundIds);
  const result = await db.execute<CandidateRow>(sql`
    with reviewed as (
      select value::uuid as outbound_id
      from jsonb_array_elements_text(${idsJson}::jsonb)
    )
    select
      outbound.id::text as outbound_id,
      outbound.organization_id::text as organization_id,
      outbound.category::text as category,
      outbound.status::text as status,
      outbound.status in ('pending', 'processing') as pending_or_processing,
      exists (
        select 1 from jobs sender_job
        where sender_job.queue = 'message.send'
          and sender_job.payload->>'outboundMessageId' = outbound.id::text
          and (
            sender_job.status in ('pending', 'processing', 'failed')
            or sender_job.locked_at is not null
          )
      ) as active_or_locked_job,
      outbound.created_at,
      outbound.sent_at,
      outbound.authorization_kind,
      outbound.authorization_version,
      outbound.authorization_stream_id,
      outbound.authorization_generation,
      outbound.authorization_inbound_event_id,
      outbound.authorization_claim_job_id,
      outbound.authorization_claim_token_digest,
      false as eligible
    from reviewed
    join outbound_messages outbound on outbound.id = reviewed.outbound_id
    order by outbound.id
  `);
  return result.rows.map((row) => ({
    ...row,
    eligible: isEligibleRow(row, cutoff),
  }));
}

function evaluateEligibility(rows: readonly CandidateRow[], cutoff: Date): CandidateRow[] {
  return rows.map((row) => ({
    ...row,
    eligible: isEligibleRow(row, cutoff),
  }));
}

function isEligibleRow(row: CandidateRow, cutoff: Date): boolean {
  const createdAt = new Date(String(row.created_at));
  const sentAt = row.sent_at === null || row.sent_at === undefined
    ? null
    : new Date(String(row.sent_at));
  return row.status === "sent"
    && (row.category === "reply" || row.category === "reminder")
    && sentAt !== null
    && Number.isFinite(cutoff.getTime())
    && Number.isFinite(createdAt.getTime())
    && Number.isFinite(sentAt.getTime())
    && createdAt < cutoff
    && sentAt < cutoff
    && row.authorization_kind === null
    && row.authorization_version === null
    && row.authorization_stream_id === null
    && row.authorization_generation === null
    && row.authorization_inbound_event_id === null
    && row.authorization_claim_job_id === null
    && row.authorization_claim_token_digest === null
    && !row.active_or_locked_job;
}

async function applyReviewedSettlement(input: Readonly<{
  clinicId: string;
  cutoff: Date;
  outboundIds: readonly string[];
  reviewDigest: string;
}>): Promise<number> {
  if (input.outboundIds.length === 0) return 0;
  const idsJson = JSON.stringify(input.outboundIds);
  const result = await db.execute<{ outbound_id: string }>(sql`
    with reviewed as (
      select value::uuid as outbound_id
      from jsonb_array_elements_text(${idsJson}::jsonb)
    ), updated as (
      update outbound_messages outbound
      set
        authorization_kind = 'legacy',
        authorization_version = ${LEGACY_AUTHORIZATION_VERSION}
      from reviewed
      where outbound.id = reviewed.outbound_id
        and outbound.organization_id = ${input.clinicId}::uuid
        and outbound.status = 'sent'
        and outbound.category in ('reply', 'reminder')
        and outbound.sent_at is not null
        and outbound.created_at < ${input.cutoff}
        and outbound.sent_at < ${input.cutoff}
        and outbound.authorization_kind is null
        and outbound.authorization_version is null
        and outbound.authorization_stream_id is null
        and outbound.authorization_generation is null
        and outbound.authorization_inbound_event_id is null
        and outbound.authorization_claim_job_id is null
        and outbound.authorization_claim_token_digest is null
        and exists (
          select 1 from conversation_authority authority
          where authority.organization_id = outbound.organization_id
            and authority.version = 2
            and authority.activated_at = ${input.cutoff}
        )
        and not exists (
          select 1 from jobs sender_job
          where sender_job.queue = 'message.send'
            and sender_job.payload->>'outboundMessageId' = outbound.id::text
            and (
              sender_job.status in ('pending', 'processing', 'failed')
              or sender_job.locked_at is not null
            )
        )
      returning outbound.id::text as outbound_id
    )
    select updated.outbound_id from updated order by updated.outbound_id
  `);
  if (result.rows.length !== input.outboundIds.length) {
    throw new Error(
      `terminal legacy outbound settlement changed after review ${input.reviewDigest}: expected=${input.outboundIds.length}, settled=${result.rows.length}`,
    );
  }
  return result.rows.length;
}

function buildResult(input: Readonly<{
  options: TerminalLegacyOutboundSettlementOptions;
  cutoff: string;
  candidates: readonly CandidateRow[];
  eligible: readonly CandidateRow[];
  outboundIds: readonly string[];
  reviewDigest: string;
  crossTenantRows: number;
  settled: number;
}>): TerminalLegacyOutboundSettlementResult {
  return {
    mode: input.options.apply ? "apply" : "dry-run",
    clinicId: input.options.clinicId,
    actor: input.options.actor,
    cutoff: input.cutoff,
    selected: input.candidates.length,
    eligible: input.eligible.length,
    settled: input.settled,
    ineligible: input.candidates.length - input.eligible.length,
    pendingOrProcessing: input.candidates.filter((row) => row.pending_or_processing).length,
    activeOrLockedJobs: input.candidates.filter((row) => row.active_or_locked_job).length,
    crossTenantRows: input.crossTenantRows,
    categories: {
      reply: input.eligible.filter((row) => row.category === "reply").length,
      reminder: input.eligible.filter((row) => row.category === "reminder").length,
    },
    outboundIds: input.outboundIds,
    reviewDigest: input.reviewDigest,
    nextAfterId: input.options.apply
      ? null
      : input.candidates.at(-1)?.outbound_id ?? null,
  };
}

function digestReview(input: Readonly<{
  clinicId: string;
  actor: string;
  cutoff: string;
  outboundIds: readonly string[];
}>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function validateOptions(options: TerminalLegacyOutboundSettlementOptions): void {
  assertUuid(options.clinicId, "clinic id");
  if (!options.actor.trim()) throw new Error("--actor is required");
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 500) {
    throw new Error("--batch-size must be an integer between 1 and 500");
  }
  if (options.afterId) assertUuid(options.afterId, "after id");
  if (options.reviewedOutboundIds.length > 500) {
    throw new Error("reviewed outbound IDs cannot exceed 500");
  }
  for (const id of options.reviewedOutboundIds) assertUuid(id, "reviewed outbound id");
  if (new Set(options.reviewedOutboundIds).size !== options.reviewedOutboundIds.length) {
    throw new Error("reviewed outbound IDs must be unique");
  }
  if (options.apply && !options.reviewDigest) {
    throw new Error("--review-digest is required with --apply");
  }
}

function valueAfter(flag: string, argv: readonly string[]): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

export function parseTerminalLegacyOutboundSettlementOptions(
  argv: readonly string[],
): TerminalLegacyOutboundSettlementOptions {
  const reviewedIds = valueAfter("--reviewed-outbound-ids", argv);
  const rawBatch = valueAfter("--batch-size", argv);
  const options: TerminalLegacyOutboundSettlementOptions = {
    clinicId: valueAfter("--clinic-id", argv) ?? "",
    actor: valueAfter("--actor", argv) ?? "",
    apply: argv.includes("--apply"),
    batchSize: rawBatch === null ? 500 : Number(rawBatch),
    afterId: valueAfter("--after-id", argv),
    reviewedOutboundIds: reviewedIds ? reviewedIds.split(",").filter(Boolean) : [],
    reviewDigest: valueAfter("--review-digest", argv),
  };
  validateOptions(options);
  return options;
}

async function main(): Promise<void> {
  const result = await settleWhatsAppTerminalLegacyOutbounds(
    parseTerminalLegacyOutboundSettlementOptions(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "terminal legacy outbound settlement failed"}\n`);
    process.exitCode = 1;
  });
}
