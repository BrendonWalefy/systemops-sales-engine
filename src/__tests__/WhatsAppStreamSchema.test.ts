import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/infrastructure/db/schema";
import {
  cleanupEmbeddedAuthorityDatabase,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "@/__tests__/helpers/embedded-authority-database";

type SchemaExport = keyof typeof schema;
type PgTableInput = Parameters<typeof getTableConfig>[0];

function enumValues(exportName: SchemaExport): string[] {
  const value = schema[exportName] as unknown as { enumValues?: string[] };
  expect(value, `${exportName} must be exported`).toBeDefined();
  expect(value.enumValues, `${exportName} must be a PostgreSQL enum`).toBeDefined();
  return value.enumValues!;
}

function tableConfig(exportName: string) {
  const value = (schema as Record<string, unknown>)[exportName];
  expect(value, `${exportName} must be exported`).toBeDefined();
  return getTableConfig(value as PgTableInput);
}

function indexNames(values: Array<{ config: { name?: string } }>): string[] {
  return values.flatMap((value) => value.config.name ? [value.config.name] : []);
}

function foreignKeyNames(values: Array<{ getName(): string }>): string[] {
  return values.map((value) => value.getName());
}

function checkNames(values: Array<{ name: string }>): string[] {
  return values.map((value) => value.name);
}

function uniqueNames(values: Array<{ name?: string }>): string[] {
  return values.flatMap((value) => value.name ? [value.name] : []);
}

describe("WhatsApp durable stream authority schema", () => {
  it("declares the approved durable authority enums", () => {
    expect(enumValues("whatsappStreamStateEnum" as SchemaExport)).toEqual([
      "provisional",
      "active",
      "retired",
    ]);
    expect(enumValues("whatsappStreamRetirementReasonEnum" as SchemaExport)).toEqual([
      "alias_convergence",
      "conversation_convergence",
      "manual",
    ]);
    expect(enumValues("whatsappStreamAliasKindEnum" as SchemaExport)).toEqual([
      "phone",
      "whatsapp_lid",
      "provider_thread",
    ]);
    expect(enumValues("outboundAuthorizationKindEnum" as SchemaExport)).toEqual([
      "live_stream_reply",
      "follow_up",
      "reminder",
      "campaign",
      "human_manual",
      "operational",
      "system",
      "recovery",
      "legacy",
    ]);
    expect(enumValues("inboundEventProcessingStatusEnum")).toEqual([
      "pending",
      "processing",
      "processed",
      "failed",
      "ignored",
      "identity_conflict",
      "history_only",
    ]);
  });

  it("declares stream and non-null provider-scope alias authority", () => {
    const streams = tableConfig("whatsappStreams");
    expect(streams.columns.map((column) => column.name)).toEqual([
      "id",
      "organization_id",
      "conversation_id",
      "state",
      "current_generation",
      "latest_inbound_event_id",
      "quiet_until",
      "conversation_stream_order",
      "bound_at",
      "retired_at",
      "retirement_reason",
      "created_at",
      "updated_at",
    ]);
    expect(streams.columns.find((column) => column.name === "current_generation")).toMatchObject({
      columnType: "PgBigInt53",
      dataType: "number",
      notNull: true,
    });
    expect(uniqueNames(streams.uniqueConstraints)).toContain(
      "whatsapp_streams_id_org_unique",
    );
    expect(indexNames(streams.indexes)).toEqual(expect.arrayContaining([
      "whatsapp_streams_active_conversation_unique",
      "whatsapp_streams_conversation_order_unique",
      "whatsapp_streams_org_state_updated_idx",
      "whatsapp_streams_conversation_history_idx",
      "whatsapp_streams_org_quiet_generation_idx",
    ]));
    expect(foreignKeyNames(streams.foreignKeys)).toEqual(expect.arrayContaining([
      "whatsapp_streams_conversation_org_fk",
      "whatsapp_streams_latest_inbound_event_id_inbound_events_id_fk",
    ]));
    expect(checkNames(streams.checks)).toEqual(expect.arrayContaining([
      "whatsapp_streams_current_generation_check",
      "whatsapp_streams_conversation_binding_check",
      "whatsapp_streams_conversation_order_check",
      "whatsapp_streams_retirement_check",
    ]));

    const aliases = tableConfig("whatsappStreamAliases");
    expect(aliases.columns.find((column) => column.name === "provider_scope")?.notNull).toBe(true);
    expect(indexNames(aliases.indexes)).toEqual(expect.arrayContaining([
      "whatsapp_stream_aliases_active_identity_unique",
      "whatsapp_stream_aliases_stream_retired_idx",
    ]));
    expect(foreignKeyNames(aliases.foreignKeys)).toContain("whatsapp_stream_aliases_stream_org_fk");
  });

  it("expands inbound events and jobs with nullable durable claim authority", () => {
    const inbound = tableConfig("inboundEvents");
    for (const columnName of [
      "stream_id",
      "stream_generation",
      "registered_at",
      "claim_token",
      "claim_token_digest",
      "claim_job_id",
      "claimed_at",
    ]) {
      expect(inbound.columns.find((column) => column.name === columnName)).toMatchObject({
        notNull: false,
      });
    }
    expect(inbound.columns.find((column) => column.name === "stream_generation")).toMatchObject({
      columnType: "PgBigInt53",
      dataType: "number",
    });
    expect(indexNames(inbound.indexes)).toEqual(expect.arrayContaining([
      "inbound_events_org_provider_message_unique",
      "inbound_events_stream_generation_unique",
      "inbound_events_authority_tuple_unique",
      "inbound_events_stream_generation_id_idx",
      "inbound_events_claim_job_idx",
    ]));
    expect(foreignKeyNames(inbound.foreignKeys)).toEqual(expect.arrayContaining([
      "inbound_events_stream_org_fk",
      "inbound_events_claim_job_id_jobs_id_fk",
    ]));
    expect(checkNames(inbound.checks)).toEqual(expect.arrayContaining([
      "inbound_events_stream_tuple_check",
      "inbound_events_stream_generation_check",
      "inbound_events_claim_token_check",
      "inbound_events_claim_token_format_check",
      "inbound_events_claim_job_check",
    ]));

    const jobs = tableConfig("jobs");
    expect(jobs.columns.find((column) => column.name === "inbound_event_id")).toMatchObject({
      notNull: false,
    });
    expect(indexNames(jobs.indexes)).toEqual(expect.arrayContaining([
      "jobs_queue_dedupe_key_idx",
      "jobs_inbound_event_unique",
      "jobs_queue_status_run_at_inbound_idx",
    ]));
  });

  it("persists canonical history and outbound authorization references", () => {
    const messages = tableConfig("messages");
    expect(indexNames(messages.indexes)).toEqual(expect.arrayContaining([
      "messages_inbound_event_unique",
      "messages_conversation_stream_generation_idx",
    ]));
    expect(foreignKeyNames(messages.foreignKeys)).toContain("messages_inbound_authority_fk");
    expect(messages.columns.find((column) => column.name === "stream_generation")).toMatchObject({
      columnType: "PgBigInt53",
      dataType: "number",
      notNull: false,
    });

    const outbound = tableConfig("outboundMessages");
    for (const columnName of [
      "authorization_kind",
      "authorization_stream_id",
      "authorization_generation",
      "authorization_inbound_event_id",
      "authorization_claim_job_id",
      "authorization_claim_token_digest",
      "authorization_version",
    ]) {
      expect(outbound.columns.find((column) => column.name === columnName)).toMatchObject({
        notNull: false,
      });
    }
    expect(indexNames(outbound.indexes)).toEqual(expect.arrayContaining([
      "outbound_messages_live_stream_authority_unique",
      "outbound_messages_authority_status_idx",
    ]));
    expect(foreignKeyNames(outbound.foreignKeys)).toEqual(expect.arrayContaining([
      "outbound_messages_authorization_stream_org_fk",
      "outbound_messages_authorization_inbound_fk",
      "outbound_messages_authorization_claim_job_id_jobs_id_fk",
    ]));
  });

  it("adds the tenant binding key and durable organization activation fence", () => {
    const conversations = tableConfig("conversations");
    expect(uniqueNames(conversations.uniqueConstraints)).toContain(
      "conversations_id_org_unique",
    );

    const authority = tableConfig("conversationAuthority");
    expect(authority.columns.map((column) => column.name)).toEqual([
      "organization_id",
      "version",
      "activated_at",
      "activated_by",
      "updated_at",
    ]);
    expect(checkNames(authority.checks)).toContain("conversation_authority_version_check");
  });

  it("declares one global fail-closed runtime control with monotonic versions", () => {
    const control = tableConfig("conversationRuntimeControl");
    expect(control.columns.map((column) => column.name)).toEqual([
      "key",
      "live_outbound_enabled",
      "version",
      "updated_at",
      "updated_by",
    ]);
    expect(control.columns.find((column) => column.name === "key")).toMatchObject({
      notNull: true,
      primary: true,
    });
    expect(control.columns.find(
      (column) => column.name === "live_outbound_enabled",
    )).toMatchObject({
      dataType: "boolean",
      notNull: true,
      hasDefault: true,
    });
    expect(control.columns.find((column) => column.name === "version")).toMatchObject({
      columnType: "PgBigInt53",
      dataType: "number",
      notNull: true,
      hasDefault: true,
    });
    expect(control.columns.find((column) => column.name === "updated_at")).toMatchObject({
      notNull: true,
      hasDefault: true,
    });
    expect(control.columns.find((column) => column.name === "updated_by")).toMatchObject({
      notNull: true,
    });
    expect(checkNames(control.checks)).toEqual(expect.arrayContaining([
      "conversation_runtime_control_global_key_check",
      "conversation_runtime_control_version_check",
    ]));
    expect(control.indexes).toHaveLength(0);
  });
});

describe("WhatsApp durable stream authority generated migrations", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let database: ReturnType<typeof drizzleNodePostgres> | undefined;

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    database = drizzleNodePostgres(runtime.pool);
    await migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
  });

  afterAll(async () => {
    await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
  });

  it("applies every authority table, constraint, index, and nullable expand column", async () => {
    const db = database!;
    const tables = await db.execute<{ name: string | null }>(sql`
      select to_regclass(name)::text as name
      from unnest(array[
        'public.conversation_runtime_control',
        'public.whatsapp_streams',
        'public.whatsapp_stream_aliases',
        'public.conversation_authority'
      ]) as requested(name)
      order by name
    `);
    expect(tables.rows.map((row) => row.name)).toEqual([
      "conversation_authority",
      "conversation_runtime_control",
      "whatsapp_stream_aliases",
      "whatsapp_streams",
    ]);

    const constraints = await db.execute<{ conname: string }>(sql`
      select conname
      from pg_constraint
      where conname = any(array[
        'whatsapp_streams_conversation_org_fk',
        'whatsapp_stream_aliases_stream_org_fk',
        'inbound_events_stream_org_fk',
        'inbound_events_claim_job_id_jobs_id_fk',
        'jobs_inbound_event_id_inbound_events_id_fk',
        'messages_inbound_authority_fk',
        'outbound_messages_authorization_stream_org_fk',
        'outbound_messages_authorization_inbound_fk',
        'outbound_messages_authorization_claim_job_id_jobs_id_fk',
        'conversation_authority_version_check',
        'conversation_runtime_control_global_key_check',
        'conversation_runtime_control_version_check'
      ])
      order by conname
    `);
    expect(constraints.rows.map((row) => row.conname)).toHaveLength(12);

    const indexes = await db.execute<{ indexname: string }>(sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname = any(array[
          'inbound_events_org_provider_message_unique',
          'inbound_events_stream_generation_unique',
          'jobs_queue_dedupe_key_idx',
          'jobs_inbound_event_unique',
          'messages_inbound_event_unique',
          'outbound_messages_live_stream_authority_unique',
          'whatsapp_stream_aliases_active_identity_unique',
          'whatsapp_streams_active_conversation_unique'
        ])
      order by indexname
    `);
    expect(indexes.rows.map((row) => row.indexname)).toHaveLength(8);

    const oldProviderIndex = await db.execute<{ name: string | null }>(sql`
      select to_regclass('public.inbound_events_provider_message_unique')::text as name
    `);
    expect(oldProviderIndex.rows[0]?.name).toBeNull();

    const expandedColumns = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'inbound_events' and column_name in (
            'stream_id', 'stream_generation', 'registered_at', 'claim_token',
            'claim_token_digest', 'claim_job_id', 'claimed_at'
          ))
          or (table_name = 'jobs' and column_name = 'inbound_event_id')
          or (table_name = 'messages' and column_name in (
            'inbound_event_id', 'stream_id', 'stream_generation'
          ))
          or (table_name = 'outbound_messages' and column_name like 'authorization_%')
        )
      order by table_name, column_name
    `);
    expect(expandedColumns.rows).toHaveLength(18);
    expect(expandedColumns.rows.every((row) => row.is_nullable === "YES")).toBe(true);
  });
});

