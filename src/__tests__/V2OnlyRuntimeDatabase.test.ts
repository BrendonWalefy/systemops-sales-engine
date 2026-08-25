import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { digestInboundClaimToken } from "@/application/jobs/inbound-claim-token";
import type {
  CreateOutboundMessageInput,
  CreateOutboundMessageAndEnqueueResult,
  OutboundSendAuthorizationResult,
} from "@/application/ports/outbound-message-store";
import {
  cleanupEmbeddedAuthorityDatabase,
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

type RuntimeControl = Readonly<{
  liveOutboundEnabled: boolean;
  version: number;
}>;

type RuntimeControlStore = Readonly<{
  getGlobal(): Promise<RuntimeControl>;
  compareAndSetGlobal(input: Readonly<{
    expectedVersion: number;
    liveOutboundEnabled: boolean;
    actor: string;
    now: Date;
  }>): Promise<boolean>;
}>;

type RuntimeControlStoreModule = Readonly<{
  DrizzleConversationRuntimeControlStore: new () => RuntimeControlStore;
}>;

type V2ConversationHandoffStore = Readonly<{
  markRequired(input: Readonly<{
    clinicId: string;
    conversationId: string;
    reason: string;
    now: Date;
  }>): Promise<boolean>;
}>;

type V2ConversationHandoffStoreModule = Readonly<{
  DrizzleV2ConversationHandoffStore: new () => V2ConversationHandoffStore;
}>;

type OutboundMessageStore = Readonly<{
  createOutboundMessageAndEnqueue(
    input: CreateOutboundMessageInput,
    options?: { turnId?: string | null },
  ): Promise<CreateOutboundMessageAndEnqueueResult>;
  authorizeOutboundMessageForSend(id: string): Promise<OutboundSendAuthorizationResult>;
}>;

type OutboundMessageStoreModule = Readonly<{
  DrizzleOutboundMessageStore: new () => OutboundMessageStore;
}>;

type TestDatabase = ReturnType<typeof drizzleNodePostgres>;

async function loadRuntimeControlStore(): Promise<RuntimeControlStore> {
  const modulePath = "@/infrastructure/repositories/drizzle-conversation-runtime-control-store";
  const importedStore = await vi.importActual<RuntimeControlStoreModule>(modulePath);
  return new importedStore.DrizzleConversationRuntimeControlStore();
}

async function loadV2ConversationHandoffStore(): Promise<V2ConversationHandoffStore> {
  const modulePath = "@/infrastructure/repositories/drizzle-v2-conversation-handoff-store";
  const importedStore = await vi.importActual<V2ConversationHandoffStoreModule>(modulePath);
  return new importedStore.DrizzleV2ConversationHandoffStore();
}

async function loadOutboundMessageStore(): Promise<OutboundMessageStore> {
  const modulePath = "@/infrastructure/repositories/drizzle-outbound-message-store";
  const importedStore = await vi.importActual<OutboundMessageStoreModule>(modulePath);
  return new importedStore.DrizzleOutboundMessageStore();
}

function databaseError(error: unknown): Readonly<{
  code?: string;
  constraint?: string;
}> {
  const direct = error as { code?: string; constraint?: string; cause?: unknown };
  const cause = direct.cause as { code?: string; constraint?: string } | undefined;
  return {
    code: cause?.code ?? direct.code,
    constraint: cause?.constraint ?? direct.constraint,
  };
}

async function captureDatabaseError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    return databaseError(error);
  }
  throw new Error("expected PostgreSQL to reject the invalid runtime control row");
}

