import { randomUUID } from "node:crypto";
import { and, asc, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type {
  CreateOutboundMessageInput,
  CreateOutboundMessageAndEnqueueResult,
  CreateOutboundMessageResult,
  MarkOutboundDeliveredInput,
  OutboundMessage,
  OutboundMessageStore,
  OutboundSendAuthorizationResult,
} from "@/application/ports/outbound-message-store";
import {
  LiveOutboundCreationRejectedError,
  isLiveOutboundPreflightReason,
} from "@/application/ports/live-outbound-preflight";
import { digestInboundClaimToken } from "@/application/jobs/inbound-claim-token";
import { db } from "@/infrastructure/db/client";
import { outboundMessages } from "@/infrastructure/db/schema";
import { DrizzleLiveOutboundPreflight } from "@/infrastructure/repositories/drizzle-live-outbound-preflight";

export class DrizzleOutboundMessageStore implements OutboundMessageStore {
  constructor(
    private readonly liveOutboundPreflight = new DrizzleLiveOutboundPreflight(),
  ) {}

  async createOutboundMessageAndEnqueue(
    input: CreateOutboundMessageInput,
    options?: { turnId?: string | null },
  ): Promise<CreateOutboundMessageAndEnqueueResult> {
    const outboundMessageId = randomUUID();
    const jobId = randomUUID();
    const jobPayload = {
      outboundMessageId,
      ...(options?.turnId ? { turnId: options.turnId } : {}),
    };
    const authorization = input.authorization;
    const isLiveReply = authorization.kind === "live_stream_reply";
    const claimTokenDigest = isLiveReply
      ? digestInboundClaimToken(authorization.claimToken)
      : null;
    const streamId = isLiveReply ? authorization.streamId : null;
    const streamGeneration = isLiveReply ? authorization.streamGeneration : null;
    const sourceInboundEventId = isLiveReply ? authorization.sourceInboundEventId : null;
    const claimJobId = isLiveReply ? authorization.claimJobId : null;
    const turnId = options?.turnId ?? readTurnId(input.payload);
    const statement = sql`
      with creation_context as materialized (
        select
          organization.id is not null as organization_exists,
          organization.operational_status,
          organization.auto_reply_enabled,
          organization.shadow_mode_enabled,
          organization.is_demo,
          coalesce(authority.version, 0)::integer as authority_version,
          control.live_outbound_enabled
        from (select ${input.clinicId}::uuid as organization_id) requested
        left join organizations organization on organization.id = requested.organization_id
        left join conversation_authority authority
          on authority.organization_id = requested.organization_id
        left join conversation_runtime_control control on control.key = 'global'
      ), creation_decision as materialized (
        select
          creation_context.authority_version as version,
          case
            when exists (
          select 1
          from inbound_events terminal_event
          where terminal_event.organization_id = ${input.clinicId}::uuid
            and terminal_event.id::text = ${turnId}
            and terminal_event.processing_status = 'history_only'
            and terminal_event.stream_id is null
            and terminal_event.stream_generation is null
            ) then 'outbound_not_sendable'
            when ${authorization.kind} = 'live_stream_reply' then case
              when creation_context.authority_version < 2 then 'authority_below_v2'
              when ${input.category ?? "reply"} <> 'reply' then 'claim_mismatch'
              when not exists (
                select 1
                from inbound_events event
                join whatsapp_streams stream
                  on stream.id = event.stream_id
                 and stream.organization_id = event.organization_id
                 and stream.conversation_id = ${input.conversationId}::uuid
                 and stream.state = 'active'
                join jobs claim_job
                  on claim_job.id = event.claim_job_id
                 and claim_job.id = ${claimJobId}::uuid
                 and claim_job.inbound_event_id = event.id
                 and claim_job.queue = 'message.process'
                where event.id = ${sourceInboundEventId}::uuid
                  and event.organization_id = ${input.clinicId}::uuid
                  and event.stream_id = ${streamId}::uuid
                  and event.stream_generation = ${streamGeneration}
                  and event.claim_token = ${isLiveReply ? authorization.claimToken : null}
                  and event.claim_token_digest = ${claimTokenDigest}
                  and event.claim_job_id = ${claimJobId}::uuid
                  and event.claimed_at is not null
              ) then 'claim_mismatch'
              when creation_context.organization_exists is not true
                or creation_context.operational_status is distinct from 'active'
                then 'clinic_not_active'
              when creation_context.auto_reply_enabled is distinct from true
                then 'auto_reply_disabled'
              when creation_context.shadow_mode_enabled is distinct from false
                or creation_context.is_demo is distinct from false
                then 'shadow_observe'
              when creation_context.live_outbound_enabled is distinct from true
                then 'global_kill_switch'
              else null
            end
            when ${authorization.kind} = 'legacy' and creation_context.authority_version >= 2
              then 'outbound_not_sendable'
            when (
            (${authorization.kind} = 'follow_up' and ${input.category ?? "reply"} = 'follow_up')
            or (${authorization.kind} = 'reminder' and ${input.category ?? "reply"} = 'reminder')
            or (${authorization.kind} = 'campaign' and ${input.category ?? "reply"} = 'campaign')
            or (${authorization.kind} = 'recovery' and ${input.category ?? "reply"} = 'recovery')
            or (${authorization.kind} = 'operational' and ${input.category ?? "reply"} = 'operational')
            or (${authorization.kind} in ('human_manual', 'system', 'legacy') and ${input.category ?? "reply"} = 'reply')
            ) then null
            else 'outbound_not_sendable'
          end as reason
        from creation_context
      ), validated_authorization as materialized (
        select version
        from creation_decision
        where reason is null
      ), reserved_sequence as (
        update conversations
        set next_outbound_sequence = next_outbound_sequence + 1
        from validated_authorization
        where conversations.id = ${input.conversationId}::uuid
          and conversations.organization_id = ${input.clinicId}::uuid
        returning next_outbound_sequence
      ), inserted_message as (
        insert into outbound_messages (
          id,
          organization_id,
          conversation_id,
          channel,
          payload,
          delivery_kind,
          category,
          sequence,
          dedupe_key,
          authorization_kind,
          authorization_stream_id,
          authorization_generation,
          authorization_inbound_event_id,
          authorization_claim_job_id,
          authorization_claim_token_digest,
          authorization_version
        )
        select
          ${outboundMessageId}::uuid,
          ${input.clinicId}::uuid,
          ${input.conversationId}::uuid,
          ${input.channel},
          ${JSON.stringify(input.payload)}::jsonb,
          ${input.deliveryKind},
          ${input.category ?? "reply"},
          reserved_sequence.next_outbound_sequence,
          ${input.dedupeKey ?? null},
          ${authorization.kind},
          ${streamId}::uuid,
          ${streamGeneration},
          ${sourceInboundEventId}::uuid,
          ${claimJobId}::uuid,
          ${claimTokenDigest},
          validated_authorization.version
        from reserved_sequence
        cross join validated_authorization
        on conflict do nothing
        returning id
      ), persisted_message as materialized (
        select id from inserted_message
        union all
        select existing.id
        from outbound_messages existing
        cross join validated_authorization
        where existing.organization_id = ${input.clinicId}::uuid
          and existing.conversation_id = ${input.conversationId}::uuid
          and (
            (${input.dedupeKey ?? null}::text is not null and existing.dedupe_key = ${input.dedupeKey ?? null}::text)
            or (
              ${authorization.kind} = 'live_stream_reply'
              and existing.authorization_stream_id = ${streamId}::uuid
              and existing.authorization_generation = ${streamGeneration}
              and existing.authorization_inbound_event_id = ${sourceInboundEventId}::uuid
            )
          )
        order by id
        limit 1
      ), persisted_job as (
        insert into jobs (id, queue, payload, dedupe_key)
        select
          ${jobId}::uuid,
          'message.send',
          ${JSON.stringify(jobPayload)}::jsonb ||
            jsonb_build_object('outboundMessageId', persisted_message.id::text),
          'outbound-message:' || persisted_message.id::text
        from persisted_message
        on conflict (queue, dedupe_key) do update
          set dedupe_key = excluded.dedupe_key
        returning id
      )
      select
        persisted_message.id::text as outbound_message_id,
        persisted_message.id = ${outboundMessageId}::uuid as message_was_new,
        persisted_job.id = ${jobId}::uuid as job_was_new,
        null::text as rejection_reason
      from persisted_message
      cross join persisted_job
      union all
      select
        null::text as outbound_message_id,
        false as message_was_new,
        false as job_was_new,
        creation_decision.reason as rejection_reason
      from creation_decision
      where creation_decision.reason is not null
    `;
    let result: Awaited<ReturnType<typeof db.execute<{
      outbound_message_id: string | null;
      message_was_new: boolean;
      job_was_new: boolean;
      rejection_reason: string | null;
    }>>>;
    try {
      result = await db.execute<{
        outbound_message_id: string | null;
        message_was_new: boolean;
        job_was_new: boolean;
        rejection_reason: string | null;
      }>(statement);
    } catch {
      // Drizzle's low-level query error includes bound parameters. Replacing it
      // here prevents the raw claim token and its digest from reaching logs.
      throw new Error("Atomic outbound creation failed");
    }
    const row = result.rows[0];
    if (isLiveReply && isLiveOutboundPreflightReason(row?.rejection_reason)) {
      throw new LiveOutboundCreationRejectedError(row.rejection_reason);
    }
    if (!row?.outbound_message_id) {
      throw new Error(
        `Outbound authorization rejected or conversation not found: ${input.conversationId}`,
      );
    }

    return {
      outboundMessageId: row.outbound_message_id,
      messageWasNew: row.message_was_new,
      jobWasNew: row.job_was_new,
    };
  }

  async createOutboundMessage(
    input: CreateOutboundMessageInput,
  ): Promise<CreateOutboundMessageResult> {
    const result = await this.createOutboundMessageAndEnqueue(input);
    const message = await this.findOutboundMessage(result.outboundMessageId);
    if (!message) throw new Error("Atomic outbound insert returned a missing message");
    return { message, isNew: result.messageWasNew };
  }

  async findOutboundMessage(id: string): Promise<OutboundMessage | null> {
    const [message] = await db
      .select()
      .from(outboundMessages)
      .where(eq(outboundMessages.id, id))
      .limit(1);
    return message ? mapOutboundMessage(message) : null;
  }

  async authorizeOutboundMessageForSend(
    id: string,
  ): Promise<OutboundSendAuthorizationResult> {
    return this.liveOutboundPreflight.authorizeOutboundMessageForSend(id);
  }

  async findConversationReplyByTurnId(input: {
    clinicId: string;
    turnId: string;
  }): Promise<OutboundMessage | null> {
    const [message] = await db
      .select()
      .from(outboundMessages)
      .where(and(
        eq(outboundMessages.clinicId, input.clinicId),
        eq(outboundMessages.category, "reply"),
        sql`${outboundMessages.payload}->>'turnId' = ${input.turnId}`,
      ))
      .orderBy(asc(outboundMessages.createdAt))
      .limit(1);
    return message ? mapOutboundMessage(message) : null;
  }

  async hasEarlierActiveMessage(message: OutboundMessage): Promise<boolean> {
    const [earlier] = await db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.conversationId, message.conversationId),
          lt(outboundMessages.sequence, message.sequence),
          inArray(outboundMessages.status, ["pending", "processing"]),
        ),
      )
      .limit(1);
    return Boolean(earlier);
  }

  async markOutboundProcessing(id: string): Promise<boolean> {
    const rows = await db
      .update(outboundMessages)
      .set({
        status: "processing",
        attempts: sql`${outboundMessages.attempts} + 1`,
      })
      .where(and(eq(outboundMessages.id, id), eq(outboundMessages.status, "pending")))
      .returning({ id: outboundMessages.id });
    return rows.length > 0;
  }

  async markOutboundPending(id: string, error: string): Promise<void> {
    await db
      .update(outboundMessages)
      .set({ status: "pending", lastError: error })
      .where(and(
        eq(outboundMessages.id, id),
        inArray(outboundMessages.status, ["pending", "processing"]),
      ));
  }

  async markOutboundDelivered(input: MarkOutboundDeliveredInput): Promise<void> {
    await db
      .update(outboundMessages)
      .set({
        status: "sent",
        providerMessageId: input.providerMessageId,
        sentAt: input.sentAt ?? new Date(),
        lastError: null,
      })
      .where(eq(outboundMessages.id, input.id));
  }

  async markOutboundFailed(id: string, error: string): Promise<void> {
    await db
      .update(outboundMessages)
      .set({ status: "failed", lastError: error })
      .where(eq(outboundMessages.id, id));
  }

  async markOutboundDead(id: string, error: string): Promise<void> {
    await db
      .update(outboundMessages)
      .set({ status: "dead", lastError: error })
      .where(eq(outboundMessages.id, id));
  }

  async markOutboundCancelled(id: string, error: string): Promise<void> {
    await db
      .update(outboundMessages)
      .set({ status: "cancelled", lastError: error })
      .where(eq(outboundMessages.id, id));
  }

  async countSentSince(input: { clinicId: string; since: Date }): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.clinicId, input.clinicId),
          eq(outboundMessages.status, "sent"),
          gte(outboundMessages.sentAt, input.since),
        ),
      );
    return row?.value ?? 0;
  }
}

function readTurnId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const turnId = (payload as Record<string, unknown>).turnId;
  return typeof turnId === "string" && turnId.length > 0 ? turnId : null;
}

function mapOutboundMessage(row: typeof outboundMessages.$inferSelect): OutboundMessage {
  return {
    id: row.id,
    clinicId: row.clinicId,
    conversationId: row.conversationId,
    channel: row.channel,
    payload: row.payload,
    deliveryKind: row.deliveryKind,
    category: row.category,
    sequence: row.sequence,
    status: row.status,
    providerMessageId: row.providerMessageId,
    dedupeKey: row.dedupeKey,
    attempts: row.attempts,
    lastError: row.lastError,
    authorization: {
      kind: row.authorizationKind,
      streamId: row.authorizationStreamId,
      streamGeneration: row.authorizationGeneration,
      sourceInboundEventId: row.authorizationInboundEventId,
      claimJobId: row.authorizationClaimJobId,
      claimTokenDigest: row.authorizationClaimTokenDigest,
      authorityVersion: row.authorizationVersion,
    },
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}
