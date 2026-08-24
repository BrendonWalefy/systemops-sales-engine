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
import { digestInboundClaimToken } from "@/application/jobs/inbound-claim-token";
import { db } from "@/infrastructure/db/client";
import { outboundMessages } from "@/infrastructure/db/schema";

export class DrizzleOutboundMessageStore implements OutboundMessageStore {
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
    const statement = sql`
      with authority_version as materialized (
        select coalesce((
          select authority.version
          from conversation_authority authority
          where authority.organization_id = ${input.clinicId}::uuid
        ), 0)::integer as version
      ), validated_authorization as materialized (
        select authority_version.version
        from authority_version
        where (
          ${authorization.kind} <> 'live_stream_reply'
          and not (${authorization.kind} = 'legacy' and authority_version.version >= 2)
          and (
            (${authorization.kind} = 'follow_up' and ${input.category ?? "reply"} = 'follow_up')
            or (${authorization.kind} = 'reminder' and ${input.category ?? "reply"} = 'reminder')
            or (${authorization.kind} = 'campaign' and ${input.category ?? "reply"} = 'campaign')
            or (${authorization.kind} = 'recovery' and ${input.category ?? "reply"} = 'recovery')
            or (${authorization.kind} = 'operational' and ${input.category ?? "reply"} = 'operational')
            or (${authorization.kind} in ('human_manual', 'system', 'legacy') and ${input.category ?? "reply"} = 'reply')
          )
        ) or (
          ${authorization.kind} = 'live_stream_reply'
          and ${input.category ?? "reply"} = 'reply'
          and exists (
            select 1
            from inbound_events event
            join whatsapp_streams stream
              on stream.id = event.stream_id
             and stream.organization_id = event.organization_id
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
          )
        )
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
        persisted_job.id = ${jobId}::uuid as job_was_new
      from persisted_message
      cross join persisted_job
    `;
    let result: Awaited<ReturnType<typeof db.execute<{
      outbound_message_id: string;
      message_was_new: boolean;
      job_was_new: boolean;
    }>>>;
    try {
      result = await db.execute<{
        outbound_message_id: string;
        message_was_new: boolean;
        job_was_new: boolean;
      }>(statement);
    } catch {
      // Drizzle's low-level query error includes bound parameters. Replacing it
      // here prevents the raw claim token and its digest from reaching logs.
      throw new Error("Atomic outbound creation failed");
    }
    const row = result.rows[0];
    if (!row) {
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
    const result = await db.execute<{ authorized: boolean; reason: string }>(sql`
      select
        case
          when coalesce(authority.version, 0) < 2
            and outbound.authorization_kind is null then true
          when coalesce(authority.version, 0) >= 2
            and (outbound.authorization_kind is null or outbound.authorization_kind = 'legacy') then false
          when outbound.authorization_kind = 'live_stream_reply' then
            outbound.category = 'reply'
            and outbound.authorization_version = coalesce(authority.version, 0)
            and exists (
            select 1
            from inbound_events event
            join whatsapp_streams stream
              on stream.id = event.stream_id
             and stream.organization_id = event.organization_id
            join jobs claim_job
              on claim_job.id = event.claim_job_id
             and claim_job.id = outbound.authorization_claim_job_id
             and claim_job.inbound_event_id = event.id
             and claim_job.queue = 'message.process'
            where event.id = outbound.authorization_inbound_event_id
              and event.organization_id = outbound.organization_id
              and event.stream_id = outbound.authorization_stream_id
              and event.stream_generation = outbound.authorization_generation
              and event.claim_token_digest = outbound.authorization_claim_token_digest
              and event.claimed_at is not null
          )
          when outbound.authorization_kind = 'follow_up' then shape.valid and outbound.category = 'follow_up'
          when outbound.authorization_kind = 'reminder' then shape.valid and outbound.category = 'reminder'
          when outbound.authorization_kind = 'campaign' then shape.valid and outbound.category = 'campaign'
          when outbound.authorization_kind = 'recovery' then shape.valid and outbound.category = 'recovery'
          when outbound.authorization_kind = 'operational' then shape.valid and outbound.category = 'operational'
          when outbound.authorization_kind in ('human_manual', 'system') then shape.valid and outbound.category = 'reply'
          when outbound.authorization_kind = 'legacy' then shape.valid and coalesce(authority.version, 0) < 2
          else false
        end as authorized,
        case
          when coalesce(authority.version, 0) >= 2
            and (outbound.authorization_kind is null or outbound.authorization_kind = 'legacy')
            then 'authority_version_activated'
          when outbound.authorization_kind = 'live_stream_reply' then 'invalid_live_stream_authority'
          else 'invalid_outbound_authorization'
        end as reason
      from outbound_messages outbound
      join conversations conversation
        on conversation.id = outbound.conversation_id
       and conversation.organization_id = outbound.organization_id
      left join conversation_authority authority
        on authority.organization_id = outbound.organization_id
      cross join lateral (
        select (
          outbound.authorization_stream_id is null
          and outbound.authorization_generation is null
          and outbound.authorization_inbound_event_id is null
          and outbound.authorization_claim_job_id is null
          and outbound.authorization_claim_token_digest is null
          and outbound.authorization_version is not null
        ) as valid
      ) shape
      where outbound.id = ${id}::uuid
        and outbound.status in ('pending', 'processing')
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return { authorized: false, reason: "outbound_not_sendable" };
    return row.authorized ? { authorized: true } : { authorized: false, reason: row.reason };
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
