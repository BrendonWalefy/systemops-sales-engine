import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { digestInboundClaimToken } from "@/application/jobs/inbound-claim-token";
import { drainMessageProcessQueue } from "@/application/jobs/drain-message-process-queue";
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
  markForInboundEvent(input: Readonly<{
    clinicId: string;
    inboundEventId: string;
    claimJobId: string;
    reason: "v2_terminal_processing_failure";
    now: Date;
  }>): Promise<boolean>;
  markForOutboundMessage(input: Readonly<{
    outboundMessageId: string;
    sendJobId: string;
    workerId: string;
    reason: "v2_terminal_delivery_failure";
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
  markOutboundDelivered(input: Readonly<{
    id: string;
    providerMessageId: string | null;
    sentAt?: Date;
  }>): Promise<void>;
  markOutboundDead(id: string, error: string): Promise<void>;
}>;

type OutboundMessageStoreModule = Readonly<{
  DrizzleOutboundMessageStore: new () => OutboundMessageStore;
}>;

type TestDatabase = ReturnType<typeof drizzleNodePostgres>;

type JobQueueModule = typeof import("@/infrastructure/repositories/drizzle-job-queue");
type InboundEventStoreModule = typeof import("@/infrastructure/repositories/drizzle-inbound-event-store");

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

async function loadJobQueue() {
  const imported = await vi.importActual<JobQueueModule>(
    "@/infrastructure/repositories/drizzle-job-queue",
  );
  return new imported.DrizzleJobQueue();
}

async function loadInboundEventStore() {
  const imported = await vi.importActual<InboundEventStoreModule>(
    "@/infrastructure/repositories/drizzle-inbound-event-store",
  );
  return new imported.DrizzleInboundEventStore();
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

async function waitForBlockedQuery(
  runtime: EmbeddedAuthorityDatabase,
  queryPattern: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const blocked = await runtime.pool.query<{ blocked: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
         where datname = current_database()
           and pid <> pg_backend_pid()
           and wait_event_type = 'Lock'
           and query ilike $1
       ) as blocked`,
      [queryPattern],
    );
    if (blocked.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected PostgreSQL lock wait for ${queryPattern}`);
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
        live_automation_enabled, shadow_mode_enabled, is_demo
      ) values (
        ${clinicId}::uuid, 'V2 outbound tenant', ${`v2-outbound-${clinicId}`},
        'dental', 'active', true, true, false, false
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

  async function retireClaimedStreamAfterConvergence(
    streamId: string,
    reason: "alias_convergence" | "conversation_convergence" = "alias_convergence",
  ): Promise<void> {
    await database.execute(sql`
      update whatsapp_streams
      set
        state = 'retired',
        retired_at = '2026-08-25T21:00:01.000Z'::timestamptz,
        retirement_reason = ${reason}
      where id = ${streamId}::uuid
    `);
  }

  async function moveStreamToDifferentConversation(input: Readonly<{
    clinicId: string;
    streamId: string;
  }>): Promise<void> {
    const otherLeadId = randomUUID();
    const otherConversationId = randomUUID();
    await database.execute(sql`
      insert into leads (id, organization_id, channel)
      values (${otherLeadId}::uuid, ${input.clinicId}::uuid, 'whatsapp')
    `);
    await database.execute(sql`
      insert into conversations (id, organization_id, lead_id, channel)
      values (
        ${otherConversationId}::uuid,
        ${input.clinicId}::uuid,
        ${otherLeadId}::uuid,
        'whatsapp'
      )
    `);
    await database.execute(sql`
      update whatsapp_streams
      set conversation_id = ${otherConversationId}::uuid
      where id = ${input.streamId}::uuid
    `);
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

  it("serializes switch close before live creation through the singleton row lock", async () => {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    const store = await loadOutboundMessageStore();
    const client = await runtime!.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<{ version: string }>(
        "select version from conversation_runtime_control where key = 'global'",
      );
      const expectedVersion = Number(current.rows[0]!.version);
      const closed = await client.query(
        `update conversation_runtime_control
         set live_outbound_enabled = false, version = version + 1,
             updated_by = 'concurrent-close-test', updated_at = now()
         where key = 'global' and version = $1
         returning key`,
        [expectedVersion],
      );
      expect(closed.rowCount).toBe(1);

      let creationSettled = false;
      const creation = store.createOutboundMessageAndEnqueue(
        liveOutboundInput(fixture),
        { turnId: fixture.inboundEventId },
      ).finally(() => {
        creationSettled = true;
      });
      await waitForBlockedQuery(runtime!, "%locked_runtime_control%");
      expect(creationSettled).toBe(false);

      await client.query("commit");
      await expect(creation).rejects.toMatchObject({
        name: "LiveOutboundCreationRejectedError",
        reason: "global_kill_switch",
      });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }

    const persisted = await database.execute<{
      outbounds: string;
      jobs: string;
      send_max_attempts: number | null;
    }>(sql`
      select
        (select count(*) from outbound_messages where organization_id = ${fixture.clinicId}::uuid)::text as outbounds,
        (select count(*) from jobs where queue = 'message.send' and payload->>'outboundMessageId' is not null)::text as jobs
    `);
    expect(persisted.rows).toEqual([{ outbounds: "0", jobs: "0" }]);
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
    ["tenant_live_disabled", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update organizations set live_automation_enabled = false where id = ${fixture.clinicId}::uuid`);
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
        (select count(*) from jobs send_job
          join outbound_messages outbound
            on outbound.id::text = send_job.payload->>'outboundMessageId'
          where send_job.queue = 'message.send'
            and outbound.organization_id = ${fixture.clinicId}::uuid)::text as jobs
    `);
    expect(persisted.rows).toEqual([{ outbounds: "0", jobs: "0" }]);
  });

  it("authorizes an eligible live reply from one bounded persisted tuple", async () => {
    const { store, outboundMessageId } = await createEligibleLiveOutbound();
    await expect(store.authorizeOutboundMessageForSend(outboundMessageId))
      .resolves.toEqual({ authorized: true });
  });

  it("creates one live reply after its settled stream retires through alias convergence", async () => {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    await retireClaimedStreamAfterConvergence(fixture.streamId);
    const store = await loadOutboundMessageStore();

    const created = await store.createOutboundMessageAndEnqueue(
      liveOutboundInput(fixture),
      { turnId: fixture.inboundEventId },
    );
    const duplicate = await store.createOutboundMessageAndEnqueue(
      liveOutboundInput(fixture),
      { turnId: fixture.inboundEventId },
    );

    expect(duplicate.outboundMessageId).toBe(created.outboundMessageId);
    const persisted = await database.execute<{ outbounds: string; jobs: string }>(sql`
      select
        (select count(*) from outbound_messages
          where organization_id = ${fixture.clinicId}::uuid
            and authorization_kind = 'live_stream_reply')::text as outbounds,
        (select count(*) from jobs
          where queue = 'message.send'
            and payload->>'outboundMessageId' = ${created.outboundMessageId})::text as jobs,
        (select max_attempts from jobs
          where queue = 'message.send'
            and payload->>'outboundMessageId' = ${created.outboundMessageId}
          limit 1) as send_max_attempts
    `);
    expect(persisted.rows).toEqual([{
      outbounds: "1",
      jobs: "1",
      send_max_attempts: 10,
    }]);
  });

  it("keeps an existing live reply sender-authorized after settled stream retirement", async () => {
    const { fixture, outboundMessageId, store } = await createEligibleLiveOutbound();
    await retireClaimedStreamAfterConvergence(fixture.streamId);

    await expect(store.authorizeOutboundMessageForSend(outboundMessageId))
      .resolves.toEqual({ authorized: true });
  });

  it.each([
    ["an unclaimed event", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`
        update inbound_events
        set
          processing_status = 'pending',
          claim_token = null,
          claim_token_digest = null,
          claim_job_id = null,
          claimed_at = null
        where id = ${fixture.inboundEventId}::uuid
      `);
    }],
    ["a provisional stream", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`
        update whatsapp_streams
        set state = 'provisional'
        where id = ${fixture.streamId}::uuid
      `);
    }],
    ["a stream bound to another conversation", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await moveStreamToDifferentConversation(fixture);
    }],
  ] as const)("rejects live creation for %s", async (_label, mutate) => {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    await mutate(fixture);
    const store = await loadOutboundMessageStore();

    await expect(store.createOutboundMessageAndEnqueue(
      liveOutboundInput(fixture),
      { turnId: fixture.inboundEventId },
    )).rejects.toMatchObject({
      name: "LiveOutboundCreationRejectedError",
      reason: "claim_mismatch",
    });
  });

  it.each([
    ["an unclaimed event", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`
        update inbound_events
        set
          processing_status = 'pending',
          claim_token = null,
          claim_token_digest = null,
          claim_job_id = null,
          claimed_at = null
        where id = ${fixture.inboundEventId}::uuid
      `);
    }],
    ["a provisional stream", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`
        update whatsapp_streams
        set state = 'provisional'
        where id = ${fixture.streamId}::uuid
      `);
    }],
    ["a stream bound to another conversation", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await moveStreamToDifferentConversation(fixture);
    }],
  ] as const)("rejects sender preflight for %s", async (_label, mutate) => {
    const { fixture, outboundMessageId, store } = await createEligibleLiveOutbound();
    await mutate(fixture);

    await expect(store.authorizeOutboundMessageForSend(outboundMessageId))
      .resolves.toEqual({ authorized: false, reason: "claim_mismatch" });
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
    ["tenant_live_disabled", async (fixture: Awaited<ReturnType<typeof seedLiveOutboundAuthority>>) => {
      await database.execute(sql`update organizations set live_automation_enabled = false where id = ${fixture.clinicId}::uuid`);
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
        contact_consent_source = ${`lead_message:${fixture.inboundEventId}`}
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

  it.each([
    ["plain historical source", "lead_message"],
    ["different inbound event", `lead_message:${randomUUID()}`],
  ])("fails closed for an opt-out confirmation bound to %s", async (_label, consentSource) => {
    const { fixture, outboundMessageId, store } = await createEligibleLiveOutbound();
    await database.execute(sql`
      update leads set
        contact_consent_revoked_at = '2026-08-25T21:00:01.000Z'::timestamptz,
        contact_consent_source = ${consentSource}
      where id = ${fixture.leadId}::uuid
    `);
    await database.execute(sql`
      update outbound_messages
      set payload = jsonb_set(payload, '{intent}', '"stop_contact"'::jsonb)
      where id = ${outboundMessageId}::uuid
    `);

    await expect(store.authorizeOutboundMessageForSend(outboundMessageId))
      .resolves.toEqual({ authorized: false, reason: "opted_out" });
  });

  it("fails closed on a malformed live turn UUID without throwing or scanning UUID text", async () => {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    const store = await loadOutboundMessageStore();

    await expect(store.createOutboundMessageAndEnqueue(
      liveOutboundInput(fixture),
      { turnId: "not-a-uuid" },
    )).rejects.toMatchObject({
      name: "LiveOutboundCreationRejectedError",
      reason: "claim_mismatch",
    });

    const source = await import("node:fs/promises").then(({ readFile }) => Promise.all([
      readFile("src/infrastructure/repositories/drizzle-outbound-message-store.ts", "utf8"),
      readFile("src/infrastructure/repositories/drizzle-live-outbound-preflight.ts", "utf8"),
    ]));
    expect(source.join("\n")).not.toMatch(/terminal_event\.id::text/);
    expect(source.join("\n")).toMatch(/terminal_event\.id\s*=\s*/);
  });

  it("fails sender preflight when a persisted live payload turn UUID becomes malformed", async () => {
    const { outboundMessageId, store } = await createEligibleLiveOutbound();
    await database.execute(sql`
      update outbound_messages
      set payload = jsonb_set(payload, '{turnId}', '"not-a-uuid"'::jsonb)
      where id = ${outboundMessageId}::uuid
    `);

    await expect(store.authorizeOutboundMessageForSend(outboundMessageId))
      .resolves.toEqual({ authorized: false, reason: "claim_mismatch" });
  });

  it("keeps terminal history lookup indexable on the inbound UUID primary key", async () => {
    const eventId = randomUUID();
    const client = await runtime!.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local enable_seqscan = off");
      const explained = await client.query(
        `explain (format json)
         select 1
         from inbound_events terminal_event
         where terminal_event.id = $1::uuid
           and terminal_event.processing_status = 'history_only'`,
        [eventId],
      );
      const plan = JSON.stringify(explained.rows);
      expect(plan).toMatch(/"Node Type":"Index(?: Only)? Scan"/);
      expect(plan).toContain('"Index Cond":"(id =');
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
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

  it("makes a switch close wait when live creation owns the singleton share lock", async () => {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    const outboundStore = await loadOutboundMessageStore();
    const controlStore = await loadRuntimeControlStore();
    const client = await runtime!.pool.connect();
    try {
      await client.query("begin");
      databaseMock.set(drizzleNodePostgres(client));
      const created = await outboundStore.createOutboundMessageAndEnqueue(
        liveOutboundInput(fixture),
        { turnId: fixture.inboundEventId },
      );
      databaseMock.set(database);

      const current = await controlStore.getGlobal();
      let closeSettled = false;
      const close = controlStore.compareAndSetGlobal({
        expectedVersion: current.version,
        liveOutboundEnabled: false,
        actor: "creation-first-close-test",
        now: new Date("2026-08-25T22:00:00.000Z"),
      }).finally(() => {
        closeSettled = true;
      });
      await waitForBlockedQuery(runtime!, "%update%conversation_runtime_control%");
      expect(closeSettled).toBe(false);

      await client.query("commit");
      await expect(close).resolves.toBe(true);
      await expect(outboundStore.authorizeOutboundMessageForSend(created.outboundMessageId))
        .resolves.toEqual({ authorized: false, reason: "global_kill_switch" });

      await database.execute(sql`
        delete from jobs
        where queue = 'message.send'
          and payload->>'outboundMessageId' = ${created.outboundMessageId}
      `);
      await database.execute(sql`
        delete from outbound_messages where id = ${created.outboundMessageId}::uuid
      `);
    } finally {
      databaseMock.set(database);
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
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
    const appointmentIds = [randomUUID(), randomUUID()];
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
    await database.execute(sql`
      insert into appointments (
        id, organization_id, lead_id, starts_at, ends_at, status, source
      ) values
        (
          ${appointmentIds[0]}::uuid, ${tenantIds[0]}::uuid, ${leadIds[0]}::uuid,
          '2026-08-25T20:30:00.000Z'::timestamptz,
          '2026-08-25T21:30:00.000Z'::timestamptz, 'scheduled', 'app'
        ),
        (
          ${appointmentIds[1]}::uuid, ${tenantIds[1]}::uuid, ${leadIds[1]}::uuid,
          '2026-08-25T20:30:00.000Z'::timestamptz,
          '2026-08-25T21:30:00.000Z'::timestamptz, 'scheduled', 'app'
        )
    `);
    const input = {
      clinicId: tenantIds[0]!,
      conversationId: conversationIds[0]!,
      reason: "v2_patient_arrival_requires_human",
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
    const appointmentRows = await database.execute<{
      id: string;
      status: string;
    }>(sql`
      select id, status
      from appointments
      where id in (${appointmentIds[0]}::uuid, ${appointmentIds[1]}::uuid)
      order by id
    `);
    expect(appointmentRows.rows).toHaveLength(2);
    expect(appointmentRows.rows.every(({ status }) => status === "scheduled")).toBe(true);
  });

  it("resolves terminal process and delivery handoff through exact durable tenant bindings", async () => {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    const other = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    const outboundStore = await loadOutboundMessageStore();
    const outbound = await outboundStore.createOutboundMessageAndEnqueue(
      liveOutboundInput(fixture),
      { turnId: fixture.inboundEventId },
    );
    const now = new Date();
    const sendWorkerId = "terminal-send-worker";
    const jobQueue = await loadJobQueue();
    const sendJob = await jobQueue.claimNextJob({
      queues: ["message.send"],
      workerId: sendWorkerId,
      dedupeKey: `outbound-message:${outbound.outboundMessageId}`,
      now,
    });
    expect(sendJob).not.toBeNull();
    const store = await loadV2ConversationHandoffStore();

    await expect(store.markForInboundEvent({
      clinicId: other.clinicId,
      inboundEventId: fixture.inboundEventId,
      claimJobId: fixture.claimJobId,
      reason: "v2_terminal_processing_failure",
      now,
    })).resolves.toBe(false);
    await expect(store.markForInboundEvent({
      clinicId: fixture.clinicId,
      inboundEventId: fixture.inboundEventId,
      claimJobId: fixture.claimJobId,
      reason: "v2_terminal_processing_failure",
      now,
    })).resolves.toBe(true);
    await expect(store.markForOutboundMessage({
      outboundMessageId: outbound.outboundMessageId,
      sendJobId: randomUUID(),
      workerId: sendWorkerId,
      reason: "v2_terminal_delivery_failure",
      now,
    })).resolves.toBe(false);
    await expect(store.markForOutboundMessage({
      outboundMessageId: outbound.outboundMessageId,
      sendJobId: sendJob!.id,
      workerId: "wrong-worker",
      reason: "v2_terminal_delivery_failure",
      now,
    })).resolves.toBe(false);
    await expect(store.markForOutboundMessage({
      outboundMessageId: outbound.outboundMessageId,
      sendJobId: sendJob!.id,
      workerId: sendWorkerId,
      reason: "v2_terminal_delivery_failure",
      now,
    })).resolves.toBe(true);

    const result = await database.execute<{
      id: string;
      ai_paused: boolean;
      needs_attention: boolean;
      attention_reason: string | null;
    }>(sql`
      select id, ai_paused, needs_attention, attention_reason
      from conversations
      where id in (${fixture.conversationId}::uuid, ${other.conversationId}::uuid)
      order by id
    `);
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    expect(byId.get(fixture.conversationId)).toMatchObject({
      ai_paused: true,
      needs_attention: true,
      attention_reason: "v2_terminal_delivery_failure",
    });
    expect(byId.get(other.conversationId)).toMatchObject({
      ai_paused: false,
      needs_attention: false,
      attention_reason: null,
    });
  });

  it("never downgrades a sent outbound to dead during indeterminate-delivery cleanup", async () => {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    const outboundStore = await loadOutboundMessageStore();
    const outbound = await outboundStore.createOutboundMessageAndEnqueue(
      liveOutboundInput(fixture),
      { turnId: fixture.inboundEventId },
    );
    const sentAt = new Date("2026-08-26T20:40:00.000Z");
    await outboundStore.markOutboundDelivered({
      id: outbound.outboundMessageId,
      providerMessageId: "provider-accepted",
      sentAt,
    });

    await outboundStore.markOutboundDead(
      outbound.outboundMessageId,
      "v2_terminal_handoff_required:delivery_outcome_indeterminate",
    );

    const persisted = await database.execute<{
      status: string;
      provider_message_id: string | null;
      sent_at: Date | null;
    }>(sql`
      select status, provider_message_id, sent_at
      from outbound_messages
      where id = ${outbound.outboundMessageId}::uuid
    `);
    expect(persisted.rows[0]).toMatchObject({
      status: "sent",
      provider_message_id: "provider-accepted",
    });
    expect(new Date(String(persisted.rows[0]!.sent_at)).getTime()).toBe(sentAt.getTime());
  });

  it("exhausts one three-claim process job into one durable handoff without changing its token", async () => {
    const fixture = await seedLiveOutboundAuthority({ liveOutboundEnabled: true });
    const now = new Date("2026-08-25T21:30:00.000Z");
    await database.execute(sql`
      update whatsapp_streams
      set latest_inbound_event_id = ${fixture.inboundEventId}::uuid,
          quiet_until = ${now}
      where id = ${fixture.streamId}::uuid
    `);
    await database.execute(sql`
      update jobs
      set status = 'pending', attempts = 0, max_attempts = 3,
          run_at = ${now}, locked_at = null, locked_by = null,
          dedupe_key = ${`inbound-event:${fixture.inboundEventId}`},
          payload = jsonb_build_object(
            'inboundEventId', ${fixture.inboundEventId}::text,
            'streamId', ${fixture.streamId}::text,
            'streamGeneration', 1
          )
      where id = ${fixture.claimJobId}::uuid
    `);
    await database.execute(sql`
      update inbound_events set processing_status = 'pending'
      where id = ${fixture.inboundEventId}::uuid
    `);

    const jobQueue = await loadJobQueue();
    const inboundEventStore = await loadInboundEventStore();
    const terminalHandoffStore = await loadV2ConversationHandoffStore();
    const processClaimedJob = vi.fn().mockRejectedValue(new Error("terminal V2 failure"));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await drainMessageProcessQueue({
        jobQueue,
        inboundEventStore,
        terminalHandoffStore,
        handler: { processClaimedJob, processHistoryOnlyJob: vi.fn() },
        workerId: `terminal-process-${attempt}`,
        maxJobs: 1,
        now: new Date(now.getTime() + attempt * 60_000),
      });
      expect(result).toMatchObject(attempt < 3
        ? { claimed: 1, retried: 1, dead: 0 }
        : { claimed: 1, retried: 0, dead: 1 });
    }

    const persisted = await database.execute<{
      status: string;
      attempts: number;
      max_attempts: number;
      claim_token: string | null;
      processing_status: string;
      ai_paused: boolean;
      needs_attention: boolean;
      attention_reason: string | null;
      outbounds: string;
    }>(sql`
      select
        job.status,
        job.attempts,
        job.max_attempts,
        event.claim_token,
        event.processing_status,
        conversation.ai_paused,
        conversation.needs_attention,
        conversation.attention_reason,
        (select count(*) from outbound_messages
          where authorization_inbound_event_id = event.id)::text as outbounds
      from jobs job
      join inbound_events event on event.claim_job_id = job.id
      join whatsapp_streams stream on stream.id = event.stream_id
      join conversations conversation on conversation.id = stream.conversation_id
      where job.id = ${fixture.claimJobId}::uuid
    `);
    expect(persisted.rows).toEqual([{
      status: "dead",
      attempts: 3,
      max_attempts: 3,
      claim_token: fixture.claimToken,
      processing_status: "failed",
      ai_paused: true,
      needs_attention: true,
      attention_reason: "v2_terminal_processing_failure",
      outbounds: "0",
    }]);
    expect(processClaimedJob).toHaveBeenCalledTimes(3);
  });
});
