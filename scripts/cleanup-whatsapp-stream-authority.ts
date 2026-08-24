import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  parseAuthorityBatchOptions,
  type AuthorityBatchOptions,
} from "./backfill-whatsapp-stream-authority";

export type AuthorityCleanupResult = Readonly<{
  mode: "dry-run" | "apply";
  selected: number;
  deleted: number;
  nextAfterId: string | null;
}>;

type CleanupRow = { stream_id: string };

export async function cleanupWhatsAppStreamAuthority(
  options: AuthorityBatchOptions,
): Promise<AuthorityCleanupResult> {
  const candidates = await db.execute<CleanupRow>(sql`
    select stream.id::text as stream_id
    from whatsapp_streams stream
    where stream.organization_id = ${options.clinicId}::uuid
      and stream.state = 'retired'
      and stream.retirement_reason = 'alias_convergence'
      and stream.retired_at < clock_timestamp() - interval '30 days'
      and (${options.afterId}::uuid is null or stream.id > ${options.afterId}::uuid)
      and not exists (select 1 from inbound_events event where event.stream_id = stream.id)
      and not exists (select 1 from messages message where message.stream_id = stream.id)
      and not exists (
        select 1 from outbound_messages outbound where outbound.authorization_stream_id = stream.id
      )
      and not exists (
        select 1 from whatsapp_stream_aliases alias
        where alias.stream_id = stream.id and alias.retired_at is null
      )
    order by stream.id
    limit ${options.batchSize}
  `);
  let deleted = 0;
  if (options.apply && candidates.rows.length > 0) {
    const ids = candidates.rows.map(({ stream_id }) => stream_id);
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    const result = await db.execute<{ id: string }>(sql`
      delete from whatsapp_streams stream
      where stream.organization_id = ${options.clinicId}::uuid
        and stream.id in (${idList})
        and stream.state = 'retired'
        and stream.retirement_reason = 'alias_convergence'
        and stream.retired_at < clock_timestamp() - interval '30 days'
        and not exists (select 1 from inbound_events event where event.stream_id = stream.id)
        and not exists (select 1 from messages message where message.stream_id = stream.id)
        and not exists (
          select 1 from outbound_messages outbound where outbound.authorization_stream_id = stream.id
        )
        and not exists (
          select 1 from whatsapp_stream_aliases alias
          where alias.stream_id = stream.id and alias.retired_at is null
        )
      returning stream.id::text
    `);
    deleted = result.rows.length;
  }
  return {
    mode: options.apply ? "apply" : "dry-run",
    selected: candidates.rows.length,
    deleted,
    nextAfterId: candidates.rows.at(-1)?.stream_id ?? null,
  };
}

async function main(): Promise<void> {
  const result = await cleanupWhatsAppStreamAuthority(parseAuthorityBatchOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "authority cleanup failed"}\n`);
    process.exitCode = 1;
  });
}
