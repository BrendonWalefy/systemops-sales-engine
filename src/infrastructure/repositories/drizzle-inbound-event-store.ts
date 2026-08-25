import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import type {
  InboundEvent,
  InboundEventStore,
  InboundRegistrationResult,
  RegisterInboundAuthorityInput,
} from "@/application/ports/inbound-event-store";
import { DEFAULT_MESSAGE_DEBOUNCE_MS } from "@/core/pipeline/message-debounce";
import {
  neonHttpAtomicDatabaseBatch,
  type AtomicDatabaseBatch,
  type AtomicDatabaseBatchStep,
} from "@/infrastructure/db/atomic-database-batch";
import { db } from "@/infrastructure/db/client";
import { inboundEvents } from "@/infrastructure/db/schema";

type RegistrationRow = {
  outcome: "registered" | "identity_conflict" | "history_only";
  inbound_event_id: string;
  stream_id: string | null;
  stream_generation: number | string | null;
  job_id: string | null;
  job_run_at: Date | string | null;
  event_was_new: boolean;
  job_was_new: boolean;
};

export class DrizzleInboundEventStore implements InboundEventStore {
  constructor(
    private readonly atomicBatch: AtomicDatabaseBatch = neonHttpAtomicDatabaseBatch,
  ) {}

  async recordInboundEventAndEnqueue(
    input: RegisterInboundAuthorityInput,
  ): Promise<InboundRegistrationResult> {
    if (input.aliases.length === 0) {
      throw new Error("at least one normalized stream alias is required");
    }

    const inboundEventId = randomUUID();
    const candidateStreamId = randomUUID();
    const jobId = randomUUID();
    const aliasesJson = JSON.stringify(input.aliases.map((alias) => ({
      kind: alias.kind,
      provider_scope: alias.providerScope,
      normalized_value: alias.normalizedValue,
    })));
    const payloadJson = JSON.stringify(input.payload);

    const eventByProviderIdentity = sql`
      event.organization_id = ${input.clinicId}::uuid
      and event.provider = ${input.provider}::whatsapp_provider
      and event.provider_message_id = ${input.providerMessageId}
    `;
    const aliasInput = sql`
      select distinct
        item.kind::whatsapp_stream_alias_kind as kind,
        item.provider_scope,
        item.normalized_value
      from jsonb_to_recordset(${aliasesJson}::jsonb) as item(
        kind text,
        provider_scope text,
        normalized_value text
      )
      order by kind, provider_scope, normalized_value
    `;

    const steps = [
      {
        name: "register_ledger_event",
        statement: sql`
          insert into inbound_events (
            id, organization_id, provider, provider_message_id,
            conversation_key, payload, normalized_text, media_type,
            dedupe_key, received_at
          ) values (
            ${inboundEventId}::uuid,
            ${input.clinicId}::uuid,
            ${input.provider},
            ${input.providerMessageId},
            ${input.conversationKey},
            ${payloadJson}::jsonb,
            ${input.normalizedText},
            ${input.mediaType},
            ${input.dedupeKey},
            ${input.receivedAt}
          )
          on conflict (organization_id, provider, provider_message_id) do update
            set provider_message_id = excluded.provider_message_id
          returning id
        `,
      },
      {
        name: "create_provisional_candidate",
        statement: sql`
          insert into whatsapp_streams (id, organization_id, state)
          select ${candidateStreamId}::uuid, event.organization_id, 'provisional'
          from inbound_events event
          where ${eventByProviderIdentity}
            and event.stream_id is null
            and event.processing_status not in ('identity_conflict', 'history_only')
          on conflict (id) do nothing
          returning id
        `,
      },
      {
        name: "converge_aliases",
        statement: sql`
          insert into whatsapp_stream_aliases (
            organization_id, kind, provider_scope, normalized_value, stream_id
          )
          select
            event.organization_id,
            input.kind,
            input.provider_scope,
            input.normalized_value,
            candidate.id
          from inbound_events event
          join whatsapp_streams candidate
            on candidate.id = ${candidateStreamId}::uuid
           and candidate.organization_id = event.organization_id
           and candidate.state = 'provisional'
          cross join lateral (${aliasInput}) input
          where ${eventByProviderIdentity}
            and event.stream_id is null
            and event.processing_status not in ('identity_conflict', 'history_only')
          on conflict (organization_id, kind, provider_scope, normalized_value)
            where retired_at is null
          do update set normalized_value = excluded.normalized_value
          returning stream_id
        `,
      },
      {
        name: "lock_active_authorities",
        statement: sql`
          with input_aliases as (${aliasInput})
          select stream.id
          from input_aliases input
          join whatsapp_stream_aliases alias
            on alias.organization_id = ${input.clinicId}::uuid
           and alias.kind = input.kind
           and alias.provider_scope = input.provider_scope
           and alias.normalized_value = input.normalized_value
           and alias.retired_at is null
          join whatsapp_streams stream
            on stream.id = alias.stream_id
           and stream.organization_id = alias.organization_id
           and stream.state = 'active'
          order by stream.id
          for update of stream
        `,
      },
      {
        name: "resolve_alias_authority",
        statement: sql`
          with input_aliases as (${aliasInput}),
          active_winners as (
            select distinct stream.id
            from input_aliases input
            join whatsapp_stream_aliases alias
              on alias.organization_id = ${input.clinicId}::uuid
             and alias.kind = input.kind
             and alias.provider_scope = input.provider_scope
             and alias.normalized_value = input.normalized_value
             and alias.retired_at is null
            join whatsapp_streams stream
              on stream.id = alias.stream_id
             and stream.organization_id = alias.organization_id
             and stream.state = 'active'
          ),
          decision as (
            select
              count(*)::integer as active_count,
              min(id::text)::uuid as active_stream_id
            from active_winners
          ),
          event_decision as (
            update inbound_events event
            set processing_status = 'identity_conflict'
            from decision
            where ${eventByProviderIdentity}
              and event.stream_id is null
              and event.processing_status not in ('identity_conflict', 'history_only')
              and decision.active_count > 1
            returning event.id
          ),
          alias_decision as (
            update whatsapp_stream_aliases alias
            set
              stream_id = case
                when decision.active_count = 1 then decision.active_stream_id
                else alias.stream_id
              end,
              retired_at = case
                when decision.active_count > 1 then clock_timestamp()
                else null
              end
            from decision
            where alias.stream_id = ${candidateStreamId}::uuid
              and alias.organization_id = ${input.clinicId}::uuid
              and alias.retired_at is null
              and decision.active_count > 0
            returning alias.id
          ),
          candidate_decision as (
            update whatsapp_streams candidate
            set
              state = case
                when decision.active_count = 0 then 'active'::whatsapp_stream_state
                else 'retired'::whatsapp_stream_state
              end,
              retired_at = case
                when decision.active_count = 0 then null
                else clock_timestamp()
              end,
              retirement_reason = case
                when decision.active_count = 0 then null
                else 'alias_convergence'::whatsapp_stream_retirement_reason
              end,
              updated_at = clock_timestamp()
            from decision
            where candidate.id = ${candidateStreamId}::uuid
              and candidate.organization_id = ${input.clinicId}::uuid
              and candidate.state = 'provisional'
            returning candidate.id
          )
          select
            (select count(*) from event_decision) as conflicted_events,
            (select count(*) from alias_decision) as resolved_aliases,
            (select count(*) from candidate_decision) as resolved_candidates
        `,
      },
      {
        name: "assign_generation",
        statement: sql`
          with input_aliases as (${aliasInput}),
          target_event as (
            select event.id, event.organization_id, event.received_at
            from inbound_events event
            where ${eventByProviderIdentity}
              and event.stream_id is null
              and event.processing_status not in ('identity_conflict', 'history_only')
          ),
          active_authority as (
            select min(stream.id::text)::uuid as stream_id,
                   count(distinct stream.id)::integer as stream_count
            from input_aliases input
            join whatsapp_stream_aliases alias
              on alias.organization_id = ${input.clinicId}::uuid
             and alias.kind = input.kind
             and alias.provider_scope = input.provider_scope
             and alias.normalized_value = input.normalized_value
             and alias.retired_at is null
            join whatsapp_streams stream
              on stream.id = alias.stream_id
             and stream.organization_id = alias.organization_id
             and stream.state = 'active'
          )
          update whatsapp_streams stream
          set
            current_generation = stream.current_generation + 1,
            latest_inbound_event_id = event.id,
            quiet_until = event.received_at
              + coalesce(org.message_debounce_ms, ${DEFAULT_MESSAGE_DEBOUNCE_MS})
                * interval '1 millisecond',
            updated_at = clock_timestamp()
          from target_event event
          join organizations org on org.id = event.organization_id
          cross join active_authority authority
          where authority.stream_count = 1
            and stream.id = authority.stream_id
            and stream.organization_id = event.organization_id
            and stream.state = 'active'
            and stream.current_generation < 9007199254740991
          returning stream.id, stream.current_generation, stream.quiet_until
        `,
      },
      {
        name: "bind_event_authority",
        statement: sql`
          update inbound_events event
          set
            stream_id = stream.id,
            stream_generation = stream.current_generation,
            registered_at = clock_timestamp()
          from whatsapp_streams stream
          where ${eventByProviderIdentity}
            and event.stream_id is null
            and event.processing_status not in ('identity_conflict', 'history_only')
            and stream.organization_id = event.organization_id
            and stream.latest_inbound_event_id = event.id
            and stream.state = 'active'
          returning event.id, event.stream_id, event.stream_generation
        `,
      },
      {
        name: "persist_processing_job",
        statement: sql`
          insert into jobs (
            id, queue, payload, dedupe_key, run_at, inbound_event_id
          )
          select
            ${jobId}::uuid,
            'message.process',
            jsonb_build_object(
              'inboundEventId', event.id::text,
              'streamId', event.stream_id::text,
              'streamGeneration', event.stream_generation
            ),
            'inbound-event:' || event.id::text,
            stream.quiet_until,
            event.id
          from inbound_events event
          join whatsapp_streams stream
            on stream.id = event.stream_id
           and stream.organization_id = event.organization_id
          where ${eventByProviderIdentity}
            and event.stream_id is not null
            and event.stream_generation is not null
          on conflict (queue, dedupe_key) do update
            set dedupe_key = excluded.dedupe_key
          returning id
        `,
      },
      {
        name: "read_persisted_result",
        statement: sql`
          select
            case
              when event.processing_status = 'history_only'
                then 'history_only'::text
              when event.processing_status = 'identity_conflict'
                then 'identity_conflict'::text
              else 'registered'::text
            end as outcome,
            event.id::text as inbound_event_id,
            event.stream_id::text as stream_id,
            event.stream_generation,
            job.id::text as job_id,
            job.run_at as job_run_at,
            event.id = ${inboundEventId}::uuid as event_was_new,
            coalesce(job.id = ${jobId}::uuid, false) as job_was_new,
            1 / case
              when event.processing_status = 'identity_conflict'
                and event.stream_id is null
                and event.stream_generation is null
                and job.id is null
                then 1
              when event.processing_status = 'history_only'
                and event.stream_id is null
                and event.stream_generation is null
                and event.claim_token is null
                and event.claim_job_id is null
                and job.id is null
                then 1
              when event.processing_status not in ('identity_conflict', 'history_only')
                and event.stream_id is not null
                and event.stream_generation is not null
                and job.id is not null
                then 1
              else 0
            end as authority_invariant
          from inbound_events event
          left join jobs job
            on job.queue = 'message.process'
           and job.dedupe_key = 'inbound-event:' || event.id::text
          where ${eventByProviderIdentity}
        `,
      },
    ] satisfies readonly AtomicDatabaseBatchStep[];

    const results = await this.atomicBatch.execute(steps);
    const row = results.at(-1)?.rows[0] as RegistrationRow | undefined;
    if (!row) {
      throw new Error("Atomic inbound authority registration returned no row");
    }
    if (row.outcome === "identity_conflict" || row.outcome === "history_only") {
      return {
        outcome: row.outcome,
        inboundEventId: row.inbound_event_id,
        jobId: null,
        eventWasNew: row.event_was_new,
        jobWasNew: false,
      };
    }
    if (!row.stream_id || row.stream_generation === null || !row.job_id || !row.job_run_at) {
      throw new Error("Registered inbound authority returned an incomplete tuple");
    }
    return {
      outcome: "registered",
      inboundEventId: row.inbound_event_id,
      streamId: row.stream_id,
      streamGeneration: Number(row.stream_generation),
      jobId: row.job_id,
      runAt: new Date(row.job_run_at),
      eventWasNew: row.event_was_new,
      jobWasNew: row.job_was_new,
    };
  }

