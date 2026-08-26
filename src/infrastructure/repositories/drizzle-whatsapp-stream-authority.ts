import { sql } from "drizzle-orm";
import type {
  BindStreamToConversationInput,
  BindStreamToConversationResult,
  RepairInboundAuthorityJobInput,
  RepairInboundAuthorityJobResult,
  WhatsAppStreamAuthority,
} from "@/application/ports/whatsapp-stream-authority";
import { db } from "@/infrastructure/db/client";
import {
  neonHttpAtomicDatabaseBatch,
  type AtomicDatabaseBatch,
  type AtomicDatabaseBatchStep,
} from "@/infrastructure/db/atomic-database-batch";

type BindingRow = {
  authoritative_stream_id: string;
  retained_event_stream_id: string;
  retired_current_stream: boolean;
  conversation_stream_order: number | string;
};

export class DrizzleWhatsAppStreamAuthority implements WhatsAppStreamAuthority {
  constructor(
    private readonly atomicBatch: AtomicDatabaseBatch = neonHttpAtomicDatabaseBatch,
  ) {}

  async bindStreamToConversation(
    input: BindStreamToConversationInput,
  ): Promise<BindStreamToConversationResult> {
    const steps = [
      {
        name: "lock_binding_conversation",
        statement: sql`
          select conversation.id
          from conversations conversation
          where conversation.id = ${input.conversationId}::uuid
            and conversation.organization_id = ${input.clinicId}::uuid
          for update
        `,
      },
      {
        name: "lock_binding_streams",
        statement: sql`
          select stream.id
          from whatsapp_streams stream
          where stream.organization_id = ${input.clinicId}::uuid
            and (
              stream.id = ${input.streamId}::uuid
              or (
                stream.conversation_id = ${input.conversationId}::uuid
                and stream.state = 'active'
              )
            )
          order by stream.id
          for update
        `,
      },
      {
        name: "converge_conversation_binding",
        statement: sql`
          with current_stream as (
            select stream.*
            from whatsapp_streams stream
            join inbound_events event
              on event.id = ${input.inboundEventId}::uuid
             and event.organization_id = stream.organization_id
             and event.stream_id = stream.id
             and event.stream_generation = ${input.streamGeneration}
            where stream.id = ${input.streamId}::uuid
              and stream.organization_id = ${input.clinicId}::uuid
          ),
          active_bound_stream as (
            select stream.id
            from whatsapp_streams stream
            where stream.organization_id = ${input.clinicId}::uuid
              and stream.conversation_id = ${input.conversationId}::uuid
              and stream.state = 'active'
            order by stream.id
            limit 1
          ),
          decision as (
            select
              current.id as current_stream_id,
              coalesce(active.id, current.id) as authoritative_stream_id,
              active.id is not null and active.id <> current.id as retire_current,
              coalesce(
                current.conversation_stream_order,
                (
                  select coalesce(max(existing.conversation_stream_order), 0) + 1
                  from whatsapp_streams existing
                  where existing.conversation_id = ${input.conversationId}::uuid
                )
              ) as retained_order
            from current_stream current
            left join active_bound_stream active on true
            where current.conversation_id is null
               or current.conversation_id = ${input.conversationId}::uuid
          ),
          updated_current as (
            update whatsapp_streams current
            set
              conversation_id = ${input.conversationId}::uuid,
              conversation_stream_order = decision.retained_order,
              bound_at = coalesce(current.bound_at, clock_timestamp()),
              state = case
                when decision.retire_current then 'retired'::whatsapp_stream_state
                else 'active'::whatsapp_stream_state
              end,
              retired_at = case
                when decision.retire_current then coalesce(current.retired_at, clock_timestamp())
                else null
              end,
              retirement_reason = case
                when decision.retire_current
                  then 'conversation_convergence'::whatsapp_stream_retirement_reason
                else null
              end,
              updated_at = clock_timestamp()
            from decision
            where current.id = decision.current_stream_id
              and current.organization_id = ${input.clinicId}::uuid
            returning current.id, current.conversation_stream_order
          ),
          moved_aliases as (
            update whatsapp_stream_aliases alias
            set stream_id = decision.authoritative_stream_id
            from decision
            where decision.retire_current
              and alias.organization_id = ${input.clinicId}::uuid
              and alias.stream_id = decision.current_stream_id
              and alias.retired_at is null
            returning alias.id
          ),
          history_only_events as (
            update inbound_events event
            set processing_status = 'history_only'
            from decision
            where decision.retire_current
              and event.organization_id = ${input.clinicId}::uuid
              and event.stream_id = decision.current_stream_id
              and event.claim_token is null
              and event.processing_status in ('pending', 'processing', 'failed')
            returning event.id
          )
          select
            decision.authoritative_stream_id::text,
            updated.id::text as retained_event_stream_id,
            decision.retire_current as retired_current_stream,
            updated.conversation_stream_order,
            (select count(*) from moved_aliases) as moved_alias_count,
            (select count(*) from history_only_events) as history_only_event_count
          from decision
          join updated_current updated on updated.id = decision.current_stream_id
        `,
      },
    ] satisfies readonly AtomicDatabaseBatchStep[];

    const results = await this.atomicBatch.execute(steps);
    const row = results.at(-1)?.rows[0] as BindingRow | undefined;
    if (!row) {
      throw new Error("stream-to-conversation binding rejected an invalid authority tuple");
    }
    return {
      authoritativeStreamId: row.authoritative_stream_id,
      retainedEventStreamId: row.retained_event_stream_id,
      retiredCurrentStream: row.retired_current_stream,
      conversationStreamOrder: Number(row.conversation_stream_order),
    };
  }

