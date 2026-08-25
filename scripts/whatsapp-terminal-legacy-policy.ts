import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";

type AuthorityCutoffRow = { cutoff: Date | string };
type EligibilityRow = { event_id: string; eligible: boolean };

export async function readVersionOneAuthorityCutoff(clinicId: string): Promise<Date | null> {
  const result = await db.execute<AuthorityCutoffRow>(sql`
    select authority.updated_at as cutoff
    from conversation_authority authority
    where authority.organization_id = ${clinicId}::uuid
      and authority.version = 1
    limit 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  const cutoff = new Date(row.cutoff);
  if (!Number.isFinite(cutoff.getTime())) {
    throw new Error("terminal legacy settlement found an invalid version-1 cutoff");
  }
  return cutoff;
}

export async function readTerminalLegacyEligibility(input: Readonly<{
  clinicId: string;
  cutoff: Date;
  eventIds: readonly string[];
}>): Promise<Map<string, boolean>> {
  if (input.eventIds.length === 0) return new Map();
  const idsJson = JSON.stringify(input.eventIds);
  const result = await db.execute<EligibilityRow>(sql`
    with reviewed as (
      select value::uuid as event_id
      from jsonb_array_elements_text(${idsJson}::jsonb)
    )
    select
      event.id::text as event_id,
      (
        event.organization_id = ${input.clinicId}::uuid
        and event.processing_status in ('processed', 'ignored')
        and event.received_at < ${input.cutoff}
        and event.processed_at is not null
        and event.processed_at < ${input.cutoff}
        and event.stream_id is null
        and event.stream_generation is null
        and event.claim_token is null
        and event.claim_token_digest is null
        and event.claim_job_id is null
        and event.claimed_at is null
        and not exists (
          select 1 from jobs job where job.inbound_event_id = event.id
        )
        and not exists (
          select 1
          from outbound_messages outbound
          where outbound.organization_id = event.organization_id
            and (
              outbound.authorization_inbound_event_id = event.id
              or outbound.payload->>'turnId' = event.id::text
            )
            and outbound.status not in ('sent', 'cancelled')
        )
      ) as eligible
    from reviewed
    join inbound_events event on event.id = reviewed.event_id
    where event.organization_id = ${input.clinicId}::uuid
  `);
  return new Map(result.rows.map((row) => [row.event_id, row.eligible]));
}