  async findInboundEvent(id: string): Promise<InboundEvent | null> {
    const [event] = await db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.id, id))
      .limit(1);
    return event ? mapInboundEvent(event) : null;
  }

  async markInboundEventProcessing(id: string): Promise<void> {
    await db.update(inboundEvents).set({ processingStatus: "processing" }).where(and(
      eq(inboundEvents.id, id),
      ne(inboundEvents.processingStatus, "history_only"),
    ));
  }

  async markInboundEventPending(id: string): Promise<void> {
    await db.update(inboundEvents).set({ processingStatus: "pending" }).where(and(
      eq(inboundEvents.id, id),
      ne(inboundEvents.processingStatus, "history_only"),
    ));
  }

  async markInboundEventProcessed(id: string, processedAt = new Date()): Promise<void> {
    await db.update(inboundEvents).set({ processingStatus: "processed", processedAt }).where(and(
      eq(inboundEvents.id, id),
      ne(inboundEvents.processingStatus, "history_only"),
    ));
  }

  async markInboundEventFailed(id: string): Promise<void> {
    await db.update(inboundEvents).set({ processingStatus: "failed" }).where(and(
      eq(inboundEvents.id, id),
      ne(inboundEvents.processingStatus, "history_only"),
    ));
  }

  async markInboundEventIgnored(id: string, processedAt = new Date()): Promise<void> {
    await db.update(inboundEvents).set({ processingStatus: "ignored", processedAt }).where(and(
      eq(inboundEvents.id, id),
      ne(inboundEvents.processingStatus, "history_only"),
    ));
  }
}

function mapInboundEvent(row: typeof inboundEvents.$inferSelect): InboundEvent {
  return {
    id: row.id,
    clinicId: row.clinicId,
    provider: row.provider,
    providerMessageId: row.providerMessageId,
    conversationKey: row.conversationKey,
    payload: row.payload,
    normalizedText: row.normalizedText,
    mediaType: row.mediaType,
    dedupeKey: row.dedupeKey,
    processingStatus: row.processingStatus,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    streamId: row.streamId,
    streamGeneration: row.streamGeneration,
    registeredAt: row.registeredAt,
    claimToken: row.claimToken,
    claimTokenDigest: row.claimTokenDigest,
    claimJobId: row.claimJobId,
    claimedAt: row.claimedAt,
  };
}
