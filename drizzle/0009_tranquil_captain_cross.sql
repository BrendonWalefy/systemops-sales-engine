DO $$
BEGIN
  CREATE TEMP TABLE _systemops_lead_dedupe_map ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      id,
      FIRST_VALUE(id) OVER (
        PARTITION BY clinic_id, phone
        ORDER BY
          CASE status::text
            WHEN 'won' THEN 7
            WHEN 'appointment_scheduled' THEN 6
            WHEN 'follow_up_due' THEN 5
            WHEN 'in_conversation' THEN 4
            WHEN 'waiting_response' THEN 3
            WHEN 'lost' THEN 2
            ELSE 1
          END DESC,
          updated_at DESC,
          created_at ASC,
          id ASC
      ) AS keep_id
    FROM leads
    WHERE phone IS NOT NULL
  )
  SELECT id AS duplicate_id, keep_id
  FROM ranked
  WHERE id <> keep_id;

  DELETE FROM follow_ups AS duplicate_follow_up
  USING _systemops_lead_dedupe_map AS m, follow_ups AS keep_follow_up
  WHERE duplicate_follow_up.lead_id = m.duplicate_id
    AND keep_follow_up.lead_id = m.keep_id
    AND keep_follow_up.clinic_id = duplicate_follow_up.clinic_id
    AND keep_follow_up.reason = duplicate_follow_up.reason
    AND keep_follow_up.due_at = duplicate_follow_up.due_at;

  UPDATE leads AS keep_lead
  SET
    name = COALESCE(keep_lead.name, duplicate_lead.name),
    email = COALESCE(keep_lead.email, duplicate_lead.email),
    campaign_id = COALESCE(keep_lead.campaign_id, duplicate_lead.campaign_id),
    treatment_interest = COALESCE(keep_lead.treatment_interest, duplicate_lead.treatment_interest),
    temperature = COALESCE(keep_lead.temperature, duplicate_lead.temperature),
    assigned_to_user_id = COALESCE(keep_lead.assigned_to_user_id, duplicate_lead.assigned_to_user_id),
    next_action_at = COALESCE(keep_lead.next_action_at, duplicate_lead.next_action_at),
    lost_reason = COALESCE(keep_lead.lost_reason, duplicate_lead.lost_reason),
    updated_at = GREATEST(keep_lead.updated_at, duplicate_lead.updated_at)
  FROM leads AS duplicate_lead
  JOIN _systemops_lead_dedupe_map AS m ON m.duplicate_id = duplicate_lead.id
  WHERE keep_lead.id = m.keep_id;

  UPDATE conversations AS c
  SET lead_id = m.keep_id
  FROM _systemops_lead_dedupe_map AS m
  WHERE c.lead_id = m.duplicate_id;

  UPDATE agent_recommendations AS ar
  SET lead_id = m.keep_id
  FROM _systemops_lead_dedupe_map AS m
  WHERE ar.lead_id = m.duplicate_id;

  UPDATE appointments AS a
  SET lead_id = m.keep_id
  FROM _systemops_lead_dedupe_map AS m
  WHERE a.lead_id = m.duplicate_id;

  UPDATE follow_ups AS f
  SET lead_id = m.keep_id
  FROM _systemops_lead_dedupe_map AS m
  WHERE f.lead_id = m.duplicate_id;

  UPDATE slot_reservations AS sr
  SET lead_id = m.keep_id
  FROM _systemops_lead_dedupe_map AS m
  WHERE sr.lead_id = m.duplicate_id;

  DELETE FROM leads AS l
  USING _systemops_lead_dedupe_map AS m
  WHERE l.id = m.duplicate_id;

  CREATE TEMP TABLE _systemops_conversation_dedupe_map ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      id,
      FIRST_VALUE(id) OVER (
        PARTITION BY lead_id
        ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC, created_at ASC, id ASC
      ) AS keep_id
    FROM conversations
  )
  SELECT id AS duplicate_id, keep_id
  FROM ranked
  WHERE id <> keep_id;

  UPDATE conversations AS keep_conversation
  SET
    external_thread_id = COALESCE(keep_conversation.external_thread_id, duplicate_conversation.external_thread_id),
    summary = COALESCE(keep_conversation.summary, duplicate_conversation.summary),
    ai_paused = keep_conversation.ai_paused OR duplicate_conversation.ai_paused,
    takeover_expires_at = COALESCE(keep_conversation.takeover_expires_at, duplicate_conversation.takeover_expires_at),
    needs_attention = keep_conversation.needs_attention OR duplicate_conversation.needs_attention,
    attention_reason = COALESCE(keep_conversation.attention_reason, duplicate_conversation.attention_reason),
    consecutive_unclear_count = GREATEST(
      keep_conversation.consecutive_unclear_count,
      duplicate_conversation.consecutive_unclear_count
    ),
    last_message_at = COALESCE(
      GREATEST(keep_conversation.last_message_at, duplicate_conversation.last_message_at),
      keep_conversation.last_message_at,
      duplicate_conversation.last_message_at
    ),
    updated_at = GREATEST(keep_conversation.updated_at, duplicate_conversation.updated_at)
  FROM conversations AS duplicate_conversation
  JOIN _systemops_conversation_dedupe_map AS m ON m.duplicate_id = duplicate_conversation.id
  WHERE keep_conversation.id = m.keep_id;

  UPDATE messages AS msg
  SET conversation_id = m.keep_id
  FROM _systemops_conversation_dedupe_map AS m
  WHERE msg.conversation_id = m.duplicate_id;

  UPDATE conversation_states AS state
  SET conversation_id = m.keep_id
  FROM _systemops_conversation_dedupe_map AS m
  WHERE state.conversation_id = m.duplicate_id;

  UPDATE agent_recommendations AS ar
  SET conversation_id = m.keep_id
  FROM _systemops_conversation_dedupe_map AS m
  WHERE ar.conversation_id = m.duplicate_id;

  DELETE FROM conversations AS c
  USING _systemops_conversation_dedupe_map AS m
  WHERE c.id = m.duplicate_id;
END $$;
--> statement-breakpoint
DROP INDEX "conversations_lead_idx";--> statement-breakpoint
DROP INDEX "leads_clinic_phone_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_lead_idx" ON "conversations" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_clinic_phone_idx" ON "leads" USING btree ("clinic_id","phone");
