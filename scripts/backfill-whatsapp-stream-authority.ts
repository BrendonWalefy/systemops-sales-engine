import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { assertUuid } from "./validate-whatsapp-stream-authority";

export type AuthorityBatchOptions = Readonly<{
  clinicId: string;
  apply: boolean;
  batchSize: number;
  afterId: string | null;
}>;

type CandidateRow = {
  event_id: string;
  conversation_id: string | null;
  canonical_message_id: string | null;
  message_count: number | string;
  active_stream_id: string | null;
  active_stream_count: number | string;
};

export type AuthorityBackfillResult = Readonly<{
  mode: "dry-run" | "apply";
  selected: number;
  backfilled: number;
  conflicts: number;
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
  const candidates = await db.execute<CandidateRow>(sql`
    select
      event.id::text as event_id,
      (array_agg(distinct conversation.id order by conversation.id))[1]::text as conversation_id,
      (array_agg(distinct message.id order by message.id))[1]::text as canonical_message_id,
      count(distinct message.id)::bigint as message_count,
      (array_agg(distinct stream.id order by stream.id))[1]::text as active_stream_id,
      count(distinct stream.id)::bigint as active_stream_count
    from inbound_events event
    left join conversations conversation
      on conversation.organization_id = event.organization_id
    left join messages message
      on message.conversation_id = conversation.id
     and message.external_id = event.provider_message_id
     and message.author = 'lead'
    left join whatsapp_streams stream
      on stream.organization_id = event.organization_id
     and stream.conversation_id = conversation.id
     and stream.state = 'active'
    where event.organization_id = ${options.clinicId}::uuid
      and event.stream_id is null
      and event.stream_generation is null
      and event.processing_status <> 'identity_conflict'
      and (${options.afterId}::uuid is null or event.id > ${options.afterId}::uuid)
    group by event.id
    order by event.id
    limit ${options.batchSize}
  `);
  let backfilled = 0;
  let conflicts = 0;
  for (const candidate of candidates.rows) {
    const unambiguous = Number(candidate.message_count) === 1
      && Number(candidate.active_stream_count) === 1
      && candidate.conversation_id !== null
      && candidate.canonical_message_id !== null
      && candidate.active_stream_id !== null;
    if (!unambiguous) {
      conflicts += 1;
      if (options.apply) {
        await db.execute(sql`
          update inbound_events
          set processing_status = 'identity_conflict', registered_at = coalesce(registered_at, clock_timestamp())
          where id = ${candidate.event_id}::uuid
            and organization_id = ${options.clinicId}::uuid
            and stream_id is null and stream_generation is null
        `);
      }
      continue;
    }
    backfilled += 1;
    if (!options.apply) continue;
    await db.execute(sql`
      with assigned_generation as (
        update whatsapp_streams stream
        set current_generation = stream.current_generation + 1,
            latest_inbound_event_id = ${candidate.event_id}::uuid,
            updated_at = clock_timestamp()
        where stream.id = ${candidate.active_stream_id}::uuid
          and stream.organization_id = ${options.clinicId}::uuid
          and stream.state = 'active'
        returning stream.id, stream.current_generation
      ), updated_event as (
        update inbound_events event
        set stream_id = assigned.id,
            stream_generation = assigned.current_generation,
            registered_at = coalesce(event.registered_at, clock_timestamp())
        from assigned_generation assigned
        where event.id = ${candidate.event_id}::uuid
          and event.organization_id = ${options.clinicId}::uuid
          and event.stream_id is null and event.stream_generation is null
        returning event.id, event.stream_id, event.stream_generation
      )
      update messages message
      set inbound_event_id = event.id,
          stream_id = event.stream_id,
          stream_generation = event.stream_generation
      from updated_event event
      where message.id = ${candidate.canonical_message_id}::uuid
        and message.conversation_id = ${candidate.conversation_id}::uuid
        and message.inbound_event_id is null
    `);
  }
  return {
    mode: options.apply ? "apply" : "dry-run",
    selected: candidates.rows.length,
    backfilled,
    conflicts,
    nextAfterId: candidates.rows.at(-1)?.event_id ?? null,
  };
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
