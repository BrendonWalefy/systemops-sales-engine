import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { assertUuid } from "./validate-whatsapp-stream-authority";
import { buildWhatsAppStreamAliases } from "@/core/whatsapp/WhatsAppContactIdentity";
import { parseMetaInboundTextMessage } from "@/infrastructure/adapters/channels/whatsapp/meta-webhook-content";
import type {
  InboundEventProvider,
  StreamAliasInput,
} from "@/application/ports/inbound-event-store";
import {
  readTerminalLegacyEligibility,
  readVersionOneAuthorityCutoff,
} from "./whatsapp-terminal-legacy-policy";

export type AuthorityBatchOptions = Readonly<{
  clinicId: string;
  apply: boolean;
  batchSize: number;
  afterId: string | null;
}>;

export type CandidateEventRow = {
  event_id: string;
  provider: InboundEventProvider;
  provider_message_id: string;
  conversation_key: string;
  payload: unknown;
};

export type AuthorityEvidenceRow = {
  event_id: string;
  resolution: "backfillable" | "unresolved" | "conflict";
  resolved_stream_id: string | null;
  canonical_message_id: string | null;
};

type ReviewedCandidate = CandidateEventRow & Readonly<{
  aliases: readonly StreamAliasInput[];
}>;

export type AuthorityEvidenceInputCandidate = Readonly<{
  eventId: string;
  providerMessageId: string;
  aliases: readonly StreamAliasInput[];
}>;

export type AuthorityBackfillResult = Readonly<{
  mode: "dry-run" | "apply";
  selected: number;
  backfillable: number;
  backfilled: number;
  terminalLegacyEligible: number;
  unresolved: number;
  conflicts: number;
  backfillableEventIds: readonly string[];
  terminalLegacyEventIds: readonly string[];
  nextAfterId: string | null;
}>;

export function parseAuthorityBatchOptions(argv: readonly string[]): AuthorityBatchOptions {
  const clinicId = requiredValue("--clinic-id", argv);
  assertUuid(clinicId, "clinic id");
  const rawBatch = optionalValue("--batch-size", argv);
  const batchSize = rawBatch === null ? 500 : Number(rawBatch);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("--batch-size must be an integer between 1 and 500");
  }
  const afterId = optionalValue("--after-id", argv);
  if (afterId) assertUuid(afterId, "after id");
  return { clinicId, apply: argv.includes("--apply"), batchSize, afterId };
}

export async function backfillWhatsAppStreamAuthority(
  options: AuthorityBatchOptions,
): Promise<AuthorityBackfillResult> {
  const candidates = await readCandidateEvents(options);
  const reviewed = candidates.map((candidate) => ({
    ...candidate,
    aliases: reconstructHistoricalAliases(candidate),
  }));
  const evidence = reviewed.length === 0
    ? []
    : await readAuthorityEvidence(options.clinicId, reviewed);

  const byEventId = new Map(evidence.map((row) => [row.event_id, row]));
  const decisions = reviewed.map((candidate) => {
    const decision = byEventId.get(candidate.event_id);
    if (!decision) {
      throw new Error(`authority backfill omitted candidate ${candidate.event_id}`);
    }
    return { candidate, decision };
  });
  const unresolvedDecisions = decisions.filter(
    ({ decision }) => decision.resolution === "unresolved",
  );
  const versionOneCutoff = unresolvedDecisions.length > 0
    ? await readVersionOneAuthorityCutoff(options.clinicId)
    : null;
  const terminalEligibility = versionOneCutoff
    ? await readTerminalLegacyEligibility({
        clinicId: options.clinicId,
        cutoff: versionOneCutoff,
        eventIds: unresolvedDecisions.map(({ candidate }) => candidate.event_id),
      })
    : new Map<string, boolean>();
  const terminalLegacy = unresolvedDecisions.filter(
    ({ candidate }) => terminalEligibility.get(candidate.event_id) === true,
  );
  const unresolved = unresolvedDecisions.length - terminalLegacy.length;
  const conflicts = decisions.filter(({ decision }) => decision.resolution === "conflict").length;
  const backfillable = decisions.filter(({ decision }) => decision.resolution === "backfillable");
  const backfillableEventIds = backfillable.map(({ candidate }) => candidate.event_id).sort();
  const terminalLegacyEventIds = terminalLegacy.map(({ candidate }) => candidate.event_id).sort();

  if (options.apply && (unresolved > 0 || conflicts > 0)) {
    throw new Error(
      `authority backfill apply requires a fully resolved batch: unresolved=${unresolved}, conflicts=${conflicts}`,
    );
  }
  if (options.apply) {
    for (const { candidate, decision } of backfillable) {
      if (!decision.resolved_stream_id) {
        throw new Error(`authority backfill returned no winner for ${candidate.event_id}`);
      }
      await applyReviewedCandidate(options.clinicId, candidate, decision.resolved_stream_id);
    }
  }

  return {
    mode: options.apply ? "apply" : "dry-run",
    selected: candidates.length,
    backfillable: backfillable.length,
    backfilled: backfillable.length,
    terminalLegacyEligible: terminalLegacy.length,
    unresolved,
    conflicts,
    backfillableEventIds,
    terminalLegacyEventIds,
    nextAfterId: candidates.at(-1)?.event_id ?? null,
  };
}