  async repairInboundAuthorityJob(
    input: RepairInboundAuthorityJobInput,
  ): Promise<RepairInboundAuthorityJobResult> {
    const result = await db.execute<{
      outcome: "created" | "rebound";
      job_id: string;
    }>(sql`
      with candidate as materialized (
        select
          event.id as inbound_event_id,
          event.stream_id,
          event.stream_generation,
          event.claim_token,
          event.claim_job_id,
          stream.state as stream_state,
          stream.current_generation,
          stream.latest_inbound_event_id,
          stream.quiet_until
        from inbound_events event
        join whatsapp_streams stream
          on stream.id = event.stream_id
         and stream.organization_id = event.organization_id
        where event.id = ${input.inboundEventId}::uuid
          and event.received_at <= ${input.olderThan}
          and event.processing_status in ('pending', 'failed')
          and event.stream_id is not null
          and event.stream_generation is not null
          and not exists (
            select 1
            from outbound_messages outbound
            where outbound.authorization_inbound_event_id = event.id
          )
        for update of event, stream
      ),
      existing_job as materialized (
        select job.*
        from jobs job
        join candidate
          on job.id = candidate.claim_job_id
          or job.inbound_event_id = candidate.inbound_event_id
          or (
            job.queue = 'message.process'
            and job.dedupe_key = 'inbound-event:' || candidate.inbound_event_id::text
          )
        order by job.id
        for update of job
      ),
      decision as (
        select
          candidate.*,
          case
            when candidate.claim_job_id is not null
              and exists (
                select 1 from existing_job job
                where job.id = candidate.claim_job_id
                  and job.queue = 'message.process'
                  and job.inbound_event_id = candidate.inbound_event_id
                  and job.dedupe_key = 'inbound-event:' || candidate.inbound_event_id::text
                  and job.payload->>'inboundEventId' = candidate.inbound_event_id::text
                  and job.payload->>'streamId' = candidate.stream_id::text
                  and job.payload->>'streamGeneration' = candidate.stream_generation::text
                  and job.status in ('failed', 'dead', 'done')
              ) then 'rebound'
            when candidate.claim_job_id is null
              and not exists (select 1 from existing_job)
              then 'created'
            else 'ineligible'
          end as outcome,
          case
            when candidate.stream_state <> 'active'
              or candidate.latest_inbound_event_id is distinct from candidate.inbound_event_id
              or candidate.current_generation is distinct from candidate.stream_generation
              then ${input.now}
            else greatest(${input.now}, candidate.quiet_until)
          end as repaired_run_at
        from candidate
      ),
      inserted_job as (
        insert into jobs (
          queue,
          status,
          payload,
          dedupe_key,
          run_at,
          inbound_event_id,
          max_attempts,
          created_at,
          updated_at
        )
        select
          'message.process',
          'pending',
          jsonb_build_object(
            'inboundEventId', decision.inbound_event_id::text,
            'streamId', decision.stream_id::text,
            'streamGeneration', decision.stream_generation
          ),
          'inbound-event:' || decision.inbound_event_id::text,
          decision.repaired_run_at,
          decision.inbound_event_id,
          3,
          ${input.now},
          ${input.now}
        from decision
        where decision.outcome = 'created'
        on conflict do nothing
        returning id, inbound_event_id
      ),
      reset_job as (
        update jobs job
        set
          status = 'pending',
          run_at = decision.repaired_run_at,
          locked_at = null,
          locked_by = null,
          last_error = null,
          max_attempts = 3,
          dead_letter_disposition = null,
          dead_letter_resolved_at = null,
          dead_letter_resolved_by = null,
          dead_letter_resolution_reason = null,
          updated_at = ${input.now}
        from decision
        where decision.outcome = 'rebound'
          and job.id = decision.claim_job_id
        returning job.id, job.inbound_event_id
      ),
      rebound_event as (
        update inbound_events event
        set claim_job_id = inserted.id
        from inserted_job inserted
        where event.id = inserted.inbound_event_id
          and event.claim_token is not null
        returning event.id
      )
      select 'created'::text as outcome, inserted.id::text as job_id
      from inserted_job inserted
      left join rebound_event event on event.id = inserted.inbound_event_id
      union all
      select 'rebound'::text as outcome, reset.id::text as job_id
      from reset_job reset
    `);
    const row = result.rows[0];
    return row
      ? { outcome: row.outcome, jobId: row.job_id }
      : { outcome: "ineligible", jobId: null };
  }
}