describe("V2-only global runtime control — PostgreSQL adapter", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let database: TestDatabase;

  async function resetControl(): Promise<void> {
    await database.execute(sql`delete from conversation_runtime_control`);
  }

  async function seedLiveOutboundAuthority(input: {
    liveOutboundEnabled: boolean;
  }): Promise<Readonly<{
    clinicId: string;
    leadId: string;
    conversationId: string;
    streamId: string;
    inboundEventId: string;
    claimJobId: string;
    claimToken: string;
  }>> {
    const clinicId = randomUUID();
    const leadId = randomUUID();
    const conversationId = randomUUID();
    const streamId = randomUUID();
    const inboundEventId = randomUUID();
    const claimJobId = randomUUID();
    const claimToken = "A".repeat(43);
    const now = new Date("2026-08-25T21:00:00.000Z");

    await database.execute(sql`
      insert into organizations (
        id, name, slug, specialty, operational_status, auto_reply_enabled,
        shadow_mode_enabled, is_demo
      ) values (
        ${clinicId}::uuid, 'V2 outbound tenant', ${`v2-outbound-${clinicId}`},
        'dental', 'active', true, false, false
      )
    `);
    await database.execute(sql`
      insert into leads (id, organization_id, channel)
      values (${leadId}::uuid, ${clinicId}::uuid, 'whatsapp')
    `);
    await database.execute(sql`
      insert into conversations (id, organization_id, lead_id, channel)
      values (${conversationId}::uuid, ${clinicId}::uuid, ${leadId}::uuid, 'whatsapp')
    `);
    await database.execute(sql`
      insert into whatsapp_streams (
        id, organization_id, conversation_id, state, current_generation,
        conversation_stream_order, bound_at
      ) values (
        ${streamId}::uuid, ${clinicId}::uuid, ${conversationId}::uuid,
        'active', 1, 1, ${now}
      )
    `);
    await database.execute(sql`
      insert into inbound_events (
        id, organization_id, provider, provider_message_id, conversation_key,
        payload, dedupe_key, processing_status, received_at, stream_id,
        stream_generation, registered_at, claim_token, claim_token_digest, claimed_at
      ) values (
        ${inboundEventId}::uuid, ${clinicId}::uuid, 'z_api', ${`provider-${inboundEventId}`},
        ${`conversation-${conversationId}`}, '{}'::jsonb, ${`inbound-${inboundEventId}`},
        'processing', ${now}, ${streamId}::uuid, 1, ${now}, ${claimToken},
        ${digestInboundClaimToken(claimToken)}, ${now}
      )
    `);
    await database.execute(sql`
      insert into jobs (
        id, queue, payload, status, inbound_event_id, dedupe_key
      ) values (
        ${claimJobId}::uuid, 'message.process', '{}'::jsonb, 'processing',
        ${inboundEventId}::uuid, ${`message-process-${inboundEventId}`}
      )
    `);
    await database.execute(sql`
      update inbound_events
      set claim_job_id = ${claimJobId}::uuid
      where id = ${inboundEventId}::uuid
    `);
    await database.execute(sql`
      insert into conversation_authority (organization_id, version)
      values (${clinicId}::uuid, 2)
    `);
    await database.execute(sql`
      insert into conversation_runtime_control (
        key, live_outbound_enabled, version, updated_by
      ) values ('global', ${input.liveOutboundEnabled}, 1, 'v2-outbound-test')
      on conflict (key) do update set
        live_outbound_enabled = excluded.live_outbound_enabled,
        version = conversation_runtime_control.version + 1,
        updated_by = excluded.updated_by
    `);

    return { clinicId, leadId, conversationId, streamId, inboundEventId, claimJobId, claimToken };
  }

  function liveOutboundInput(fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>): CreateOutboundMessageInput {
    return {
      clinicId: fixture.clinicId,
      conversationId: fixture.conversationId,
      channel: "whatsapp",
      deliveryKind: "text",
      category: "reply",
      dedupeKey: `conversation-reply:${fixture.inboundEventId}`,
      authorization: {
        kind: "live_stream_reply",
        streamId: fixture.streamId,
        streamGeneration: 1,
        sourceInboundEventId: fixture.inboundEventId,
        claimJobId: fixture.claimJobId,
        claimToken: fixture.claimToken,
      },
      payload: {
        version: 1,
        kind: "conversation_reply",
        turnId: fixture.inboundEventId,
        to: "synthetic-destination",
        agentMessageId: randomUUID(),
        replyText: "synthetic-reply",
        intent: null,
        useVoice: false,
        ttsConfig: { provider: "nova", speed: 1 },
        interleavedParts: [],
        mediaParts: [],
        leadId: fixture.leadId,
        pipelineAdvance: null,
      },
    };
  }

  async function createEligibleLiveOutbound(): Promise<Readonly<{
    fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>;
    outboundMessageId: string;
    store: OutboundMessageStore;
  }>> {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    const store = await loadOutboundMessageStore();
    const created = await store.createOutboundMessageAndEnqueue(
      liveOutboundInput(fixture),
      { turnId: fixture.inboundEventId },
    );
    return { fixture, outboundMessageId: created.outboundMessageId, store };
  }

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

  it("fails closed with version zero when the singleton row is absent", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();

    await expect(store.getGlobal()).resolves.toEqual({
      liveOutboundEnabled: false,
      version: 0,
    });
  });

  it("atomically rejects a live reply while the global switch is closed", async () => {
    await resetControl();
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: false });
    const store = await loadOutboundMessageStore();
    const input = liveOutboundInput(fixture);

    await expect(store.createOutboundMessageAndEnqueue(input, {
      turnId: fixture.inboundEventId,
    })).rejects.toMatchObject({
      name: "LiveOutboundCreationRejectedError",
      reason: "global_kill_switch",
    });

    const persisted = await database.execute<{ outbound_count: string; send_job_count: string }>(sql`
      select
        (select count(*) from outbound_messages where organization_id = ${fixture.clinicId}::uuid)::text
          as outbound_count,
        (select count(*) from jobs where queue = 'message.send')::text as send_job_count
    `);
    expect(persisted.rows).toEqual([{ outbound_count: "0", send_job_count: "0" }]);
  });

  it.each([
    ["authority_below_v2", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update conversation_authority set version = 1 where organization_id = ${fixture.clinicId}::uuid`);
    }],
    ["claim_mismatch", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update inbound_events set claim_job_id = null where id = ${fixture.inboundEventId}::uuid`);
    }],
    ["clinic_not_active", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update organizations set operational_status = 'paused' where id = ${fixture.clinicId}::uuid`);
    }],
    ["auto_reply_disabled", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update organizations set auto_reply_enabled = false where id = ${fixture.clinicId}::uuid`);
    }],
    ["shadow_observe", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update organizations set is_demo = true where id = ${fixture.clinicId}::uuid`);
    }],
    ["global_kill_switch", async () => {
      await database.execute(sql`delete from conversation_runtime_control where key = 'global'`);
    }],
  ] as const)("atomically rejects live creation with %s and writes no outbox or job", async (reason, mutate) => {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    await mutate(fixture);
    const store = await loadOutboundMessageStore();

    await expect(store.createOutboundMessageAndEnqueue(
      liveOutboundInput(fixture),
      { turnId: fixture.inboundEventId },
    )).rejects.toMatchObject({
      name: "LiveOutboundCreationRejectedError",
      reason,
    });

    const persisted = await database.execute<{ outbounds: string; jobs: string }>(sql`
      select
        (select count(*) from outbound_messages where organization_id = ${fixture.clinicId}::uuid)::text as outbounds,
        (select count(*) from jobs where queue = 'message.send' and payload->>'outboundMessageId' is not null)::text as jobs
    `);
    expect(persisted.rows).toEqual([{ outbounds: "0", jobs: "0" }]);
  });

  it("authorizes an eligible live reply from one bounded persisted tuple", async () => {
    const { store, outboundMessageId } = await createEligibleLiveOutbound();
    await expect(store.authorizeOutboundMessageForSend(outboundMessageId))
      .resolves.toEqual({ authorized: true });
  });

  it.each([
    ["authority_below_v2", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update conversation_authority set version = 1 where organization_id = ${fixture.clinicId}::uuid`);
    }],
    ["claim_mismatch", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      const replacement = "B".repeat(43);
      await database.execute(sql`
        update inbound_events
        set claim_token = ${replacement}, claim_token_digest = ${digestInboundClaimToken(replacement)}
        where id = ${fixture.inboundEventId}::uuid
      `);
    }],
    ["clinic_not_active", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update organizations set operational_status = 'paused' where id = ${fixture.clinicId}::uuid`);
    }],
    ["auto_reply_disabled", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update organizations set auto_reply_enabled = false where id = ${fixture.clinicId}::uuid`);
    }],
    ["shadow_observe", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update organizations set shadow_mode_enabled = true where id = ${fixture.clinicId}::uuid`);
    }],
    ["human_takeover", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update conversations set ai_paused = true where id = ${fixture.conversationId}::uuid`);
    }],
    ["consent_revoked", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`
        update leads set
          contact_consent_revoked_at = '2026-08-25T20:00:00.000Z'::timestamptz,
          contact_consent_source = 'operator'
        where id = ${fixture.leadId}::uuid
      `);
    }],
    ["opted_out", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`
        update leads set
          contact_consent_revoked_at = '2026-08-25T21:00:01.000Z'::timestamptz,
          contact_consent_source = 'lead_message'
        where id = ${fixture.leadId}::uuid
      `);
    }],
    ["safety_blocked", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update organizations set channel_safety_mode = 'frozen' where id = ${fixture.clinicId}::uuid`);
    }],
    ["global_kill_switch", async () => {
      await database.execute(sql`update conversation_runtime_control set live_outbound_enabled = false where key = 'global'`);
    }],
    ["outbound_not_sendable", async (_fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>, outboundMessageId: string) => {
      await database.execute(sql`update outbound_messages set status = 'sent', sent_at = now() where id = ${outboundMessageId}::uuid`);
    }],
  ] as const)("fails sender preflight with the closed reason %s", async (reason, mutate) => {
    const { fixture, outboundMessageId, store } = await createEligibleLiveOutbound();
    await mutate(fixture, outboundMessageId);
    await expect(store.authorizeOutboundMessageForSend(outboundMessageId)).resolves.toEqual({
      authorized: false,
      reason,
    });
  });

  it("authorizes only the exact current-turn opt-out confirmation after durable revocation", async () => {
    const { fixture, outboundMessageId, store } = await createEligibleLiveOutbound();
    await database.execute(sql`
      update leads set
        contact_consent_revoked_at = '2026-08-25T21:00:01.000Z'::timestamptz,
        contact_consent_source = 'lead_message'
      where id = ${fixture.leadId}::uuid
    `);
    await database.execute(sql`
      update outbound_messages
      set payload = jsonb_set(payload, '{intent}', '"stop_contact"'::jsonb)
      where id = ${outboundMessageId}::uuid
    `);

    await expect(store.authorizeOutboundMessageForSend(outboundMessageId))
      .resolves.toEqual({ authorized: true });
  });

  it("defaults the only valid singleton row to closed at version one", async () => {
    await resetControl();
    await database.execute(sql`
      insert into conversation_runtime_control (key, updated_by)
      values ('global', 'schema-default-test')
    `);

    const result = await database.execute<{
      key: string;
      live_outbound_enabled: boolean;
      version: string;
    }>(sql`
      select key, live_outbound_enabled, version
      from conversation_runtime_control
    `);
    expect(result.rows).toEqual([{
      key: "global",
      live_outbound_enabled: false,
      version: "1",
    }]);
  });

  it("enforces the global singleton key and positive durable version", async () => {
    await resetControl();
    await database.execute(sql`
      insert into conversation_runtime_control (key, updated_by)
      values ('global', 'singleton-test')
    `);

    expect(await captureDatabaseError(async () => {
      await database.execute(sql`
        insert into conversation_runtime_control (key, updated_by)
        values ('global', 'duplicate-test')
      `);
    })).toEqual({
      code: "23505",
      constraint: "conversation_runtime_control_pkey",
    });
    expect(await captureDatabaseError(async () => {
      await database.execute(sql`
        insert into conversation_runtime_control (key, updated_by)
        values ('tenant-scoped', 'invalid-key-test')
      `);
    })).toEqual({
      code: "23514",
      constraint: "conversation_runtime_control_global_key_check",
    });
    expect(await captureDatabaseError(async () => {
      await database.execute(sql`
        update conversation_runtime_control
        set version = 0
        where key = 'global'
      `);
    })).toEqual({
      code: "23514",
      constraint: "conversation_runtime_control_version_check",
    });
  });

  it("inserts only from expected version zero and records the caller metadata", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    const now = new Date("2026-08-25T18:00:00.000Z");

    await expect(store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: true,
      actor: "runtime-control-test",
      now,
    })).resolves.toBe(true);
    await expect(store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: false,
      actor: "stale-insert-test",
      now: new Date("2026-08-25T18:01:00.000Z"),
    })).resolves.toBe(false);

    const result = await database.execute<{
      live_outbound_enabled: boolean;
      version: string;
      updated_at_matches: boolean;
      updated_by: string;
    }>(sql`
      select
        live_outbound_enabled,
        version,
        updated_at = ${now.toISOString()}::timestamptz as updated_at_matches,
        updated_by
      from conversation_runtime_control
      where key = 'global'
    `);
    expect(result.rows).toEqual([{
      live_outbound_enabled: true,
      version: "1",
      updated_at_matches: true,
      updated_by: "runtime-control-test",
    }]);
  });

  it("advances exactly one version and rejects a stale compare-and-set", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    await store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: false,
      actor: "version-one",
      now: new Date("2026-08-25T18:00:00.000Z"),
    });

    await expect(store.compareAndSetGlobal({
      expectedVersion: 1,
      liveOutboundEnabled: true,
      actor: "version-two",
      now: new Date("2026-08-25T18:01:00.000Z"),
    })).resolves.toBe(true);
    await expect(store.compareAndSetGlobal({
      expectedVersion: 1,
      liveOutboundEnabled: false,
      actor: "stale-version-one",
      now: new Date("2026-08-25T18:02:00.000Z"),
    })).resolves.toBe(false);
    await expect(store.compareAndSetGlobal({
      expectedVersion: 2,
      liveOutboundEnabled: false,
      actor: "version-three",
      now: new Date("2026-08-25T18:03:00.000Z"),
    })).resolves.toBe(true);
    await expect(store.getGlobal()).resolves.toEqual({
      liveOutboundEnabled: false,
      version: 3,
    });
  });

  it("allows only one concurrent writer for the same expected version", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    await store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: false,
      actor: "concurrency-base",
      now: new Date("2026-08-25T18:00:00.000Z"),
    });
    const attempts = [
      { liveOutboundEnabled: true, actor: "concurrent-open" },
      { liveOutboundEnabled: false, actor: "concurrent-close" },
    ] as const;

    const outcomes = await Promise.all(attempts.map(async (attempt) => ({
      ...attempt,
      updated: await store.compareAndSetGlobal({
        expectedVersion: 1,
        ...attempt,
        now: new Date("2026-08-25T18:01:00.000Z"),
      }),
    })));

    expect(outcomes.map((outcome) => outcome.updated).sort()).toEqual([false, true]);
    const winner = outcomes.find((outcome) => outcome.updated)!;
    await expect(store.getGlobal()).resolves.toEqual({
      liveOutboundEnabled: winner.liveOutboundEnabled,
      version: 2,
    });
  });

  it("propagates an unreadable singleton instead of converting it to an open state", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    await database.execute(sql`
      alter table conversation_runtime_control
      rename to conversation_runtime_control_unreadable_test
    `);
    try {
      await expect(store.getGlobal()).rejects.toBeDefined();
    } finally {
      await database.execute(sql`
        alter table conversation_runtime_control_unreadable_test
        rename to conversation_runtime_control
      `);
    }
  });

  it("never mutates tenant rows while changing the global control", async () => {
    const store = await loadRuntimeControlStore();
    await resetControl();
    const tenantIds = [randomUUID(), randomUUID()];
    await database.execute(sql`
      insert into organizations (
        id, name, slug, specialty, auto_reply_enabled, operational_status, is_test
      ) values
        (${tenantIds[0]}::uuid, 'Runtime tenant A', ${`runtime-tenant-a-${tenantIds[0]}`} , 'dental', false, 'paused', false),
        (${tenantIds[1]}::uuid, 'Runtime tenant B', ${`runtime-tenant-b-${tenantIds[1]}`} , 'dental', true, 'test', true)
    `);
    const before = await database.execute<Record<string, unknown>>(sql`
      select * from organizations
      where id in (${tenantIds[0]}::uuid, ${tenantIds[1]}::uuid)
      order by id
    `);

    await store.compareAndSetGlobal({
      expectedVersion: 0,
      liveOutboundEnabled: true,
      actor: "global-only-test",
      now: new Date("2026-08-25T18:00:00.000Z"),
    });
    await store.compareAndSetGlobal({
      expectedVersion: 1,
      liveOutboundEnabled: false,
      actor: "global-only-test",
      now: new Date("2026-08-25T18:01:00.000Z"),
    });

    const after = await database.execute<Record<string, unknown>>(sql`
      select * from organizations
      where id in (${tenantIds[0]}::uuid, ${tenantIds[1]}::uuid)
      order by id
    `);
    expect(after.rows).toEqual(before.rows);
  });

  it("persists one idempotent tenant-scoped handoff and never touches another tenant", async () => {
    const store = await loadV2ConversationHandoffStore();
    const tenantIds = [randomUUID(), randomUUID()];
    const leadIds = [randomUUID(), randomUUID()];
    const conversationIds = [randomUUID(), randomUUID()];
    await database.execute(sql`
      insert into organizations (id, name, slug, specialty)
      values
        (${tenantIds[0]}::uuid, 'Handoff tenant A', ${`handoff-a-${tenantIds[0]}`}, 'dental'),
        (${tenantIds[1]}::uuid, 'Handoff tenant B', ${`handoff-b-${tenantIds[1]}`}, 'dental')
    `);
    await database.execute(sql`
      insert into leads (id, organization_id, channel)
      values
        (${leadIds[0]}::uuid, ${tenantIds[0]}::uuid, 'whatsapp'),
        (${leadIds[1]}::uuid, ${tenantIds[1]}::uuid, 'whatsapp')
    `);
    await database.execute(sql`
      insert into conversations (id, organization_id, lead_id, channel)
      values
        (${conversationIds[0]}::uuid, ${tenantIds[0]}::uuid, ${leadIds[0]}::uuid, 'whatsapp'),
        (${conversationIds[1]}::uuid, ${tenantIds[1]}::uuid, ${leadIds[1]}::uuid, 'whatsapp')
    `);
    const input = {
      clinicId: tenantIds[0]!,
      conversationId: conversationIds[0]!,
      reason: "v2_objection_requires_human",
      now: new Date("2026-08-25T20:00:00.000Z"),
    };

    await expect(store.markRequired(input)).resolves.toBe(true);
    await expect(store.markRequired(input)).resolves.toBe(true);
    await expect(store.markRequired({ ...input, clinicId: tenantIds[1]! })).resolves.toBe(false);

    const result = await database.execute<{
      id: string; ai_paused: boolean; needs_attention: boolean; attention_reason: string | null;
    }>(sql`
      select id, ai_paused, needs_attention, attention_reason
      from conversations
      where id in (${conversationIds[0]}::uuid, ${conversationIds[1]}::uuid)
      order by id
    `);
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    expect(byId.get(conversationIds[0]!)).toMatchObject({
      ai_paused: true,
      needs_attention: true,
      attention_reason: input.reason,
    });
    expect(byId.get(conversationIds[1]!)).toMatchObject({
      ai_paused: false,
      needs_attention: false,
      attention_reason: null,
    });
  });
});