async function createMigrationPrefix(maxIndex: number): Promise<string> {
  const source = join(process.cwd(), "drizzle");
  const destination = await mkdtemp(join(tmpdir(), "systemops-migrations-"));
  await mkdir(join(destination, "meta"));

  const files = await readdir(source);
  for (const file of files) {
    const match = file.match(/^(\d+).+\.sql$/);
    if (match && Number(match[1]) <= maxIndex) {
      await cp(join(source, file), join(destination, file));
    }
  }

  const journal = JSON.parse(
    await readFile(join(source, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number }>; [key: string]: unknown };
  journal.entries = journal.entries.filter((entry) => entry.idx <= maxIndex);
  await writeFile(
    join(destination, "meta", "_journal.json"),
    `${JSON.stringify(journal, null, 2)}\n`,
  );
  return destination;
}

describe("WhatsApp authority migration over current-schema data", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let baselineMigrations: string | undefined;

  afterAll(async () => {
    try {
      await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
    } finally {
      if (baselineMigrations) {
        await rm(baselineMigrations, { recursive: true, force: true });
      }
    }
  });

  it("preserves historical rows while replacing provider uniqueness in order", async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    const db = drizzleNodePostgres(runtime.pool);
    baselineMigrations = await createMigrationPrefix(99);
    await migrate(db, { migrationsFolder: baselineMigrations });

    const organization = await db.execute<{ id: string }>(sql`
      insert into organizations (
        name, slug, specialty, city, auto_reply_enabled, operational_status, is_test
      ) values (
        'Authority Migration Fixture',
        'authority-migration-fixture',
        'dental',
        'São Paulo',
        false,
        'test',
        true
      )
      returning id::text
    `);
    const organizationId = organization.rows[0]!.id;
    const event = await db.execute<{ id: string }>(sql`
      insert into inbound_events (
        organization_id, provider, provider_message_id, conversation_key,
        payload, dedupe_key, processing_status, received_at
      ) values (
        ${organizationId}::uuid,
        'z_api',
        'historical-provider-message',
        'historical-conversation',
        '{}'::jsonb,
        'historical-dedupe',
        'processed',
        '2026-08-24T12:00:00.000Z'::timestamptz
      )
      returning id::text
    `);
    const eventId = event.rows[0]!.id;

    await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });

    const retained = await db.execute<{
      id: string;
      stream_id: string | null;
      stream_generation: string | null;
      claim_token: string | null;
    }>(sql`
      select id::text, stream_id::text, stream_generation::text, claim_token
      from inbound_events
      where id = ${eventId}::uuid
    `);
    expect(retained.rows).toEqual([{
      id: eventId,
      stream_id: null,
      stream_generation: null,
      claim_token: null,
    }]);

    const providerIndexes = await db.execute<{ indexname: string }>(sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'inbound_events'
        and indexname in (
          'inbound_events_provider_message_unique',
          'inbound_events_org_provider_message_unique'
        )
      order by indexname
    `);
    expect(providerIndexes.rows.map((row) => row.indexname)).toEqual([
      "inbound_events_org_provider_message_unique",
    ]);
  });
});
