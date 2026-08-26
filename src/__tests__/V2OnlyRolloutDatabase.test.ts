import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtomicDatabaseBatch } from "@/infrastructure/db/atomic-database-batch";
import {
  cleanupEmbeddedAuthorityDatabase,
  createEmbeddedAtomicDatabaseBatch,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "@/__tests__/helpers/embedded-authority-database";

const databaseMock = vi.hoisted(() => {
  let activeDb: unknown;
  const proxy = new Proxy({}, {
    get(_target, property) {
      if (!activeDb) throw new Error("database test client is not initialized");
      const value = (activeDb as Record<PropertyKey, unknown>)[property];
      return typeof value === "function" ? value.bind(activeDb) : value;
    },
  });
  return {
    proxy,
    set(value: unknown) {
      activeDb = value;
    },
  };
});

vi.mock("@/infrastructure/db/client", () => ({ db: databaseMock.proxy }));

const LAB_ID = "92fe7ecf-f383-4ddc-8c4e-53271af8e3a0";

type TestDatabase = ReturnType<typeof drizzleNodePostgres>;

async function waitForBlockedQuery(
  runtime: EmbeddedAuthorityDatabase,
  queryPattern: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await runtime.pool.query<{ blocked: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
         where datname = current_database()
           and pid <> pg_backend_pid()
           and wait_event_type = 'Lock'
           and query ilike $1
       ) as blocked`,
      [queryPattern],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected PostgreSQL lock wait for ${queryPattern}`);
}

