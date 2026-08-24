import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import { buildAuthorityBackfillEvidenceQuery } from "../../scripts/backfill-whatsapp-stream-authority";
import {
  cleanupEmbeddedAuthorityDatabase,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "@/__tests__/helpers/embedded-authority-database";

type ExplainNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows"?: number;
  "Plan Rows"?: number;
  "Rows Removed by Filter"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: ExplainNode[];
};

type ExplainDocument = {
  Plan: ExplainNode;
  "Planning Time": number;
  "Execution Time": number;
};

const AUTHORITY_TABLES = new Set([
  "inbound_events",
  "jobs",
  "messages",
  "conversations",
  "whatsapp_stream_aliases",
  "whatsapp_streams",
  "outbound_messages",
]);

describe("WhatsApp stream authority performance and lock isolation", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let clinicId = "";
  let targetStreamId = "";
  let secondStreamId = "";
  let targetEventId = "";
  let targetJobId = "";
  let backfillEvidenceEventId = "";
  const measurements: Array<Record<string, string | number>> = [];

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    const database = drizzleNodePostgres(runtime.pool);
    await migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
    const client = await runtime.pool.connect();
    try {
      const organization = await client.query<{ id: string }>(`
        insert into organizations (name, slug, specialty, operational_status, is_test)
        values ('Authority Performance', 'authority-performance', 'dental', 'test', true)
        returning id::text
      `);
      clinicId = organization.rows[0]!.id;
      await client.query(`
        insert into whatsapp_streams (
          id, organization_id, state, current_generation, created_at, updated_at
        )
        select gen_random_uuid(), $1::uuid, 'active', 100, clock_timestamp(), clock_timestamp()
        from generate_series(1, 100)
      `, [clinicId]);
      const streams = await client.query<{ id: string }>(`
        select id::text from whatsapp_streams
        where organization_id = $1::uuid and state = 'active'
        order by id
      `, [clinicId]);
      targetStreamId = streams.rows[0]!.id;
      secondStreamId = streams.rows[1]!.id;
      await client.query(`
        insert into whatsapp_stream_aliases (
          organization_id, kind, provider_scope, normalized_value, stream_id
        )
        select $1::uuid, 'provider_thread', 'z_api',
               'performance-thread-' || row_number() over (order by stream.id), stream.id
        from whatsapp_streams stream
        where stream.organization_id = $1::uuid and stream.state = 'active'
      `, [clinicId]);
      await client.query(`
        with numbered_streams as (
          select stream.id, row_number() over (order by stream.id) as stream_number
          from whatsapp_streams stream
          where stream.organization_id = $1::uuid and stream.state = 'active'
        )
        insert into whatsapp_stream_aliases (
          organization_id, kind, provider_scope, normalized_value, stream_id
        )
        select $1::uuid, 'provider_thread', 'z_api',
               'performance-extra-' || numbered.stream_number || '-' || alias_number,
               numbered.id
        from numbered_streams numbered
        cross join generate_series(1, 99) alias_number
      `, [clinicId]);
      await client.query(`
        with numbered_streams as (
          select stream.id, row_number() over (order by stream.id) as stream_number
          from whatsapp_streams stream
          where stream.organization_id = $1::uuid and stream.state = 'active'
        )
        insert into inbound_events (
          organization_id, provider, provider_message_id, conversation_key,
          payload, dedupe_key, processing_status, received_at, processed_at,
          stream_id, stream_generation, registered_at
        )
        select $1::uuid, 'z_api',
               'performance-' || numbered.stream_number || '-' || generation,
               'performance-thread-' || numbered.stream_number,
               jsonb_build_object('generation', generation),
               'performance:' || numbered.stream_number || ':' || generation,
               'processed', clock_timestamp(), clock_timestamp(),
               numbered.id, generation, clock_timestamp()
        from numbered_streams numbered
        cross join generate_series(1, 100) generation
      `, [clinicId]);
      await client.query(`
        insert into jobs (
          queue, status, payload, dedupe_key, inbound_event_id, run_at
        )
        select 'message.process', 'done', jsonb_build_object('inboundEventId', event.id::text),
               'inbound-event:' || event.id::text, event.id, event.received_at
        from inbound_events event where event.organization_id = $1::uuid
      `, [clinicId]);
      const target = await client.query<{ event_id: string; job_id: string }>(`
        select event.id::text as event_id, job.id::text as job_id
        from inbound_events event
        join jobs job on job.inbound_event_id = event.id and job.queue = 'message.process'
        where event.stream_id = $1::uuid and event.stream_generation = 100
      `, [targetStreamId]);
      targetEventId = target.rows[0]!.event_id;
      targetJobId = target.rows[0]!.job_id;
      await client.query(`
        update inbound_events set
          claim_token = $2, claim_token_digest = $3, claim_job_id = $4::uuid,
          claimed_at = clock_timestamp()
        where id = $1::uuid
      `, [targetEventId, "a".repeat(43), "b".repeat(43), targetJobId]);
      const lead = await client.query<{ id: string }>(`
        insert into leads (organization_id, channel, phone)
        values ($1::uuid, 'whatsapp', '5511999900000') returning id::text
      `, [clinicId]);
      const conversation = await client.query<{ id: string }>(`
        insert into conversations (organization_id, lead_id, channel)
        values ($1::uuid, $2::uuid, 'whatsapp') returning id::text
      `, [clinicId, lead.rows[0]!.id]);
      await client.query(`
        insert into outbound_messages (
          organization_id, conversation_id, channel, payload, delivery_kind,
          category, sequence, authorization_kind, authorization_stream_id,
          authorization_generation, authorization_inbound_event_id,
          authorization_claim_job_id, authorization_claim_token_digest,
          authorization_version
        ) values (
          $1::uuid, $2::uuid, 'whatsapp', '{}'::jsonb, 'text', 'reply', 1,
          'live_stream_reply', $3::uuid, 100, $4::uuid, $5::uuid, $6, 0
        )
      `, [clinicId, conversation.rows[0]!.id, targetStreamId, targetEventId, targetJobId, "b".repeat(43)]);
      await client.query(`
        insert into outbound_messages (
          organization_id, conversation_id, channel, payload, delivery_kind,
          category, sequence, authorization_kind, authorization_version
        )
        select $1::uuid, $2::uuid, 'whatsapp', '{}'::jsonb, 'text', 'reply',
               generation, 'system', 0
        from generate_series(2, 1000) generation
      `, [clinicId, conversation.rows[0]!.id]);
      await client.query(`
        insert into inbound_events (
          organization_id, provider, provider_message_id, conversation_key,
          payload, dedupe_key, processing_status, received_at
        )
        select $1::uuid, 'z_api', 'unresolved-' || generation,
               'unresolved-' || generation, '{}'::jsonb,
               'unresolved:' || generation, 'processed', clock_timestamp()
        from generate_series(1, 600) generation
      `, [clinicId]);
      const backfillEvidenceEvent = await client.query<{ id: string }>(`
        select id::text from inbound_events
        where organization_id = $1::uuid and provider_message_id = 'unresolved-1'
      `, [clinicId]);
      backfillEvidenceEventId = backfillEvidenceEvent.rows[0]!.id;
      await client.query(`
        insert into whatsapp_streams (
          organization_id, state, current_generation, retired_at,
          retirement_reason, created_at, updated_at
        )
        select $1::uuid, 'retired', 0, clock_timestamp() - interval '31 days',
               'alias_convergence', clock_timestamp() - interval '31 days', clock_timestamp()
        from generate_series(1, 10000)
      `, [clinicId]);
      await client.query("analyze");
    } finally {
      client.release();
    }
  }, 30_000);

  afterAll(async () => {
    await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
  });

  it("uses bounded indexed authority plans at representative volume", async () => {
    const client = await runtime!.pool.connect();
    const cpuBefore = process.cpuUsage();
    const started = performance.now();
    try {
      const cases = [
        ["provider_dedupe", `select id from inbound_events where organization_id = $1::uuid and provider = 'z_api' and provider_message_id = 'performance-1-100'`, [clinicId], 50],
        ["alias_convergence", `select stream_id from whatsapp_stream_aliases where organization_id = $1::uuid and kind = 'provider_thread' and provider_scope = 'z_api' and normalized_value = 'performance-thread-1' and retired_at is null`, [clinicId], 50],
        ["generation_assignment", `select id from whatsapp_streams where id = $1::uuid and organization_id = $2::uuid for update`, [targetStreamId, clinicId], 50],
        ["claim", `select id from jobs where queue = 'message.process' and dedupe_key = $1`, [`inbound-event:${targetEventId}`], 50],
        ["bind", `select id from whatsapp_streams where organization_id = $1::uuid and id = $2::uuid`, [clinicId, targetStreamId], 50],
        ["outbox_authorization", `select id from outbound_messages where authorization_stream_id = $1::uuid and authorization_generation = 100 and authorization_inbound_event_id = $2::uuid`, [targetStreamId, targetEventId], 50],
        ["orphan_repair", `select id from inbound_events where processing_status in ('pending', 'failed') and received_at < clock_timestamp() order by received_at, id limit 50`, [], 50],
        ["backfill", `select id from inbound_events where organization_id = $1::uuid and stream_id is null and id > '00000000-0000-0000-0000-000000000000'::uuid order by id limit 500`, [clinicId], 1000],
        ["cleanup", `select id from whatsapp_streams where organization_id = $1::uuid and state = 'retired' and retirement_reason = 'alias_convergence' and retired_at < clock_timestamp() - interval '30 days' and id > '00000000-0000-0000-0000-000000000000'::uuid order by id limit 500`, [clinicId], 1000],
      ] as const;
      for (const [name, query, params, maxRows] of cases) {
        const document = await explain(client, query, [...params]);
        assertBoundedAuthorityPlan(name, document.Plan, maxRows);
        if (name === "backfill" || name === "cleanup") {
          expect(document.Plan["Actual Rows"] ?? 0).toBeLessThanOrEqual(500);
        }
        measurements.push({
          query: name,
          executionMs: round(document["Execution Time"]),
          planningMs: round(document["Planning Time"]),
          actualRows: document.Plan["Actual Rows"] ?? 0,
          plannedRows: document.Plan["Plan Rows"] ?? 0,
          rowsInspected: inspectedRows(document.Plan),
          sharedBufferBlocks: bufferBlocks(document.Plan),
        });
      }
      const dialect = new PgDialect();
      const evidenceQuery = dialect.sqlToQuery(buildAuthorityBackfillEvidenceQuery({
        clinicId,
        candidates: [{
          eventId: backfillEvidenceEventId,
          providerMessageId: "unresolved-1",
          aliases: [{
            kind: "provider_thread",
            providerScope: "z_api",
            normalizedValue: "performance-thread-1",
          }],
        }],
      }));
      const evidencePlan = await explain(client, evidenceQuery.sql, evidenceQuery.params);
      assertBoundedAuthorityPlan("backfill_evidence", evidencePlan.Plan, 50);
      measurements.push({
        query: "backfill_evidence",
        executionMs: round(evidencePlan["Execution Time"]),
        planningMs: round(evidencePlan["Planning Time"]),
        actualRows: evidencePlan.Plan["Actual Rows"] ?? 0,
        plannedRows: evidencePlan.Plan["Plan Rows"] ?? 0,
        rowsInspected: inspectedRows(evidencePlan.Plan),
        sharedBufferBlocks: bufferBlocks(evidencePlan.Plan),
      });
    } finally {
      client.release();
    }
    const elapsedMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuBefore);
    measurements.push({
      query: "representative_plan_suite",
      executionMs: round(elapsedMs),
      processCpuMs: round((cpu.user + cpu.system) / 1000),
    });
    expect(measurements).toHaveLength(11);
  });

  it("isolates different streams while serializing the same stream", async () => {
    const holder = await runtime!.pool.connect();
    const contender = await runtime!.pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from whatsapp_streams where id = $1::uuid for update", [targetStreamId]);
      await contender.query("begin");
      await contender.query("set local lock_timeout = '250ms'");
      const differentStarted = performance.now();
      await contender.query(`
        update whatsapp_streams set current_generation = current_generation + 1
        where id = $1::uuid
      `, [secondStreamId]);
      const differentStreamMs = performance.now() - differentStarted;
      await contender.query("commit");
      const blocked = await runtime!.pool.connect();
      let sameStreamMs = 0;
      try {
        await blocked.query("begin");
        await blocked.query("set local lock_timeout = '250ms'");
        const sameStarted = performance.now();
        await expect(blocked.query(`
          update whatsapp_streams set current_generation = current_generation + 1
          where id = $1::uuid
        `, [targetStreamId])).rejects.toMatchObject({ code: "55P03" });
        sameStreamMs = performance.now() - sameStarted;
        await blocked.query("rollback");
      } finally {
        blocked.release();
      }
      await holder.query("commit");
      measurements.push({
        query: "lock_isolation",
        differentStreamMs: round(differentStreamMs),
        sameStreamTimeoutMs: round(sameStreamMs),
      });
      expect(differentStreamMs).toBeLessThan(250);
      expect(sameStreamMs).toBeGreaterThanOrEqual(200);
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await contender.query("rollback").catch(() => undefined);
      holder.release();
      contender.release();
    }
  });

  it("introduces no polling, heartbeat, adapter, or continuously running worker", async () => {
    const { readFile } = await import("node:fs/promises");
    const files = [
      "src/infrastructure/repositories/drizzle-inbound-event-store.ts",
      "src/infrastructure/repositories/drizzle-job-queue.ts",
      "src/infrastructure/repositories/drizzle-outbound-message-store.ts",
      "scripts/backfill-whatsapp-stream-authority.ts",
      "scripts/cleanup-whatsapp-stream-authority.ts",
    ];
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    expect(source).not.toMatch(/setInterval|heartbeat|WebSocket|new Pool|while\s*\(\s*true\s*\)/);
    expect(source).not.toContain("db.transaction(");
    expect(measurements.find(({ query }) => query === "lock_isolation")).toBeDefined();
    process.stdout.write(`PR306_PERFORMANCE ${JSON.stringify(measurements)}\n`);
  });
});

