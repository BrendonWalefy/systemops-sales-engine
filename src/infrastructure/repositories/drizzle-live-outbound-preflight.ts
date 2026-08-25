import { sql } from "drizzle-orm";
import type {
  LiveOutboundPreflight,
  LiveOutboundPreflightResult,
} from "@/application/ports/live-outbound-preflight";
import { isLiveOutboundPreflightReason } from "@/application/ports/live-outbound-preflight";
import { db } from "@/infrastructure/db/client";

/**
 * Canonical sender authorization read. It is one bounded statement keyed by
 * the outbound primary key; every joined relation is reached by a PK, unique
 * tuple, or the singleton control key.
 */
export class DrizzleLiveOutboundPreflight implements LiveOutboundPreflight {
  async authorizeOutboundMessageForSend(id: string): Promise<LiveOutboundPreflightResult> {
    const result = await db.execute<{ authorized: boolean; reason: string | null }>(sql`
      with outbound_candidate as materialized (
        select
          outbound.*,
          case
            when jsonb_typeof(outbound.payload->'turnId') = 'string'
              and outbound.payload->>'turnId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (outbound.payload->>'turnId')::uuid
            else null
          end as payload_turn_id
        from outbound_messages outbound
        where outbound.id = ${id}::uuid
        limit 1
      ), candidate as materialized (
        select
          outbound.status,
          outbound.category,
          outbound.authorization_kind,
          outbound.authorization_version,
          outbound.payload,
          outbound.payload_turn_id,
          organization.operational_status,
          organization.auto_reply_enabled,
          organization.shadow_mode_enabled,
          organization.is_demo,
          organization.channel_safety_mode,
          authority.version as current_authority_version,
          conversation.id as bound_conversation_id,
          conversation.ai_paused,
          conversation.takeover_expires_at,
          lead.id as bound_lead_id,
          lead.contact_consent_revoked_at,
          lead.contact_consent_source,
          event.id as bound_event_id,
          stream.id as bound_stream_id,
          claim_job.id as bound_claim_job_id,
          control.live_outbound_enabled,
          exists (
            select 1
            from inbound_events terminal_event
            where terminal_event.organization_id = outbound.organization_id
              and terminal_event.id = outbound.payload_turn_id
              and terminal_event.processing_status = 'history_only'
              and terminal_event.stream_id is null
              and terminal_event.stream_generation is null
          ) as terminal_legacy_history,
          (
            outbound.authorization_stream_id is null
            and outbound.authorization_generation is null
            and outbound.authorization_inbound_event_id is null
            and outbound.authorization_claim_job_id is null
            and outbound.authorization_claim_token_digest is null
            and outbound.authorization_version is not null
          ) as non_live_shape_valid
        from outbound_candidate outbound
        left join organizations organization
          on organization.id = outbound.organization_id
        left join conversations conversation
          on conversation.id = outbound.conversation_id
         and conversation.organization_id = outbound.organization_id
        left join leads lead
          on lead.id = conversation.lead_id
         and lead.organization_id = outbound.organization_id
        left join conversation_authority authority
          on authority.organization_id = outbound.organization_id
        left join inbound_events event
          on event.id = outbound.authorization_inbound_event_id
         and event.organization_id = outbound.organization_id
         and event.stream_id = outbound.authorization_stream_id
         and event.stream_generation = outbound.authorization_generation
         and event.claim_job_id = outbound.authorization_claim_job_id
         and event.claim_token_digest = outbound.authorization_claim_token_digest
         and event.claimed_at is not null
        left join whatsapp_streams stream
          on stream.id = event.stream_id
          and stream.organization_id = event.organization_id
          and stream.conversation_id = outbound.conversation_id
          and (
            stream.state = 'active'
            or (
              stream.state = 'retired'
              and stream.retirement_reason in (
                'alias_convergence',
                'conversation_convergence'
              )
            )
          )
        left join jobs claim_job
          on claim_job.id = event.claim_job_id
         and claim_job.inbound_event_id = event.id
         and claim_job.queue = 'message.process'
        left join conversation_runtime_control control
          on control.key = 'global'
        limit 1
      ), evaluated as (
        select case
          when status not in ('pending', 'processing') or terminal_legacy_history
            then 'outbound_not_sendable'
          when authorization_kind = 'live_stream_reply' then case
            when coalesce(current_authority_version, 0) < 2
              or coalesce(authorization_version, 0) < 2
              then 'authority_below_v2'
            when authorization_version <> current_authority_version
              or bound_event_id is null
              or bound_stream_id is null
              or bound_claim_job_id is null
              or bound_conversation_id is null
              or bound_lead_id is null
              or payload_turn_id is distinct from bound_event_id
              or payload->>'leadId' is distinct from bound_lead_id::text
              or category <> 'reply'
              then 'claim_mismatch'
            when operational_status is distinct from 'active'
              then 'clinic_not_active'
            when auto_reply_enabled is distinct from true
              then 'auto_reply_disabled'
            when shadow_mode_enabled is distinct from false or is_demo is distinct from false
              then 'shadow_observe'
            when ai_paused is distinct from false
              or (takeover_expires_at is not null and takeover_expires_at > now())
              then 'human_takeover'
            when contact_consent_revoked_at is not null
              and (
                contact_consent_source = 'lead_message'
                or contact_consent_source like 'lead_message:%'
              )
              and (
                contact_consent_source is distinct from 'lead_message:' || bound_event_id::text
                or payload->>'intent' is distinct from 'stop_contact'
              ) then 'opted_out'
            when contact_consent_revoked_at is not null
              and contact_consent_source is distinct from 'lead_message:' || bound_event_id::text
              then 'consent_revoked'
            when channel_safety_mode = 'frozen'
              then 'safety_blocked'
            when live_outbound_enabled is distinct from true
              then 'global_kill_switch'
            else null
          end
          when authorization_kind = 'follow_up' and non_live_shape_valid and category = 'follow_up' then null
          when authorization_kind = 'reminder' and non_live_shape_valid and category = 'reminder' then null
          when authorization_kind = 'campaign' and non_live_shape_valid and category = 'campaign' then null
          when authorization_kind = 'recovery' and non_live_shape_valid and category = 'recovery' then null
          when authorization_kind = 'operational' and non_live_shape_valid and category = 'operational' then null
          when authorization_kind in ('human_manual', 'system') and non_live_shape_valid and category = 'reply' then null
          when authorization_kind = 'legacy' and non_live_shape_valid
            and coalesce(current_authority_version, 0) < 2 and category = 'reply' then null
          when authorization_kind is null and coalesce(current_authority_version, 0) < 2 then null
          else 'outbound_not_sendable'
        end as reason
        from candidate
      )
      select reason is null as authorized, reason
      from evaluated
    `);
    const row = result.rows[0];
    if (!row) return { authorized: false, reason: "outbound_not_sendable" };
    if (row.authorized) return { authorized: true };
    return {
      authorized: false,
      reason: isLiveOutboundPreflightReason(row.reason)
        ? row.reason
        : "outbound_not_sendable",
    };
  }
}
