import { sql } from "drizzle-orm";
import type { StopContactDecision } from "@/application/channel-safety/stop-contact-policy";
import { db } from "@/infrastructure/db/client";

/** Shared V1/V2 mutation for the existing durable stop-contact semantics. */
export async function persistStopContactDecision(input: Readonly<{
  leadId: string;
  conversationId: string;
  clinicId: string;
  /** Present only for the V2 live path; V1 keeps its historical plain source. */
  sourceInboundEventId?: string;
  decision: StopContactDecision;
}>): Promise<void> {
  if (!input.decision.shouldRevokeConsent) {
    throw new Error("stop-contact decision does not authorize consent revocation");
  }
  const consentSource = input.sourceInboundEventId
    ? `lead_message:${requireUuid(input.sourceInboundEventId)}`
    : input.decision.source;
  const result = await db.execute(sql`
    with scoped as (
      select conversation.id as conversation_id, lead.id as lead_id
      from conversations as conversation
      inner join leads as lead
        on conversation.lead_id = lead.id
       and conversation.organization_id = lead.organization_id
      where conversation.id = ${input.conversationId}
        and conversation.organization_id = ${input.clinicId}
        and lead.id = ${input.leadId}
      for update
    ), updated_consent as (
      update leads as lead
      set contact_consent_revoked_at = ${input.decision.revokedAt},
          contact_consent_source = ${consentSource},
          updated_at = ${input.decision.revokedAt}
      from scoped
      where lead.id = scoped.lead_id
      returning lead.id
    )
    update conversations as conversation
    set needs_attention = true,
        attention_reason = ${input.decision.attentionReason},
        updated_at = ${input.decision.revokedAt}
    from scoped, updated_consent
    where conversation.id = scoped.conversation_id
    returning conversation.id
  `);
  if (result.rows.length !== 1) {
    throw new Error("stop-contact tenant relationship binding mismatch");
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("stop-contact inbound authority is not a UUID");
  }
  return value.toLowerCase();
}