async function explain(
  client: PoolClient,
  query: string,
  params: readonly unknown[],
): Promise<ExplainDocument> {
  const result = await client.query<{ "QUERY PLAN": ExplainDocument[] }>(
    `explain (analyze, buffers, format json) ${query}`,
    [...params],
  );
  return result.rows[0]!["QUERY PLAN"][0]!;
}

function walk(node: ExplainNode): ExplainNode[] {
  return [node, ...(node.Plans ?? []).flatMap(walk)];
}

function inspectedRows(node: ExplainNode): number {
  return walk(node).reduce((total, current) => total
    + (current["Actual Rows"] ?? 0)
    + (current["Rows Removed by Filter"] ?? 0), 0);
}

function bufferBlocks(node: ExplainNode): number {
  return walk(node).reduce((total, current) => total
    + (current["Shared Hit Blocks"] ?? 0)
    + (current["Shared Read Blocks"] ?? 0), 0);
}

function assertBoundedAuthorityPlan(name: string, plan: ExplainNode, maxRows: number): void {
  const scans = walk(plan).filter((node) =>
    node["Relation Name"] && AUTHORITY_TABLES.has(node["Relation Name"]));
  expect(scans.length, `${name} has no authority table scan`).toBeGreaterThan(0);
  for (const scan of scans) {
    const inspected = (scan["Actual Rows"] ?? 0) + (scan["Rows Removed by Filter"] ?? 0);
    expect(
      inspected,
      `${name} ${scan["Node Type"]} on ${scan["Relation Name"]} inspected ${inspected}`,
    ).toBeLessThanOrEqual(maxRows);
    if (scan["Node Type"] === "Seq Scan") {
      expect(inspected, `${name} performed an unbounded sequential scan`).toBeLessThanOrEqual(50);
    }
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
