import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";

export const AUTHORITY_VALIDATION_METRICS = [
  "unresolved_events",
  "partial_claims",
  "identity_conflicts",
  "duplicate_generations",
  "duplicate_active_aliases",
  "active_alias_conflicts",
  "active_orphan_streams",
  "multiple_active_streams_per_conversation",
  "process_job_orphans",
  "invalid_outbound_authorization",
] as const;

export type AuthorityValidationMetric = typeof AUTHORITY_VALIDATION_METRICS[number];
export type AuthorityValidationIssue = Readonly<{
  metric: AuthorityValidationMetric;
  count: number;
}>;
export type AuthorityValidationReport = Readonly<{
  clinicId: string;
  clean: boolean;
  issues: readonly string[];
  metrics: readonly AuthorityValidationIssue[];
}>;

type MetricRow = { metric: AuthorityValidationMetric; count: number | string };

export async function validateWhatsAppStreamAuthority(
  clinicId: string,
): Promise<AuthorityValidationReport> {
  assertUuid(clinicId, "clinic id");
  const result = await db.execute<MetricRow>(sql`
    select 'unresolved_events' as metric, count(*)::bigint as count
    from inbound_events event
    where event.organization_id = ${clinicId}::uuid
      and (event.stream_id is null or event.stream_generation is null)
      and event.processing_status <> 'identity_conflict'
    union all
    select 'partial_claims', count(*)::bigint
    from inbound_events event
    where event.organization_id = ${clinicId}::uuid
      and not (
        (event.claim_token is null and event.claim_token_digest is null and event.claimed_at is null)
        or
        (event.claim_token is not null and event.claim_token_digest is not null and event.claimed_at is not null)
      )
    union all
    select 'identity_conflicts', count(*)::bigint
    from inbound_events event
    where event.organization_id = ${clinicId}::uuid
      and event.processing_status = 'identity_conflict'
    union all
    select 'duplicate_generations', count(*)::bigint from (
      select event.stream_id, event.stream_generation
      from inbound_events event
      where event.organization_id = ${clinicId}::uuid
        and event.stream_id is not null and event.stream_generation is not null
      group by event.stream_id, event.stream_generation having count(*) > 1
    ) duplicate
    union all
    select 'duplicate_active_aliases', count(*)::bigint from (
      select alias.kind, alias.provider_scope, alias.normalized_value
      from whatsapp_stream_aliases alias
      where alias.organization_id = ${clinicId}::uuid and alias.retired_at is null
      group by alias.kind, alias.provider_scope, alias.normalized_value having count(*) > 1
    ) duplicate
    union all
    select 'active_alias_conflicts', count(*)::bigint
    from whatsapp_stream_aliases alias
    join whatsapp_streams stream on stream.id = alias.stream_id
    where alias.organization_id = ${clinicId}::uuid
      and alias.retired_at is null and stream.state <> 'active'
    union all
    select 'active_orphan_streams', count(*)::bigint
    from whatsapp_streams stream
    where stream.organization_id = ${clinicId}::uuid and stream.state = 'active'
      and not exists (
        select 1 from whatsapp_stream_aliases alias
        where alias.stream_id = stream.id and alias.retired_at is null
      )
    union all
    select 'multiple_active_streams_per_conversation', count(*)::bigint from (
      select stream.conversation_id
      from whatsapp_streams stream
      where stream.organization_id = ${clinicId}::uuid
        and stream.state = 'active' and stream.conversation_id is not null
      group by stream.conversation_id having count(*) > 1
    ) duplicate
    union all
    select 'process_job_orphans', count(*)::bigint
    from inbound_events event
    where event.organization_id = ${clinicId}::uuid
      and event.processing_status in ('pending', 'processing', 'failed')
      and event.stream_id is not null
      and not exists (
        select 1 from jobs job
        where job.inbound_event_id = event.id and job.queue = 'message.process'
      )
    union all
    select 'invalid_outbound_authorization', count(*)::bigint
    from outbound_messages outbound
    left join conversation_authority authority
      on authority.organization_id = outbound.organization_id
    where outbound.organization_id = ${clinicId}::uuid and (
      (coalesce(authority.version, 0) >= 2 and (
        outbound.authorization_kind is null or outbound.authorization_kind = 'legacy'
      ))
      or (outbound.authorization_kind = 'live_stream_reply' and not exists (
        select 1 from inbound_events event
        where event.id = outbound.authorization_inbound_event_id
          and event.organization_id = outbound.organization_id
          and event.stream_id = outbound.authorization_stream_id
          and event.stream_generation = outbound.authorization_generation
          and event.claim_job_id = outbound.authorization_claim_job_id
          and event.claim_token_digest = outbound.authorization_claim_token_digest
      ))
      or (outbound.authorization_kind <> 'live_stream_reply' and (
        outbound.authorization_stream_id is not null
        or outbound.authorization_generation is not null
        or outbound.authorization_inbound_event_id is not null
        or outbound.authorization_claim_job_id is not null
        or outbound.authorization_claim_token_digest is not null
      ))
    )
  `);
  const metrics = result.rows.map((row) => ({ metric: row.metric, count: Number(row.count) }));
  const issues = metrics.filter(({ count }) => count > 0)
    .map(({ metric, count }) => `${metric}=${count}`);
  return { clinicId, clean: issues.length === 0, issues, metrics };
}

export function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
}

async function main(): Promise<void> {
  const clinicId = valueAfter("--clinic-id", process.argv.slice(2));
  if (!clinicId) throw new Error("--clinic-id is required");
  const report = await validateWhatsAppStreamAuthority(clinicId);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.clean) process.exitCode = 1;
}

function valueAfter(flag: string, argv: readonly string[]): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "authority validation failed"}\n`);
    process.exitCode = 1;
  });
}