describe("V2-only rollout control — PostgreSQL concurrency", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let database: TestDatabase;

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    database = drizzleNodePostgres(runtime.pool);
    databaseMock.set(database);
    await migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
  });

  afterAll(async () => {
    try {
      await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
    } finally {
      databaseMock.set(undefined);
    }
  });

  beforeEach(async () => {
    await database.execute(sql`truncate table organizations cascade`);
    await database.execute(sql`truncate table conversation_runtime_control`);
  });

  it("serializes a concurrent inbound job after the exact tenant activation commit", async () => {
    const eventId = randomUUID();
    const jobId = randomUUID();
    const streamId = randomUUID();
    await database.execute(sql`
      insert into organizations (
        id, name, slug, specialty, operational_status, is_test, is_demo,
        auto_reply_enabled, live_automation_enabled, shadow_mode_enabled
      ) values (
        ${LAB_ID}::uuid, 'SystemOps Dental Lab', ${`systemops-lab-${randomUUID()}`},
        'dental', 'paused', true, false, true, false, false
      )
    `);
    await database.execute(sql`
      insert into conversation_authority (organization_id, version, activated_at, activated_by)
      values (${LAB_ID}::uuid, 2, now(), 'rollout-test')
    `);
    await database.execute(sql`
      insert into conversation_runtime_control (
        key, live_outbound_enabled, version, updated_by
      ) values ('global', true, 7, 'rollout-test')
    `);
    await database.execute(sql`
      insert into whatsapp_streams (
        id, organization_id, state, current_generation
      ) values (${streamId}::uuid, ${LAB_ID}::uuid, 'provisional', 1)
    `);
    await database.execute(sql`
      insert into inbound_events (
        id, organization_id, provider, provider_message_id, conversation_key,
        payload, dedupe_key, processing_status, stream_id, stream_generation,
        registered_at, processed_at
      ) values (
        ${eventId}::uuid, ${LAB_ID}::uuid, 'z_api', ${`provider-${eventId}`},
        ${`conversation-${eventId}`}, '{}'::jsonb, ${`event-${eventId}`},
        'processed', ${streamId}::uuid, 1, now(), now()
      )
    `);

    const blocker = await runtime!.pool.connect();
    let activation: Promise<boolean> | undefined;
    let insertion: Promise<unknown> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query(
        "select id from organizations where id = $1::uuid for update",
        [LAB_ID],
      );

      const rolloutControlModule = await import("../../scripts/control-v2-only-rollout");
      const activate = rolloutControlModule.compareAndSetTenantStatus as unknown as (
        input: Parameters<typeof rolloutControlModule.compareAndSetTenantStatus>[0],
        batch: AtomicDatabaseBatch,
      ) => Promise<boolean>;
      activation = activate({
        clinicId: LAB_ID,
        expectedStatus: "paused",
        nextStatus: "active",
        now: new Date("2026-08-26T00:00:00.000Z"),
      }, createEmbeddedAtomicDatabaseBatch(runtime!.pool));
      await waitForBlockedQuery(runtime!, "%update%organizations%");

      let insertionSettled = false;
      insertion = runtime!.pool.query(
        `insert into jobs (id, queue, payload, status, inbound_event_id, dedupe_key)
         values ($1::uuid, 'message.process', '{}'::jsonb, 'pending', $2::uuid, $3)`,
        [
          jobId,
          eventId,
          `job-${jobId}`,
        ],
      ).finally(() => {
        insertionSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(insertionSettled).toBe(false);
      await blocker.query("commit");
      await expect(activation).resolves.toBe(true);
      await expect(insertion).resolves.toBeDefined();

      const state = await database.execute<{
        operational_status: string;
        live_automation_enabled: boolean;
        job_count: string;
      }>(sql`
        select
          organization.operational_status,
          organization.live_automation_enabled,
          (select count(*) from jobs where id = ${jobId}::uuid)::text as job_count
        from organizations organization
        where organization.id = ${LAB_ID}::uuid
      `);
      expect(state.rows).toEqual([{
        operational_status: "active",
        live_automation_enabled: true,
        job_count: "1",
      }]);
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      blocker.release();
      await Promise.allSettled([activation, insertion].filter(Boolean) as Promise<unknown>[]);
    }
  });

  it("activates only SystemOps Lab while an active NC Beauty candidate remains closed", async () => {
    const ncBeautyId = randomUUID();
    await database.execute(sql`
      insert into organizations (
        id, name, slug, specialty, operational_status, is_test, is_demo,
        auto_reply_enabled, live_automation_enabled, shadow_mode_enabled
      ) values
        (${LAB_ID}::uuid, 'SystemOps Dental Lab', ${`exact-lab-${randomUUID()}`},
          'dental', 'paused', true, false, true, false, false),
        (${ncBeautyId}::uuid, 'NC Beauty', ${`exact-nc-${randomUUID()}`},
          'aesthetics', 'active', false, false, true, false, false)
    `);
    await database.execute(sql`
      insert into conversation_authority (organization_id, version, activated_at, activated_by)
      values
        (${LAB_ID}::uuid, 2, now(), 'exact-tenant-test'),
        (${ncBeautyId}::uuid, 2, now(), 'exact-tenant-test')
    `);
    await database.execute(sql`
      insert into conversation_runtime_control (
        key, live_outbound_enabled, version, updated_by
      ) values ('global', true, 4, 'exact-tenant-test')
    `);

    const rolloutControlModule = await import("../../scripts/control-v2-only-rollout");
    await expect(rolloutControlModule.compareAndSetTenantStatus({
      clinicId: LAB_ID,
      expectedStatus: "paused",
      nextStatus: "active",
      now: new Date("2026-08-26T00:00:00.000Z"),
    }, createEmbeddedAtomicDatabaseBatch(runtime!.pool))).resolves.toBe(true);

    const state = await database.execute<{
      id: string;
      operational_status: string;
      live_automation_enabled: boolean;
    }>(sql`
      select id::text, operational_status, live_automation_enabled
      from organizations
      where id in (${LAB_ID}::uuid, ${ncBeautyId}::uuid)
      order by id
    `);
    expect(state.rows.find((row) => row.id === LAB_ID)).toMatchObject({
      operational_status: "active",
      live_automation_enabled: true,
    });
    expect(state.rows.find((row) => row.id === ncBeautyId)).toMatchObject({
      operational_status: "active",
      live_automation_enabled: false,
    });
  });

  it("holds every rollout decision write behind one atomic global-opening fence", async () => {
    const otherClinicId = randomUUID();
    const streamId = randomUUID();
    const eventId = randomUUID();
    const jobId = randomUUID();
    const leadId = randomUUID();
    const conversationId = randomUUID();
    const outboundId = randomUUID();
    const aliasId = randomUUID();
    await database.execute(sql`
      insert into organizations (
        id, name, slug, specialty, operational_status, is_test, is_demo,
        auto_reply_enabled, live_automation_enabled, shadow_mode_enabled
      ) values
        (${LAB_ID}::uuid, 'SystemOps Dental Lab', ${`systemops-lab-${randomUUID()}`},
          'dental', 'paused', true, false, true, false, false),
        (${otherClinicId}::uuid, 'Other tenant', ${`other-${otherClinicId}`},
          'dental', 'paused', false, false, true, false, false)
    `);
    await database.execute(sql`
      insert into conversation_authority (organization_id, version, activated_at, activated_by)
      values
        (${LAB_ID}::uuid, 2, now(), 'rollout-test'),
        (${otherClinicId}::uuid, 2, now(), 'rollout-test')
    `);
    await database.execute(sql`
      insert into conversation_runtime_control (
        key, live_outbound_enabled, version, updated_by
      ) values ('global', false, 7, 'rollout-test')
    `);
    await database.execute(sql`
      insert into whatsapp_streams (id, organization_id, state, current_generation)
      values (${streamId}::uuid, ${LAB_ID}::uuid, 'provisional', 1)
    `);
    await database.execute(sql`
      insert into inbound_events (
        id, organization_id, provider, provider_message_id, conversation_key,
        payload, dedupe_key, processing_status, stream_id, stream_generation,
        registered_at, processed_at
      ) values (
        ${eventId}::uuid, ${LAB_ID}::uuid, 'z_api', ${`provider-${eventId}`},
        ${`conversation-${eventId}`}, '{}'::jsonb, ${`event-${eventId}`},
        'processed', ${streamId}::uuid, 1, now(), now()
      )
    `);
    await database.execute(sql`
      insert into leads (id, organization_id, channel)
      values (${leadId}::uuid, ${LAB_ID}::uuid, 'whatsapp')
    `);
    await database.execute(sql`
      insert into conversations (id, organization_id, lead_id, channel)
      values (${conversationId}::uuid, ${LAB_ID}::uuid, ${leadId}::uuid, 'whatsapp')
    `);

    const blocker = await runtime!.pool.connect();
    let opening: Promise<boolean> | undefined;
    const concurrentWrites: Promise<unknown>[] = [];
    try {
      await blocker.query("begin");
      await blocker.query(
        "select key from conversation_runtime_control where key = 'global' for update",
      );

      const rolloutControlModule = await import("../../scripts/control-v2-only-rollout");
      opening = rolloutControlModule.compareAndSetGlobal({
        clinicId: LAB_ID,
        expectedVersion: 7,
        liveOutboundEnabled: true,
        actor: "rollout-test",
        now: new Date("2026-08-26T00:00:00.000Z"),
      }, createEmbeddedAtomicDatabaseBatch(runtime!.pool));
      await waitForBlockedQuery(runtime!, "%update%conversation_runtime_control%");
      await expect(Promise.race([
        opening.then((value) => `resolved:${value}`),
        new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 25)),
      ])).resolves.toBe("pending");

      const writes = [
        runtime!.pool.query(
          "update organizations set operational_status = 'active' where id = $1::uuid",
          [otherClinicId],
        ),
        runtime!.pool.query(
          "update conversation_authority set activated_by = 'concurrent' where organization_id = $1::uuid",
          [LAB_ID],
        ),
        runtime!.pool.query(
          `insert into jobs (id, queue, payload, status, inbound_event_id, dedupe_key)
           values ($1::uuid, 'message.process', '{}'::jsonb, 'pending', $2::uuid, $3)`,
          [jobId, eventId, `job-${jobId}`],
        ),
        runtime!.pool.query(
          `insert into outbound_messages (
             id, organization_id, conversation_id, channel, payload,
             delivery_kind, category, sequence, status, authorization_kind,
             authorization_version
           ) values (
             $1::uuid, $2::uuid, $3::uuid, 'whatsapp', '{}'::jsonb,
             'text', 'reply', 1, 'pending', 'system', 2
           )`,
          [outboundId, LAB_ID, conversationId],
        ),
        runtime!.pool.query(
          "update whatsapp_streams set current_generation = 2 where id = $1::uuid",
          [streamId],
        ),
        runtime!.pool.query(
          `insert into whatsapp_stream_aliases (
             id, organization_id, kind, provider_scope, normalized_value, stream_id
           ) values ($1::uuid, $2::uuid, 'phone', 'z_api', $3, $4::uuid)`,
          [aliasId, LAB_ID, `concurrent-alias-${aliasId}`, streamId],
        ),
      ];
      concurrentWrites.push(...writes);
      const earlyOutcomes = await Promise.all(writes.map((write) => Promise.race([
        write.then(
          () => "resolved",
          (error: unknown) => `rejected:${String((error as { code?: unknown }).code ?? "unknown")}`,
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 50)),
      ])));
      expect(earlyOutcomes).toEqual([
        "pending", "pending", "pending", "pending", "pending", "pending",
      ]);

      await blocker.query("commit");
      await expect(opening).resolves.toBe(true);
      await Promise.all(concurrentWrites);

      const state = await database.execute<{
        live_outbound_enabled: boolean;
        other_status: string;
        other_live_permit: boolean;
      }>(sql`
        select
          control.live_outbound_enabled,
          other.operational_status as other_status,
          other.live_automation_enabled as other_live_permit
        from conversation_runtime_control control
        cross join organizations other
        where control.key = 'global'
          and other.id = ${otherClinicId}::uuid
      `);
      expect(state.rows).toEqual([{
        live_outbound_enabled: true,
        other_status: "active",
        other_live_permit: false,
      }]);
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      blocker.release();
      await Promise.allSettled([
        ...(opening ? [opening] : []),
        ...concurrentWrites,
      ]);
    }
  });

  it("rejects every pre-existing blocker before the version-zero global CAS", async () => {
    const otherClinicId = randomUUID();
    const leadId = randomUUID();
    const conversationId = randomUUID();
    const outboundId = randomUUID();
    const streamId = randomUUID();
    const eventId = randomUUID();
    const jobId = randomUUID();
    await database.execute(sql`
      insert into organizations (
        id, name, slug, specialty, operational_status, is_test, is_demo,
        auto_reply_enabled, live_automation_enabled, shadow_mode_enabled
      ) values
        (${LAB_ID}::uuid, 'SystemOps Dental Lab', ${`blocker-lab-${randomUUID()}`},
          'dental', 'paused', true, false, true, false, false),
        (${otherClinicId}::uuid, 'Other tenant', ${`blocker-other-${randomUUID()}`},
          'dental', 'active', false, false, true, true, false)
    `);
    await database.execute(sql`
      insert into conversation_authority (organization_id, version, activated_at, activated_by)
      values
        (${LAB_ID}::uuid, 2, now(), 'blocker-test'),
        (${otherClinicId}::uuid, 2, now(), 'blocker-test')
    `);
    const rolloutControlModule = await import("../../scripts/control-v2-only-rollout");
    const openVersionZero = () => rolloutControlModule.compareAndSetGlobal({
      clinicId: LAB_ID,
      expectedVersion: 0,
      liveOutboundEnabled: true,
      actor: "blocker-test",
      now: new Date("2026-08-26T00:00:00.000Z"),
    }, createEmbeddedAtomicDatabaseBatch(runtime!.pool));

    await expect(openVersionZero()).resolves.toBe(false);
    await database.execute(sql`
      update organizations set live_automation_enabled = false
      where id = ${otherClinicId}::uuid
    `);

    await database.execute(sql`
      insert into inbound_events (
        id, organization_id, provider, provider_message_id,
        conversation_key, payload, dedupe_key, processing_status
      ) values (
        ${eventId}::uuid, ${LAB_ID}::uuid, 'z_api', ${`conflict-${eventId}`},
        ${`conflict-${eventId}`}, '{}'::jsonb, ${`conflict-${eventId}`},
        'identity_conflict'
      )
    `);
    await expect(openVersionZero()).resolves.toBe(false);
    await database.execute(sql`delete from inbound_events where id = ${eventId}::uuid`);

    await database.execute(sql`
      insert into leads (id, organization_id, channel)
      values (${leadId}::uuid, ${LAB_ID}::uuid, 'whatsapp')
    `);
    await database.execute(sql`
      insert into conversations (id, organization_id, lead_id, channel)
      values (${conversationId}::uuid, ${LAB_ID}::uuid, ${leadId}::uuid, 'whatsapp')
    `);
    await database.execute(sql`
      insert into outbound_messages (
        id, organization_id, conversation_id, channel, payload,
        delivery_kind, category, sequence, status, authorization_kind,
        authorization_version
      ) values (
        ${outboundId}::uuid, ${LAB_ID}::uuid, ${conversationId}::uuid,
        'whatsapp', '{}'::jsonb, 'text', 'reply', 1, 'pending', 'system', 2
      )
    `);
    await expect(openVersionZero()).resolves.toBe(false);
    await database.execute(sql`delete from outbound_messages where id = ${outboundId}::uuid`);

    await database.execute(sql`
      insert into whatsapp_streams (id, organization_id, state, current_generation)
      values (${streamId}::uuid, ${LAB_ID}::uuid, 'provisional', 1)
    `);
    await database.execute(sql`
      insert into inbound_events (
        id, organization_id, provider, provider_message_id, conversation_key,
        payload, dedupe_key, processing_status, stream_id, stream_generation,
        registered_at, processed_at
      ) values (
        ${eventId}::uuid, ${LAB_ID}::uuid, 'z_api', ${`failed-${eventId}`},
        ${`failed-${eventId}`}, '{}'::jsonb, ${`failed-${eventId}`},
        'processed', ${streamId}::uuid, 1, now(), now()
      )
    `);
    await database.execute(sql`
      insert into jobs (id, queue, payload, status, inbound_event_id, dedupe_key)
      values (
        ${jobId}::uuid, 'message.process', '{}'::jsonb, 'failed',
        ${eventId}::uuid, ${`failed-job-${jobId}`}
      )
    `);
    await expect(openVersionZero()).resolves.toBe(false);
    await database.execute(sql`delete from jobs where id = ${jobId}::uuid`);
    await database.execute(sql`delete from inbound_events where id = ${eventId}::uuid`);
    await database.execute(sql`delete from whatsapp_streams where id = ${streamId}::uuid`);

    await expect(openVersionZero()).resolves.toBe(true);
    const control = await database.execute<{
      live_outbound_enabled: boolean;
      version: string;
    }>(sql`
      select live_outbound_enabled, version
      from conversation_runtime_control
      where key = 'global'
    `);
    expect(control.rows).toEqual([{ live_outbound_enabled: true, version: "1" }]);
  });

  it("pauses the exact tenant before the additive live-permit migration exists", async () => {
    const otherClinicId = randomUUID();
    await database.execute(sql`
      insert into organizations (
        id, name, slug, specialty, operational_status, is_test,
        auto_reply_enabled, shadow_mode_enabled
      ) values (
        ${LAB_ID}::uuid, 'SystemOps Dental Lab', ${`pre-expand-${randomUUID()}`},
        'dental', 'test', true, true, false
      ), (
        ${otherClinicId}::uuid, 'Other Tenant', ${`pre-expand-other-${randomUUID()}`},
        'dental', 'active', false, true, false
      )
    `);
    await database.execute(sql`
      alter table organizations drop column live_automation_enabled
    `);
    try {
      const rolloutControlModule = await import("../../scripts/control-v2-only-rollout");
      await expect(rolloutControlModule.compareAndSetTenantStatus({
        clinicId: LAB_ID,
        expectedStatus: "test",
        nextStatus: "paused",
        now: new Date("2026-08-26T00:00:00.000Z"),
      })).resolves.toBe(true);
      const state = await runtime!.pool.query<{ id: string; operational_status: string }>(
        "select id::text, operational_status from organizations where id = any($1::uuid[]) order by id",
        [[LAB_ID, otherClinicId]],
      );
      expect(state.rows).toEqual([
        { id: LAB_ID, operational_status: "paused" },
        { id: otherClinicId, operational_status: "active" },
      ].sort((left, right) => left.id.localeCompare(right.id)));
    } finally {
      await runtime!.pool.query(
        "alter table organizations add column live_automation_enabled boolean default false not null",
      );
    }
  });

  it("audits the pre-expand schema with missing V2 control structures fail-closed", async () => {
    await database.execute(sql`
      insert into organizations (
        id, name, slug, specialty, operational_status, is_test,
        auto_reply_enabled, shadow_mode_enabled
      ) values (
        ${LAB_ID}::uuid, 'SystemOps Dental Lab', ${`pre-expand-audit-${randomUUID()}`},
        'dental', 'active', true, true, false
      )
    `);
    await database.execute(sql`
      insert into conversation_authority (organization_id, version, activated_at, activated_by)
      values (${LAB_ID}::uuid, 2, now(), 'pre-expand-audit')
    `);
    await database.execute(sql`alter table organizations drop column live_automation_enabled`);
    await database.execute(sql`
      alter table conversation_runtime_control
      rename to conversation_runtime_control_pre_expand_test
    `);
    try {
      const audit = await import("../../scripts/audit-v2-only-rollout");
      await expect(audit.readV2OnlyRolloutTarget(LAB_ID)).resolves.toMatchObject({
        clinicId: LAB_ID,
        operationalStatus: "active",
        liveAutomationEnabled: false,
        authorityVersion: 2,
      });
      await expect(audit.readV2OnlyLiveTenants()).resolves.toEqual([{
        clinicId: LAB_ID,
        operationalStatus: "active",
        authorityVersion: 2,
      }]);
      await expect(audit.readV2OnlyRolloutRuntimeControl()).resolves.toEqual({
        liveOutboundEnabled: false,
        version: 0,
      });
      await expect(audit.readOtherTenantRolloutDigest(LAB_ID))
        .resolves.toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      await database.execute(sql`
        alter table conversation_runtime_control_pre_expand_test
        rename to conversation_runtime_control
      `);
      await runtime!.pool.query(
        "alter table organizations add column live_automation_enabled boolean default false not null",
      );
    }
  });

  it("keeps the other-tenant digest stable across 0103 and sensitive to full authority changes", async () => {
    const otherClinicId = randomUUID();
    await database.execute(sql`
      insert into organizations (id, name, slug, specialty)
      values
        (${LAB_ID}::uuid, 'SystemOps Dental Lab', ${`digest-lab-${randomUUID()}`}, 'dental'),
        (${otherClinicId}::uuid, 'Other tenant', ${`digest-other-${randomUUID()}`}, 'dental')
    `);
    await database.execute(sql`
      insert into conversation_authority (
        organization_id, version, activated_at, activated_by
      ) values (${otherClinicId}::uuid, 2, now(), 'digest-before')
    `);
    const audit = await import("../../scripts/audit-v2-only-rollout");
    const postExpandDigest = await audit.readOtherTenantRolloutDigest(LAB_ID);
    let columnDropped = false;
    try {
      await database.execute(sql`alter table organizations drop column live_automation_enabled`);
      columnDropped = true;
      const preExpandDigest = await audit.readOtherTenantRolloutDigest(LAB_ID);
      expect(preExpandDigest).toBe(postExpandDigest);

      await runtime!.pool.query(
        "alter table organizations add column live_automation_enabled boolean default false not null",
      );
      columnDropped = false;
      await database.execute(sql`
        update conversation_authority
        set activated_by = 'digest-after', updated_at = now() + interval '1 second'
        where organization_id = ${otherClinicId}::uuid
      `);
      await expect(audit.readOtherTenantRolloutDigest(LAB_ID))
        .resolves.not.toBe(postExpandDigest);
    } finally {
      if (columnDropped) {
        await runtime!.pool.query(
          "alter table organizations add column live_automation_enabled boolean default false not null",
        );
      }
    }
  });
});