async function readCandidateEvents(options: AuthorityBatchOptions): Promise<CandidateEventRow[]> {
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

async function readAuthorityEvidence(
  clinicId: string,
  candidates: readonly ReviewedCandidate[],
): Promise<AuthorityEvidenceRow[]> {
  const result = await db.execute<AuthorityEvidenceRow>(
    buildAuthorityBackfillEvidenceQuery({
      clinicId,
      candidates: candidates.map((candidate) => ({
        eventId: candidate.event_id,
        providerMessageId: candidate.provider_message_id,
        aliases: candidate.aliases,
      })),
    }),
  );
  return result.rows;
}

export function buildAuthorityBackfillEvidenceQuery(input: Readonly<{
  clinicId: string;
  candidates: readonly AuthorityEvidenceInputCandidate[];
}>): SQL {
  const inputJson = serializeEvidenceInput(input.candidates);
  return sql`
    with ${authorityEvidenceCtes(input.clinicId, inputJson)}
    select
      decision.event_id::text,
      decision.resolution,
      decision.resolved_stream_id::text,
      decision.canonical_message_id::text
    from authority_decision decision
    order by decision.event_id
  `;
}

async function applyReviewedCandidate(
  clinicId: string,
  candidate: ReviewedCandidate,
  reviewedStreamId: string,
): Promise<void> {
  const inputJson = serializeEvidenceInput([{
    eventId: candidate.event_id,
    providerMessageId: candidate.provider_message_id,
    aliases: candidate.aliases,
  }]);
  const result = await db.execute<{ event_id: string }>(sql`
    with ${authorityEvidenceCtes(clinicId, inputJson)},
    reviewed_decision as (
      select decision.*
      from authority_decision decision
      join inbound_events event
        on event.id = ${candidate.event_id}::uuid
       and event.id = decision.event_id
       and event.organization_id = ${clinicId}::uuid
       and event.provider_message_id = ${candidate.provider_message_id}
       and event.stream_id is null
       and event.stream_generation is null
       and event.processing_status not in ('identity_conflict', 'history_only')
      where decision.event_id = ${candidate.event_id}::uuid
        and decision.resolution = 'backfillable'
        and decision.resolved_stream_id = ${reviewedStreamId}::uuid
    ),
    assigned_generation as (
      update whatsapp_streams stream
      set current_generation = stream.current_generation + 1,
          latest_inbound_event_id = decision.event_id,
          updated_at = clock_timestamp()
      from reviewed_decision decision
      where stream.id = decision.resolved_stream_id
        and stream.organization_id = ${clinicId}::uuid
        and stream.state = 'active'
        and stream.current_generation < 9007199254740991
      returning stream.id, stream.current_generation
    ),
    updated_event as (
      update inbound_events event
      set stream_id = assigned.id,
          stream_generation = assigned.current_generation,
          registered_at = coalesce(event.registered_at, clock_timestamp())
      from assigned_generation assigned, reviewed_decision decision
      where event.id = decision.event_id
        and event.organization_id = ${clinicId}::uuid
        and event.stream_id is null
        and event.stream_generation is null
      returning event.id, event.stream_id, event.stream_generation
    ),
    updated_message as (
      update messages message
      set inbound_event_id = event.id,
          stream_id = event.stream_id,
          stream_generation = event.stream_generation
      from updated_event event, reviewed_decision decision
      where decision.canonical_message_id is not null
        and message.id = decision.canonical_message_id
        and message.inbound_event_id is null
      returning message.id
    )
    select
      event.id::text as event_id,
      1 / case
        when decision.canonical_message_id is null then 1
        when (select count(*) from updated_message) = 1 then 1
        else 0
      end as message_invariant
    from updated_event event
    join reviewed_decision decision on decision.event_id = event.id
  `);
  if (result.rows.length !== 1) {
    throw new Error(`authority backfill candidate changed after review: ${candidate.event_id}`);
  }
}

function authorityEvidenceCtes(clinicId: string, inputJson: string): SQL {
  return sql`
    input_events as (
      select input.event_id::uuid as event_id, input.provider_message_id, input.aliases
      from jsonb_to_recordset(${inputJson}::jsonb) as input(
        event_id text,
        provider_message_id text,
        aliases jsonb
      )
    ),
    target_events as (
      select
        input.event_id as id,
        ${clinicId}::uuid as organization_id,
        input.provider_message_id
      from input_events input
    ),
    input_aliases as (
      select
        input.event_id,
        alias.kind::whatsapp_stream_alias_kind as kind,
        alias.provider_scope,
        alias.normalized_value
      from input_events input
      cross join lateral jsonb_to_recordset(input.aliases) as alias(
        kind text,
        provider_scope text,
        normalized_value text
      )
    ),
    canonical_messages as (
      select
        event.id as event_id,
        message.id as message_id,
        conversation.id as conversation_id
      from target_events event
      join messages message
        on message.external_id = event.provider_message_id
       and message.author = 'lead'
      join conversations conversation
        on conversation.id = message.conversation_id
       and conversation.organization_id = event.organization_id
    ),
    canonical_summary as (
      select
        canonical.event_id,
        count(distinct canonical.message_id)::integer as message_count,
        min(canonical.message_id::text)::uuid as canonical_message_id,
        coalesce(
          array_agg(distinct stream.id) filter (where stream.id is not null),
          array[]::uuid[]
        ) as stream_ids
      from canonical_messages canonical
      left join whatsapp_streams stream
        on stream.organization_id = ${clinicId}::uuid
       and stream.conversation_id = canonical.conversation_id
       and stream.state = 'active'
      group by canonical.event_id
    ),
    alias_matches as (
      select
        input.event_id,
        matched.stream_id
      from input_aliases input
      cross join lateral (
        select stream.id as stream_id
        from whatsapp_stream_aliases alias
        join whatsapp_streams stream
          on stream.id = alias.stream_id
         and stream.organization_id = alias.organization_id
         and stream.state = 'active'
        where alias.organization_id = ${clinicId}::uuid
          and alias.kind = input.kind
          and alias.provider_scope = input.provider_scope
          and alias.normalized_value = input.normalized_value
          and alias.retired_at is null
        limit 2
      ) matched
    ),
    alias_summary as (
      select
        matched.event_id,
        array_agg(distinct matched.stream_id) as stream_ids
      from alias_matches matched
      group by matched.event_id
    ),
    evidence as (
      select
        event.id as event_id,
        coalesce(canonical.message_count, 0) as canonical_message_count,
        canonical.canonical_message_id,
        coalesce(canonical.stream_ids, array[]::uuid[]) as canonical_stream_ids,
        coalesce(alias.stream_ids, array[]::uuid[]) as alias_stream_ids
      from target_events event
      left join canonical_summary canonical on canonical.event_id = event.id
      left join alias_summary alias on alias.event_id = event.id
    ),
    authority_decision as (
      select
        evidence.event_id,
        evidence.canonical_message_id,
        case
          when evidence.canonical_message_count = 0
            and cardinality(evidence.alias_stream_ids) = 0
            then 'unresolved'::text
          when evidence.canonical_message_count = 0
            and cardinality(evidence.alias_stream_ids) = 1
            then 'backfillable'::text
          when evidence.canonical_message_count = 1
            and cardinality(evidence.canonical_stream_ids) = 0
            and cardinality(evidence.alias_stream_ids) = 0
            then 'unresolved'::text
          when evidence.canonical_message_count = 1
            and cardinality(evidence.canonical_stream_ids) = 1
            and (
              cardinality(evidence.alias_stream_ids) = 0
              or (
                cardinality(evidence.alias_stream_ids) = 1
                and evidence.alias_stream_ids[1] = evidence.canonical_stream_ids[1]
              )
            )
            then 'backfillable'::text
          else 'conflict'::text
        end as resolution,
        case
          when evidence.canonical_message_count = 0
            and cardinality(evidence.alias_stream_ids) = 1
            then evidence.alias_stream_ids[1]
          when evidence.canonical_message_count = 1
            and cardinality(evidence.canonical_stream_ids) = 1
            and (
              cardinality(evidence.alias_stream_ids) = 0
              or (
                cardinality(evidence.alias_stream_ids) = 1
                and evidence.alias_stream_ids[1] = evidence.canonical_stream_ids[1]
              )
            )
            then evidence.canonical_stream_ids[1]
          else null::uuid
        end as resolved_stream_id
      from evidence
    )
  `;
}

function serializeEvidenceInput(candidates: readonly AuthorityEvidenceInputCandidate[]): string {
  return JSON.stringify(candidates.map((candidate) => ({
    event_id: candidate.eventId,
    provider_message_id: candidate.providerMessageId,
    aliases: candidate.aliases.map((alias) => ({
      kind: alias.kind,
      provider_scope: alias.providerScope,
      normalized_value: alias.normalizedValue,
    })),
  })));
}

export function reconstructHistoricalAliases(candidate: CandidateEventRow): readonly StreamAliasInput[] {
  if (candidate.provider === "meta_cloud_api") {
    const message = parseMetaInboundTextMessage(candidate.payload);
    if (!message || message.messageId !== candidate.provider_message_id) return [];
    return buildWhatsAppStreamAliases({
      provider: "meta_cloud_api",
      providerInstanceId: message.phoneNumberId,
      providerThreadId: message.phone,
      phone: message.phone,
    });
  }

  const payload = asObject(candidate.payload);
  const instanceId = nonEmptyString(payload?.instanceId);
  if (!instanceId) return [];
  return buildWhatsAppStreamAliases({
    provider: "z_api",
    providerInstanceId: instanceId,
    providerThreadId: candidate.conversation_key,
    phone: nonEmptyString(payload?.phone),
    whatsappLid: nonEmptyString(payload?.chatLid),
  });
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requiredValue(flag: string, argv: readonly string[]): string {
  const value = optionalValue(flag, argv);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function optionalValue(flag: string, argv: readonly string[]): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const result = await backfillWhatsAppStreamAuthority(parseAuthorityBatchOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "authority backfill failed"}\n`);
    process.exitCode = 1;
  });
}
