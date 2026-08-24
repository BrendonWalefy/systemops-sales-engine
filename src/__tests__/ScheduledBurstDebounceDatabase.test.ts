import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  conversationAuthority,
  conversations,
  leads,
  organizations,
  outboundMessages,
} from "@/infrastructure/db/schema";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleWhatsAppStreamAuthority } from "@/infrastructure/repositories/drizzle-whatsapp-stream-authority";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { buildWhatsAppStreamAliases } from "@/core/whatsapp/WhatsAppContactIdentity";
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

type TestDb = ReturnType<typeof drizzleNodePostgres>;

function testDb(): TestDb {
  return databaseMock.proxy as TestDb;
}

type InboundJsonRow = {
  id: string;
  provider_message_id: string;
  raw: Record<string, unknown>;
};

function eventInput(
  clinicId: string,
  providerMessageId: string,
  receivedAt: Date,
  identity: Readonly<{
    providerInstanceId?: string;
    providerThreadId?: string;
    phone?: string | null;
    whatsappLid?: string | null;
  }> = {},
) {
  const providerInstanceId = identity.providerInstanceId ?? "instance-1";
  const providerThreadId = identity.providerThreadId ?? "unknown-phone-alias";
  const phone = identity.phone === undefined ? "5511999999999" : identity.phone;
  return {
    clinicId,
    provider: "z_api" as const,
    providerMessageId,
    conversationKey: "unknown-phone-alias",
    aliases: buildWhatsAppStreamAliases({
      provider: "z_api",
      providerInstanceId,
      providerThreadId,
      phone,
      whatsappLid: identity.whatsappLid,
    }),
    payload: {
      phone: "5511999999999",
      instanceId: "instance-1",
      messageId: providerMessageId,
      text: { message: providerMessageId },
      fromMe: false,
      isGroupMsg: false,
      isStatusReply: false,
      isEdit: false,
    },
    normalizedText: providerMessageId,
    mediaType: null,
    dedupeKey: `z-api:instance-1:${providerMessageId}`,
    receivedAt,
  };
}

async function readInboundRow(id: string): Promise<InboundJsonRow> {
  const result = await testDb().execute<InboundJsonRow>(sql`
    select
      id::text,
      provider_message_id,
      to_jsonb(inbound_events) as raw
    from inbound_events
    where id = ${id}::uuid
  `);
  if (!result.rows[0]) throw new Error(`missing inbound event ${id}`);
  return result.rows[0];
}

describe("scheduled burst debounce — PostgreSQL authority concurrency", () => {
    const runId = randomUUID().slice(0, 8);
    const clinicSlug = `test-scheduled-burst-${runId}`;
    let clinicId: string | undefined;
    let runtime: EmbeddedAuthorityDatabase | undefined;

    beforeAll(async () => {
      runtime = await startEmbeddedAuthorityDatabase();
      const activeDb = drizzleNodePostgres(runtime.pool);
      databaseMock.set(activeDb);
      await migrate(activeDb, { migrationsFolder: join(process.cwd(), "drizzle") });

      const [organization] = await testDb()
        .insert(organizations)
        .values({
          name: `Scheduled Burst Test ${runId}`,
          slug: clinicSlug,
          specialty: "dental",
          city: "São Paulo",
          autoReplyEnabled: true,
          isTest: true,
          operationalStatus: "test",
        })
        .returning({ id: organizations.id });

      clinicId = organization.id;
    });

    afterAll(async () => {
      try {
        await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
      } finally {
        databaseMock.set(undefined);
      }
    });

    it("lets later batch statements observe earlier writes in one transaction", async () => {
      const marker = `batch-visibility-${runId}`;
      const batch = createEmbeddedAtomicDatabaseBatch(runtime!.pool);
      const results = await batch.execute([
        {
          name: "insert_visibility_marker",
          statement: sql`insert into link_previews (url, ok) values (${marker}, true)`,
        },
        {
          name: "read_visibility_marker",
          statement: sql`select url from link_previews where url = ${marker}`,
        },
      ]);

      expect(results[1]?.rows).toEqual([{ url: marker }]);
    });

    it("rolls back the complete ingress when failure is forced after generation assignment", async () => {
      const providerMessageId = `rollback-${runId}`;
      const phone = `55117${runId.replace(/[^0-9]/g, "").padEnd(8, "0").slice(0, 8)}`;
      const batch = createEmbeddedAtomicDatabaseBatch(runtime!.pool, {
        failAfterStep: "assign_generation",
      });
      const store = new DrizzleInboundEventStore(batch);
      const before = await testDb().execute<{ count: string }>(sql`
        select count(*)::text as count from whatsapp_streams
        where organization_id = ${clinicId}::uuid
      `);

      await expect(store.recordInboundEventAndEnqueue(eventInput(
        clinicId!,
        providerMessageId,
        new Date("2026-08-24T12:00:00.000Z"),
        { phone, providerThreadId: providerMessageId },
      ))).rejects.toThrow("forced embedded batch failure after assign_generation");

      const persisted = await testDb().execute<{ events: string; streams: string; aliases: string; jobs: string }>(sql`
        select
          (select count(*)::text from inbound_events where organization_id = ${clinicId}::uuid and provider_message_id = ${providerMessageId}) as events,
          (select count(*)::text from whatsapp_streams s where s.organization_id = ${clinicId}::uuid and exists (
            select 1 from whatsapp_stream_aliases a where a.stream_id = s.id and a.normalized_value in (${phone}, ${providerMessageId})
          )) as streams,
          (select count(*)::text from whatsapp_stream_aliases where organization_id = ${clinicId}::uuid and normalized_value in (${phone}, ${providerMessageId})) as aliases,
          (select count(*)::text from jobs where dedupe_key like ${`inbound-event:%` } and inbound_event_id in (
            select id from inbound_events where organization_id = ${clinicId}::uuid and provider_message_id = ${providerMessageId}
          )) as jobs
      `);
      expect(persisted.rows[0]).toEqual({ events: "0", streams: "0", aliases: "0", jobs: "0" });
      const after = await testDb().execute<{ count: string; provisional: string }>(sql`
        select
          count(*)::text as count,
          count(*) filter (where state = 'provisional')::text as provisional
        from whatsapp_streams
        where organization_id = ${clinicId}::uuid
      `);
      expect(after.rows[0]).toEqual({ count: before.rows[0]?.count, provisional: "0" });
    });

    it("converges simultaneous unknown-alias ingress through PostgreSQL authority", async () => {
      const receivedAt = new Date("2026-08-24T12:00:00.000Z");
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const store = new DrizzleInboundEventStore(
          createEmbeddedAtomicDatabaseBatch(runtime!.pool),
        );
        const messageIds = [`database-a-${iteration}`, `database-b-${iteration}`];
        const identity = {
          phone: `5511999900${String(iteration).padStart(2, "0")}`,
          providerThreadId: `concurrent-thread-${iteration}`,
        };
        const registrations = await Promise.all([
          store.recordInboundEventAndEnqueue(eventInput(
            clinicId!, messageIds[0], receivedAt, identity,
          )),
          store.recordInboundEventAndEnqueue(eventInput(
            clinicId!, messageIds[1], new Date(receivedAt.getTime() + 5_000), identity,
          )),
        ]);

        expect(registrations.every((result) => result.outcome === "registered")).toBe(true);
        const rows = await testDb().execute<InboundJsonRow>(sql`
          select id::text, provider_message_id, to_jsonb(inbound_events) as raw
          from inbound_events
          where organization_id = ${clinicId}::uuid
            and provider_message_id in (${messageIds[0]}, ${messageIds[1]})
        `);
        expect(rows.rows).toHaveLength(2);

        const streamIds = rows.rows.map((row) => row.raw.stream_id);
        expect(streamIds.every((streamId) => typeof streamId === "string")).toBe(true);
        expect(new Set(streamIds)).toHaveLength(1);
        expect(new Set(rows.rows.map((row) => row.raw.stream_generation))).toEqual(new Set([1, 2]));

        for (const registration of registrations) {
          if (registration.outcome !== "registered") continue;
          const persisted = rows.rows.find((row) => row.id === registration.inboundEventId);
          expect(persisted?.raw.stream_id).toBe(registration.streamId);
          expect(persisted?.raw.stream_generation).toBe(registration.streamGeneration);
          const job = await testDb().execute<{ id: string; inbound_event_id: string }>(sql`
            select id::text, inbound_event_id::text
            from jobs where id = ${registration.jobId}::uuid
          `);
          expect(job.rows[0]).toEqual({
            id: registration.jobId,
            inbound_event_id: registration.inboundEventId,
          });
        }
      }

      const authorityTables = await testDb().execute<{ streams: string | null; aliases: string | null }>(sql`
        select
          to_regclass('public.whatsapp_streams')::text as streams,
          to_regclass('public.whatsapp_stream_aliases')::text as aliases
      `);
      expect(authorityTables.rows[0]).toEqual({
        streams: "whatsapp_streams",
        aliases: "whatsapp_stream_aliases",
      });

      const activeStreams = await testDb().execute<{ id: string; state: string }>(sql`
        select id::text, state
        from whatsapp_streams
        where organization_id = ${clinicId}::uuid
          and state = 'active'
      `);
      expect(activeStreams.rows).toHaveLength(8);

      const provisionalStreams = await testDb().execute<{ id: string }>(sql`
        select id::text
        from whatsapp_streams
        where organization_id = ${clinicId}::uuid
          and state = 'provisional'
      `);
      expect(provisionalStreams.rows).toHaveLength(0);
    });

    it("converges one active winner plus provisional aliases onto the active stream", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const phone = "5511777700001";
      const lid = "271295921025045@lid";
      const first = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!,
        "active-provisional-a",
        new Date("2026-08-24T13:00:00.000Z"),
        { phone, providerThreadId: "active-provisional-a" },
      ));
      const second = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!,
        "active-provisional-b",
        new Date("2026-08-24T13:00:05.000Z"),
        { phone, whatsappLid: lid, providerThreadId: "active-provisional-b" },
      ));

      expect(first.outcome).toBe("registered");
      expect(second.outcome).toBe("registered");
      if (first.outcome !== "registered" || second.outcome !== "registered") return;
      expect(second.streamId).toBe(first.streamId);
      expect(second.streamGeneration).toBe(2);

      const aliases = await testDb().execute<{ stream_id: string; normalized_value: string }>(sql`
        select stream_id::text, normalized_value
        from whatsapp_stream_aliases
        where organization_id = ${clinicId}::uuid
          and retired_at is null
          and normalized_value in (${phone}, ${lid}, 'active-provisional-b')
      `);
      expect(aliases.rows).toHaveLength(3);
      expect(aliases.rows.every((alias) => alias.stream_id === first.streamId)).toBe(true);

      const candidateStates = await testDb().execute<{ state: string; count: string }>(sql`
        select state, count(*)::text as count
        from whatsapp_streams
        where organization_id = ${clinicId}::uuid
          and id in (
            select distinct stream_id from whatsapp_stream_aliases
            where organization_id = ${clinicId}::uuid
              and normalized_value in (${phone}, ${lid}, 'active-provisional-b')
          )
        group by state
      `);
      expect(candidateStates.rows).toContainEqual({ state: "active", count: "1" });
      const inaccessibleCandidate = await testDb().execute<{ count: string }>(sql`
        select count(*)::text as count
        from whatsapp_streams stream
        where stream.organization_id = ${clinicId}::uuid
          and stream.state = 'retired'
          and stream.retirement_reason = 'alias_convergence'
          and not exists (
            select 1 from whatsapp_stream_aliases alias
            where alias.stream_id = stream.id and alias.retired_at is null
          )
      `);
      expect(Number(inaccessibleCandidate.rows[0]?.count)).toBeGreaterThanOrEqual(1);
    });

    it("fails closed when aliases resolve to multiple genuinely active streams", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const phone = "5511666600001";
      const lid = "371295921025045@lid";
      const phoneAuthority = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "conflict-phone", new Date("2026-08-24T14:00:00.000Z"),
        { phone, providerThreadId: "conflict-phone" },
      ));
      const lidAuthority = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "conflict-lid", new Date("2026-08-24T14:00:01.000Z"),
        { phone: null, whatsappLid: lid, providerThreadId: "conflict-lid" },
      ));
      expect(phoneAuthority.outcome).toBe("registered");
      expect(lidAuthority.outcome).toBe("registered");

      const conflict = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "identity-conflict", new Date("2026-08-24T14:00:02.000Z"),
        { phone, whatsappLid: lid, providerThreadId: "identity-conflict" },
      ));
      expect(conflict).toMatchObject({
        outcome: "identity_conflict",
        jobId: null,
        jobWasNew: false,
      });

      const event = await readInboundRow(conflict.inboundEventId);
      expect(event.raw).toMatchObject({
        processing_status: "identity_conflict",
        stream_id: null,
        stream_generation: null,
      });
      const jobs = await testDb().execute<{ count: string }>(sql`
        select count(*)::text as count from jobs
        where inbound_event_id = ${conflict.inboundEventId}::uuid
      `);
      expect(jobs.rows[0]?.count).toBe("0");
      const activeAuthorities = await testDb().execute<{ count: string }>(sql`
        select count(distinct stream.id)::text as count
        from whatsapp_stream_aliases alias
        join whatsapp_streams stream on stream.id = alias.stream_id
        where alias.organization_id = ${clinicId}::uuid
          and alias.retired_at is null
          and stream.state = 'active'
          and alias.normalized_value in (${phone}, ${lid})
      `);
      expect(activeAuthorities.rows[0]?.count).toBe("2");
    });

    it("deduplicates simultaneous deliveries of one provider message", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const input = eventInput(clinicId!, "database-duplicate", new Date("2026-08-24T12:00:00.000Z"));

      const registrations = await Promise.all([
        store.recordInboundEventAndEnqueue(input),
        store.recordInboundEventAndEnqueue(input),
      ]);

      expect(new Set(registrations.map((result) => result.inboundEventId))).toHaveLength(1);
      expect(registrations.filter((result) => result.eventWasNew)).toHaveLength(1);
      expect(registrations.filter((result) => result.jobWasNew)).toHaveLength(1);

      const rows = await testDb().execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbound_events
        where organization_id = ${clinicId}::uuid
          and provider_message_id = 'database-duplicate'
      `);
      expect(rows.rows[0]?.count).toBe("1");

      const jobs = await testDb().execute<{ count: string }>(sql`
        select count(*)::text as count
        from jobs
        where dedupe_key = (
          select 'inbound-event:' || id::text
          from inbound_events
          where organization_id = ${clinicId}::uuid
            and provider_message_id = 'database-duplicate'
        )
      `);
      expect(jobs.rows[0]?.count).toBe("1");
    });

    it("scopes duplicate provider message identity by organization", async () => {
      const [secondOrganization] = await testDb()
        .insert(organizations)
        .values({
          name: `Scheduled Burst Second ${runId}`,
          slug: `${clinicSlug}-second`,
          specialty: "dental",
          city: "São Paulo",
          autoReplyEnabled: true,
          isTest: true,
          operationalStatus: "test",
        })
        .returning({ id: organizations.id });
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const providerMessageId = `cross-org-${runId}`;
      const [first, second] = await Promise.all([
        store.recordInboundEventAndEnqueue(eventInput(
          clinicId!, providerMessageId, new Date("2026-08-24T15:00:00.000Z"),
          { phone: "5511555500001", providerThreadId: "cross-org" },
        )),
        store.recordInboundEventAndEnqueue(eventInput(
          secondOrganization.id, providerMessageId, new Date("2026-08-24T15:00:00.000Z"),
          { phone: "5511555500001", providerThreadId: "cross-org" },
        )),
      ]);

      expect(first.inboundEventId).not.toBe(second.inboundEventId);
      const count = await testDb().execute<{ count: string }>(sql`
        select count(*)::text as count from inbound_events
        where provider = 'z_api' and provider_message_id = ${providerMessageId}
      `);
      expect(count.rows[0]?.count).toBe("2");
    });

    it("uses the tenant debounce setting for both stream quiet time and job eligibility", async () => {
      const receivedAt = new Date("2026-08-24T15:30:00.000Z");
      await testDb().execute(sql`
        update organizations set message_debounce_ms = 45000
        where id = ${clinicId}::uuid
      `);
      try {
        const store = new DrizzleInboundEventStore(
          createEmbeddedAtomicDatabaseBatch(runtime!.pool),
        );
        const registered = await store.recordInboundEventAndEnqueue(eventInput(
          clinicId!, "long-debounce", receivedAt,
          { phone: "5511222200001", providerThreadId: "long-debounce" },
        ));
        if (registered.outcome !== "registered") throw new Error("long debounce ingress conflicted");
        const persisted = await testDb().execute<{ quiet_until: string; run_at: string }>(sql`
          select stream.quiet_until, job.run_at
          from whatsapp_streams stream
          join inbound_events event on event.stream_id = stream.id
          join jobs job on job.inbound_event_id = event.id
          where event.id = ${registered.inboundEventId}::uuid
        `);
        const expected = new Date(receivedAt.getTime() + 45_000);
        expect(new Date(persisted.rows[0]!.quiet_until)).toEqual(expected);
        expect(new Date(persisted.rows[0]!.run_at)).toEqual(expected);
      } finally {
        await testDb().execute(sql`
          update organizations set message_debounce_ms = null
          where id = ${clinicId}::uuid
        `);
      }
    });

    it("serializes simultaneous first bindings and retains the losing stream history", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const first = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "bind-a", new Date("2026-08-24T16:00:00.000Z"),
        { phone: "5511444400001", providerThreadId: "bind-a" },
      ));
      const second = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "bind-b", new Date("2026-08-24T16:00:01.000Z"),
        { phone: "5511444400002", providerThreadId: "bind-b" },
      ));
      expect(first.outcome).toBe("registered");
      expect(second.outcome).toBe("registered");
      if (first.outcome !== "registered" || second.outcome !== "registered") return;

      const [lead] = await testDb().insert(leads).values({
        clinicId: clinicId!,
        phone: "5511444499999",
        channel: "whatsapp",
      }).returning({ id: leads.id });
      const [conversation] = await testDb().insert(conversations).values({
        clinicId: clinicId!,
        leadId: lead.id,
        channel: "whatsapp",
        externalThreadId: "bind-conversation",
      }).returning({ id: conversations.id });
      const authority = new DrizzleWhatsAppStreamAuthority(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );

      const results = await Promise.all([
        authority.bindStreamToConversation({
          clinicId: clinicId!,
          conversationId: conversation.id,
          streamId: first.streamId,
          streamGeneration: first.streamGeneration,
          inboundEventId: first.inboundEventId,
          now: new Date("2026-08-24T16:00:02.000Z"),
        }),
        authority.bindStreamToConversation({
          clinicId: clinicId!,
          conversationId: conversation.id,
          streamId: second.streamId,
          streamGeneration: second.streamGeneration,
          inboundEventId: second.inboundEventId,
          now: new Date("2026-08-24T16:00:02.000Z"),
        }),
      ]);

      expect(new Set(results.map((result) => result.authoritativeStreamId))).toHaveLength(1);
      const bound = await testDb().execute<{
        id: string;
        state: string;
        conversation_stream_order: string;
      }>(sql`
        select id::text, state, conversation_stream_order::text
        from whatsapp_streams
        where conversation_id = ${conversation.id}::uuid
        order by conversation_stream_order
      `);
      expect(bound.rows).toHaveLength(2);
      expect(bound.rows.filter((stream) => stream.state === "active")).toHaveLength(1);
      expect(bound.rows.filter((stream) => stream.state === "retired")).toHaveLength(1);
      expect(new Set(bound.rows.map((stream) => stream.conversation_stream_order))).toEqual(
        new Set(["1", "2"]),
      );

      const eventTuples = await testDb().execute<{
        id: string;
        stream_id: string;
        stream_generation: string;
        processing_status: string;
      }>(sql`
        select id::text, stream_id::text, stream_generation::text, processing_status
        from inbound_events
        where id in (${first.inboundEventId}::uuid, ${second.inboundEventId}::uuid)
      `);
      expect(eventTuples.rows.map((event) => ({
        id: event.id,
        stream_id: event.stream_id,
        stream_generation: event.stream_generation,
      }))).toEqual(
        expect.arrayContaining([
          { id: first.inboundEventId, stream_id: first.streamId, stream_generation: String(first.streamGeneration) },
          { id: second.inboundEventId, stream_id: second.streamId, stream_generation: String(second.streamGeneration) },
        ]),
      );
      expect(eventTuples.rows.filter((event) => event.processing_status === "history_only")).toHaveLength(1);

      const authoritativeStreamId = results[0]!.authoritativeStreamId;
      const activeAliases = await testDb().execute<{ stream_id: string }>(sql`
        select stream_id::text
        from whatsapp_stream_aliases
        where organization_id = ${clinicId}::uuid
          and retired_at is null
          and stream_id in (${first.streamId}::uuid, ${second.streamId}::uuid)
      `);
      expect(activeAliases.rows.length).toBeGreaterThan(0);
      expect(activeAliases.rows.every((alias) => alias.stream_id === authoritativeStreamId)).toBe(true);
    });

    it("does not revoke a claimed loser while converging it onto an existing conversation stream", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const winner = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "claimed-bind-winner", new Date("2026-08-24T17:00:00.000Z"),
        { phone: "5511333300001", providerThreadId: "claimed-bind-winner" },
      ));
      const loser = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "claimed-bind-loser", new Date("2026-08-24T17:00:01.000Z"),
        { phone: "5511333300002", providerThreadId: "claimed-bind-loser" },
      ));
      if (winner.outcome !== "registered" || loser.outcome !== "registered") {
        throw new Error("binding setup did not register both streams");
      }
      const [lead] = await testDb().insert(leads).values({
        clinicId: clinicId!, phone: "5511333399999", channel: "whatsapp",
      }).returning({ id: leads.id });
      const [conversation] = await testDb().insert(conversations).values({
        clinicId: clinicId!, leadId: lead.id, channel: "whatsapp",
      }).returning({ id: conversations.id });
      const authority = new DrizzleWhatsAppStreamAuthority(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      await authority.bindStreamToConversation({
        clinicId: clinicId!, conversationId: conversation.id,
        streamId: winner.streamId, streamGeneration: winner.streamGeneration,
        inboundEventId: winner.inboundEventId, now: new Date("2026-08-24T17:00:02.000Z"),
      });
      await testDb().execute(sql`
        update inbound_events
        set claim_token = ${"a".repeat(43)},
            claim_token_digest = ${"b".repeat(43)},
            claimed_at = clock_timestamp()
        where id = ${loser.inboundEventId}::uuid
      `);

      const converged = await authority.bindStreamToConversation({
        clinicId: clinicId!, conversationId: conversation.id,
        streamId: loser.streamId, streamGeneration: loser.streamGeneration,
        inboundEventId: loser.inboundEventId, now: new Date("2026-08-24T17:00:03.000Z"),
      });
      expect(converged).toMatchObject({
        authoritativeStreamId: winner.streamId,
        retainedEventStreamId: loser.streamId,
        retiredCurrentStream: true,
        conversationStreamOrder: 2,
      });
      const retained = await readInboundRow(loser.inboundEventId);
      expect(retained.raw).toMatchObject({
        stream_id: loser.streamId,
        stream_generation: loser.streamGeneration,
        processing_status: "pending",
        claim_token: "a".repeat(43),
      });
    });

    it("uses scoped unique indexes for provider and alias authority lookups", async () => {
      await testDb().execute(sql`
        insert into inbound_events (
          id, organization_id, provider, provider_message_id,
          conversation_key, payload, dedupe_key, received_at
        )
        select
          md5(${runId} || '-plan-event-' || series::text)::uuid,
          ${clinicId}::uuid,
          'z_api',
          'plan-message-' || series::text,
          'plan-thread-' || series::text,
          '{}'::jsonb,
          'plan-dedupe-' || series::text,
          clock_timestamp()
        from generate_series(1, 10000) series
        on conflict (organization_id, provider, provider_message_id) do nothing
      `);
      await testDb().execute(sql`
        insert into whatsapp_streams (id, organization_id, state)
        select
          md5(${runId} || '-plan-stream-' || series::text)::uuid,
          ${clinicId}::uuid,
          'active'
        from generate_series(1, 1000) series
        on conflict (id) do nothing
      `);
      await testDb().execute(sql`
        insert into whatsapp_stream_aliases (
          organization_id, kind, provider_scope, normalized_value, stream_id
        )
        select
          ${clinicId}::uuid,
          'phone',
          '__provider_independent__',
          'plan-alias-' || series::text,
          md5(${runId} || '-plan-stream-' || series::text)::uuid
        from generate_series(1, 1000) series
        on conflict (organization_id, kind, provider_scope, normalized_value)
          where retired_at is null
        do nothing
      `);
      const providerPlan = await testDb().execute<{ "QUERY PLAN": string }>(sql`
        explain (analyze, buffers, costs off)
        select id from inbound_events
        where organization_id = ${clinicId}::uuid
          and provider = 'z_api'
          and provider_message_id = 'database-duplicate'
      `);
      const aliasPlan = await testDb().execute<{ "QUERY PLAN": string }>(sql`
        explain (analyze, buffers, costs off)
        select stream_id from whatsapp_stream_aliases
        where organization_id = ${clinicId}::uuid
          and kind = 'phone'
          and provider_scope = '__provider_independent__'
          and normalized_value = '5511999999999'
          and retired_at is null
      `);

      expect(providerPlan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
        "inbound_events_org_provider_message_unique",
      );
      expect(aliasPlan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
        "whatsapp_stream_aliases_active_identity_unique",
      );
    });

    it("uses the real claim path to persist and retain one durable claim token", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const queue = new DrizzleJobQueue();
      const input = eventInput(
        clinicId!,
        "database-claim",
        new Date("2026-08-24T11:00:00.000Z"),
        {
          phone: "5511888800001",
          providerThreadId: "database-claim-thread",
        },
      );
      const recorded = await store.recordInboundEventAndEnqueue(input);
      const jobRows = await testDb().execute<{ dedupe_key: string }>(sql`
        select dedupe_key
        from jobs
        where dedupe_key = ${`inbound-event:${recorded.inboundEventId}`}
      `);
      const dedupeKey = jobRows.rows[0]?.dedupe_key;
      expect(dedupeKey).toBe(`inbound-event:${recorded.inboundEventId}`);

      const claimed = await queue.claimNextInboundWork({
        workerId: "database-worker-1",
        dedupeKey,
        now: new Date("2026-08-24T12:00:00.000Z"),
      });
      expect(claimed).not.toBeNull();

      const firstRow = await readInboundRow(recorded.inboundEventId);
      expect.soft(claimed?.job.payload).toMatchObject({
        inboundEventId: recorded.inboundEventId,
        streamId: expect.any(String),
        streamGeneration: 1,
      });
      expect.soft(claimed).toMatchObject({
        outcome: "claimed",
        inboundEventId: recorded.inboundEventId,
        streamId: recorded.outcome === "registered" ? recorded.streamId : undefined,
        streamGeneration: 1,
        claimToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
      expect(JSON.stringify(claimed!.job.payload)).not.toContain("claimToken");
      expect(JSON.stringify(claimed!.job.payload)).not.toContain("claim_token");
      expect.soft(firstRow.raw.stream_id).toEqual(expect.any(String));
      expect.soft(firstRow.raw.stream_generation).toBe(1);
      expect.soft(firstRow.raw.claim_token).toEqual(expect.any(String));
      expect.soft(firstRow.raw.claim_job_id).toBe(claimed?.job.id);
      const firstToken = firstRow.raw.claim_token;

      expect(claimed).not.toBeNull();
      const released = await queue.releaseJob(
        claimed!.job.id,
        "database-worker-1",
        new Date("2026-08-24T12:00:05.000Z"),
      );
      expect(released).toBe(true);

      const retried = await queue.claimNextInboundWork({
        workerId: "database-worker-2",
        dedupeKey,
        now: new Date("2026-08-24T12:00:10.000Z"),
      });
      expect(retried).not.toBeNull();
      const retryRow = await readInboundRow(recorded.inboundEventId);
      expect.soft(retryRow.raw.claim_token).toBe(firstToken);
      expect.soft(retryRow.raw.claim_job_id).toBe(retried?.job.id);
      expect.soft(retried).toMatchObject({ outcome: "claimed", claimToken: firstToken });

      const competingClaims = [
        { label: "different event", inboundEventId: randomUUID(), streamId: "stream-1", streamGeneration: 1 },
        { label: "different stream", inboundEventId: recorded.inboundEventId, streamId: "stream-2", streamGeneration: 1 },
        { label: "different generation", inboundEventId: recorded.inboundEventId, streamId: "stream-1", streamGeneration: 2 },
        { label: "different job", inboundEventId: recorded.inboundEventId, streamId: "stream-1", streamGeneration: 1 },
      ];

      for (const competing of competingClaims) {
        const competingJobId = randomUUID();
        const competingDedupeKey = `competing-claim:${recorded.inboundEventId}:${competing.label}`;
        await testDb().execute(sql`
          insert into jobs (id, queue, payload, dedupe_key, run_at)
          values (
            ${competingJobId}::uuid,
            'message.process',
            ${JSON.stringify({
              inboundEventId: competing.inboundEventId,
              streamId: competing.streamId,
              streamGeneration: competing.streamGeneration,
            })}::jsonb,
            ${competingDedupeKey},
            ${new Date("2026-08-24T12:00:00.000Z")}::timestamptz
          )
        `);

        const competingClaim = await queue.claimNextInboundWork({
          workerId: `database-${competing.label}`,
          dedupeKey: competingDedupeKey,
          now: new Date("2026-08-24T12:00:10.000Z"),
        });
        expect.soft(competingClaim, competing.label).toBeNull();
      }
    });

    it.each([
      "before composition",
      "after composition",
      "during atomic outbox creation",
    ])("retains the exact token after failure %s and retry", async (failurePhase) => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const queue = new DrizzleJobQueue();
      const suffix = failurePhase.replaceAll(" ", "-");
      const receivedAt = new Date("2026-08-24T18:35:00.000Z");
      const recorded = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!,
        `claim-failure-${suffix}`,
        receivedAt,
        {
          phone: `55117777${failurePhase.length.toString().padStart(6, "0")}`,
          providerThreadId: `claim-failure-${suffix}`,
        },
      ));
      const first = await queue.claimNextInboundWork({
        workerId: `failure-first-${suffix}`,
        dedupeKey: `inbound-event:${recorded.inboundEventId}`,
        now: new Date(receivedAt.getTime() + 15_000),
      });
      expect(first).toMatchObject({ outcome: "claimed", claimToken: expect.any(String) });
      const failed = await queue.failJob({
        job: first!.job,
        workerId: `failure-first-${suffix}`,
        error: failurePhase,
        retryAt: new Date(receivedAt.getTime() + 20_000),
        now: new Date(receivedAt.getTime() + 16_000),
      });
      expect(failed).toBe("pending");
      await store.markInboundEventPending(recorded.inboundEventId);
      const retry = await queue.claimNextInboundWork({
        workerId: `failure-retry-${suffix}`,
        dedupeKey: `inbound-event:${recorded.inboundEventId}`,
        now: new Date(receivedAt.getTime() + 20_000),
      });
      expect(retry).toMatchObject({
        outcome: "claimed",
        inboundEventId: recorded.inboundEventId,
        claimToken: first!.claimToken,
      });
      const persisted = await readInboundRow(recorded.inboundEventId);
      expect(persisted.raw.claim_token).toBe(first!.claimToken);
      expect(persisted.raw.claim_job_id).toBe(first!.job.id);
    });

    it("keeps the latest generation pending until its durable quiet boundary", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const queue = new DrizzleJobQueue();
      const recorded = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!,
        "claim-quiet-window",
        new Date("2026-08-24T18:00:00.000Z"),
        { phone: "5511888800010", providerThreadId: "claim-quiet-window" },
      ));
      const dedupeKey = `inbound-event:${recorded.inboundEventId}`;

      await expect(queue.claimNextInboundWork({
        workerId: "quiet-too-early",
        dedupeKey,
        now: new Date("2026-08-24T18:00:14.999Z"),
      })).resolves.toBeNull();

      const claimed = await queue.claimNextInboundWork({
        workerId: "quiet-settled",
        dedupeKey,
        now: new Date("2026-08-24T18:00:15.000Z"),
      });
      expect(claimed).toMatchObject({ outcome: "claimed", inboundEventId: recorded.inboundEventId });
    });

    it("settles stale A as history-only when B registered before A claimed", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const queue = new DrizzleJobQueue();
      const identity = { phone: "5511888800011", providerThreadId: "claim-before-a" };
      const first = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "claim-before-a", new Date("2026-08-24T18:10:00.000Z"), identity,
      ));
      const second = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "claim-before-b", new Date("2026-08-24T18:10:05.000Z"), identity,
      ));

      const stale = await queue.claimNextInboundWork({
        workerId: "claim-before-worker-a",
        dedupeKey: `inbound-event:${first.inboundEventId}`,
        now: new Date("2026-08-24T18:10:16.000Z"),
      });
      expect(stale).toMatchObject({
        outcome: "history_only",
        inboundEventId: first.inboundEventId,
        claimToken: null,
      });
      const staleRow = await readInboundRow(first.inboundEventId);
      expect(staleRow.raw).toMatchObject({ processing_status: "history_only", claim_token: null });

      await expect(queue.claimNextInboundWork({
        workerId: "claim-before-worker-b-early",
        dedupeKey: `inbound-event:${second.inboundEventId}`,
        now: new Date("2026-08-24T18:10:19.999Z"),
      })).resolves.toBeNull();
      const latest = await queue.claimNextInboundWork({
        workerId: "claim-before-worker-b",
        dedupeKey: `inbound-event:${second.inboundEventId}`,
        now: new Date("2026-08-24T18:10:20.000Z"),
      });
      expect(latest).toMatchObject({ outcome: "claimed", inboundEventId: second.inboundEventId });
    });

    it("does not revoke A when B registers after A has durably claimed", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const queue = new DrizzleJobQueue();
      const identity = { phone: "5511888800012", providerThreadId: "claim-after-a" };
      const first = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "claim-after-a", new Date("2026-08-24T18:20:00.000Z"), identity,
      ));
      const firstClaim = await queue.claimNextInboundWork({
        workerId: "claim-after-worker-a",
        dedupeKey: `inbound-event:${first.inboundEventId}`,
        now: new Date("2026-08-24T18:20:15.000Z"),
      });
      expect(firstClaim).toMatchObject({ outcome: "claimed", claimToken: expect.any(String) });

      const second = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "claim-after-b", new Date("2026-08-24T18:20:16.000Z"), identity,
      ));
      if (second.outcome !== "registered") throw new Error("B unexpectedly conflicted");
      await queue.releaseJob(
        firstClaim!.job.id,
        "claim-after-worker-a",
        new Date("2026-08-24T18:20:17.000Z"),
      );
      const retry = await queue.claimNextInboundWork({
        workerId: "claim-after-worker-a-retry",
        dedupeKey: `inbound-event:${first.inboundEventId}`,
        now: new Date("2026-08-24T18:20:17.000Z"),
      });
      expect(retry).toMatchObject({
        outcome: "claimed",
        inboundEventId: first.inboundEventId,
        claimToken: firstClaim!.claimToken,
      });
      expect(second.streamGeneration).toBe(2);
    });

    it("allows only one competing worker to settle an exact authority tuple", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const recorded = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!,
        "claim-competing-workers",
        new Date("2026-08-24T18:30:00.000Z"),
        { phone: "5511888800013", providerThreadId: "claim-competing-workers" },
      ));
      const dedupeKey = `inbound-event:${recorded.inboundEventId}`;
      const workers = await Promise.all([
        new DrizzleJobQueue().claimNextInboundWork({
          workerId: "claim-competing-1",
          dedupeKey,
          now: new Date("2026-08-24T18:30:15.000Z"),
        }),
        new DrizzleJobQueue().claimNextInboundWork({
          workerId: "claim-competing-2",
          dedupeKey,
          now: new Date("2026-08-24T18:30:15.000Z"),
        }),
      ]);
      expect(workers.filter(Boolean)).toHaveLength(1);
      expect(workers.find(Boolean)).toMatchObject({
        outcome: "claimed",
        inboundEventId: recorded.inboundEventId,
      });
    });

    it("atomically repairs a missing inbound authority job", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const authority = new DrizzleWhatsAppStreamAuthority(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const recorded = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!,
        "orphan-missing-job",
        new Date("2026-08-24T18:40:00.000Z"),
        { phone: "5511888800014", providerThreadId: "orphan-missing-job" },
      ));
      await testDb().execute(sql`
        delete from jobs where inbound_event_id = ${recorded.inboundEventId}::uuid
      `);

      const repaired = await authority.repairInboundAuthorityJob({
        inboundEventId: recorded.inboundEventId,
        now: new Date("2026-08-24T18:42:00.000Z"),
        olderThan: new Date("2026-08-24T18:41:00.000Z"),
      });
      expect(repaired).toMatchObject({ outcome: "created", jobId: expect.any(String) });
      const persisted = await testDb().execute<{ count: string }>(sql`
        select count(*)::text as count from jobs
        where inbound_event_id = ${recorded.inboundEventId}::uuid
          and queue = 'message.process'
          and dedupe_key = ${`inbound-event:${recorded.inboundEventId}`}
      `);
      expect(persisted.rows[0]?.count).toBe("1");
    });

    it("resets the same terminally unusable claimed job without minting a token", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const queue = new DrizzleJobQueue();
      const authority = new DrizzleWhatsAppStreamAuthority(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const recorded = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!,
        "orphan-terminal-job",
        new Date("2026-08-24T18:50:00.000Z"),
        { phone: "5511888800015", providerThreadId: "orphan-terminal-job" },
      ));
      const claim = await queue.claimNextInboundWork({
        workerId: "orphan-terminal-worker",
        dedupeKey: `inbound-event:${recorded.inboundEventId}`,
        now: new Date("2026-08-24T18:50:15.000Z"),
      });
      await testDb().execute(sql`
        update jobs set status = 'dead', locked_at = null, locked_by = null
        where id = ${claim!.job.id}::uuid
      `);
      await testDb().execute(sql`
        update inbound_events set processing_status = 'failed'
        where id = ${recorded.inboundEventId}::uuid
      `);

      const repaired = await authority.repairInboundAuthorityJob({
        inboundEventId: recorded.inboundEventId,
        now: new Date("2026-08-24T18:52:00.000Z"),
        olderThan: new Date("2026-08-24T18:51:00.000Z"),
      });
      expect(repaired).toEqual({ outcome: "rebound", jobId: claim!.job.id });
      const persisted = await readInboundRow(recorded.inboundEventId);
      expect(persisted.raw.claim_token).toBe(claim!.claimToken);
      const job = await testDb().execute<{ id: string; status: string }>(sql`
        select id::text, status from jobs where inbound_event_id = ${recorded.inboundEventId}::uuid
      `);
      expect(job.rows).toEqual([{ id: claim!.job.id, status: "pending" }]);
    });

    it("fails orphan repair closed for live, young, terminal, or tuple-mismatched work", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const queue = new DrizzleJobQueue();
      const authority = new DrizzleWhatsAppStreamAuthority(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const base = new Date("2026-08-24T19:00:00.000Z");
      const live = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "orphan-live", base,
        { phone: "5511888800016", providerThreadId: "orphan-live" },
      ));
      await expect(authority.repairInboundAuthorityJob({
        inboundEventId: live.inboundEventId,
        now: new Date("2026-08-24T19:02:00.000Z"),
        olderThan: new Date("2026-08-24T19:01:00.000Z"),
      })).resolves.toEqual({ outcome: "ineligible", jobId: null });

      const young = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "orphan-young", new Date("2026-08-24T19:02:00.000Z"),
        { phone: "5511888800017", providerThreadId: "orphan-young" },
      ));
      await testDb().execute(sql`delete from jobs where inbound_event_id = ${young.inboundEventId}::uuid`);
      await expect(authority.repairInboundAuthorityJob({
        inboundEventId: young.inboundEventId,
        now: new Date("2026-08-24T19:02:30.000Z"),
        olderThan: new Date("2026-08-24T19:01:30.000Z"),
      })).resolves.toEqual({ outcome: "ineligible", jobId: null });

      const terminal = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "orphan-terminal-event", base,
        { phone: "5511888800018", providerThreadId: "orphan-terminal-event" },
      ));
      await testDb().execute(sql`delete from jobs where inbound_event_id = ${terminal.inboundEventId}::uuid`);
      await testDb().execute(sql`
        update inbound_events set processing_status = 'processed', processed_at = ${base}
        where id = ${terminal.inboundEventId}::uuid
      `);
      await expect(authority.repairInboundAuthorityJob({
        inboundEventId: terminal.inboundEventId,
        now: new Date("2026-08-24T19:02:30.000Z"),
        olderThan: new Date("2026-08-24T19:01:30.000Z"),
      })).resolves.toEqual({ outcome: "ineligible", jobId: null });

      const mismatch = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "orphan-tuple-mismatch", base,
        { phone: "5511888800019", providerThreadId: "orphan-tuple-mismatch" },
      ));
      const mismatchClaim = await queue.claimNextInboundWork({
        workerId: "orphan-mismatch-worker",
        dedupeKey: `inbound-event:${mismatch.inboundEventId}`,
        now: new Date("2026-08-24T19:00:15.000Z"),
      });
      await testDb().execute(sql`
        update jobs
        set status = 'dead', locked_at = null, locked_by = null,
            payload = jsonb_set(payload, '{streamGeneration}', '999'::jsonb)
        where id = ${mismatchClaim!.job.id}::uuid
      `);
      await testDb().execute(sql`
        update inbound_events set processing_status = 'failed'
        where id = ${mismatch.inboundEventId}::uuid
      `);
      await expect(authority.repairInboundAuthorityJob({
        inboundEventId: mismatch.inboundEventId,
        now: new Date("2026-08-24T19:02:30.000Z"),
        olderThan: new Date("2026-08-24T19:01:30.000Z"),
      })).resolves.toEqual({ outcome: "ineligible", jobId: null });
    });

    it("rejects orphan repair after an authorized outbound references the event", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const queue = new DrizzleJobQueue();
      const authority = new DrizzleWhatsAppStreamAuthority(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const recorded = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "orphan-authorized-outbound", new Date("2026-08-24T19:10:00.000Z"),
        { phone: "5511888800020", providerThreadId: "orphan-authorized-outbound" },
      ));
      const claim = await queue.claimNextInboundWork({
        workerId: "orphan-outbound-worker",
        dedupeKey: `inbound-event:${recorded.inboundEventId}`,
        now: new Date("2026-08-24T19:10:15.000Z"),
      });
      const [lead] = await testDb().insert(leads).values({ clinicId: clinicId!, channel: "whatsapp" }).returning();
      const [conversation] = await testDb().insert(conversations).values({
        clinicId: clinicId!, leadId: lead.id, channel: "whatsapp",
      }).returning();
      await testDb().insert(outboundMessages).values({
        clinicId: clinicId!,
        conversationId: conversation.id,
        channel: "whatsapp",
        payload: { text: "authorized" },
        deliveryKind: "text",
        sequence: 1,
        authorizationKind: "live_stream_reply",
        authorizationStreamId: claim!.streamId,
        authorizationGeneration: claim!.streamGeneration,
        authorizationInboundEventId: claim!.inboundEventId,
        authorizationClaimJobId: claim!.job.id,
        authorizationClaimTokenDigest: "b".repeat(43),
        authorizationVersion: 2,
      });
      await testDb().execute(sql`
        update jobs set status = 'dead', locked_at = null, locked_by = null
        where id = ${claim!.job.id}::uuid
      `);
      await testDb().execute(sql`
        update inbound_events set processing_status = 'failed'
        where id = ${recorded.inboundEventId}::uuid
      `);

      await expect(authority.repairInboundAuthorityJob({
        inboundEventId: recorded.inboundEventId,
        now: new Date("2026-08-24T19:12:00.000Z"),
        olderThan: new Date("2026-08-24T19:11:00.000Z"),
      })).resolves.toEqual({ outcome: "ineligible", jobId: null });
    });

    it("converges two concurrent missing-job repairs to one canonical job", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const recorded = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "orphan-concurrent", new Date("2026-08-24T19:20:00.000Z"),
        { phone: "5511888800021", providerThreadId: "orphan-concurrent" },
      ));
      await testDb().execute(sql`delete from jobs where inbound_event_id = ${recorded.inboundEventId}::uuid`);
      const request = {
        inboundEventId: recorded.inboundEventId,
        now: new Date("2026-08-24T19:22:00.000Z"),
        olderThan: new Date("2026-08-24T19:21:00.000Z"),
      };
      const repairs = await Promise.all([
        new DrizzleWhatsAppStreamAuthority().repairInboundAuthorityJob(request),
        new DrizzleWhatsAppStreamAuthority().repairInboundAuthorityJob(request),
      ]);
      expect(repairs.filter((repair) => repair.outcome === "created")).toHaveLength(1);
      expect(repairs.every((repair) => repair.outcome === "created" || repair.outcome === "ineligible")).toBe(true);
      const jobs = await testDb().execute<{ count: string }>(sql`
        select count(*)::text as count from jobs
        where inbound_event_id = ${recorded.inboundEventId}::uuid
      `);
      expect(jobs.rows[0]?.count).toBe("1");
    });

    it("persists canonical inbound authority once and orders by generation, not provider time", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const authority = new DrizzleWhatsAppStreamAuthority(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const conversationRepository = new DrizzleConversationRepository();
      const identity = { phone: "5511888800022", providerThreadId: "canonical-order" };
      const first = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "canonical-a", new Date("2026-08-24T20:00:05.000Z"), identity,
      ));
      const second = await store.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "canonical-b", new Date("2026-08-24T20:00:00.000Z"), identity,
      ));
      if (first.outcome !== "registered" || second.outcome !== "registered") {
        throw new Error("canonical-order ingress unexpectedly conflicted");
      }
      const [lead] = await testDb().insert(leads).values({
        clinicId: clinicId!, channel: "whatsapp", phone: "5511888800022",
      }).returning();
      const [conversation] = await testDb().insert(conversations).values({
        clinicId: clinicId!, leadId: lead.id, channel: "whatsapp",
      }).returning();
      await authority.bindStreamToConversation({
        clinicId: clinicId!,
        conversationId: conversation.id,
        streamId: first.streamId,
        streamGeneration: first.streamGeneration,
        inboundEventId: first.inboundEventId,
        now: new Date("2026-08-24T20:00:20.000Z"),
      });

      const append = (input: typeof first, body: string, sentAt: Date) =>
        conversationRepository.appendMessage({
          id: randomUUID(),
          conversationId: conversation.id,
          author: "lead",
          body,
          mediaUrl: null,
          mediaType: null,
          sentAt,
          externalId: `external-${input.inboundEventId}`,
          inboundEventId: input.inboundEventId,
          streamId: input.streamId,
          streamGeneration: input.streamGeneration,
        } as never);
      expect(await append(first, "A", new Date("2026-08-24T20:00:05.000Z"))).toBe(true);
      expect(await append(second, "B", new Date("2026-08-24T20:00:00.000Z"))).toBe(true);
      expect(await append(first, "A duplicate", new Date("2026-08-24T20:00:06.000Z"))).toBe(false);

      const history = await conversationRepository.listMessages(conversation.id);
      expect(history.map((message) => message.body)).toEqual(["A", "B"]);
      expect(history.map((message) => ({
        inboundEventId: (message as Record<string, unknown>).inboundEventId,
        streamId: (message as Record<string, unknown>).streamId,
        streamGeneration: (message as Record<string, unknown>).streamGeneration,
      }))).toEqual([
        { inboundEventId: first.inboundEventId, streamId: first.streamId, streamGeneration: 1 },
        { inboundEventId: second.inboundEventId, streamId: second.streamId, streamGeneration: 2 },
      ]);
    });

    it("orders one active and two retained streams by conversation stream order", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const authority = new DrizzleWhatsAppStreamAuthority(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const repository = new DrizzleConversationRepository();
      const registrations = [];
      for (let index = 1; index <= 3; index++) {
        const registered = await store.recordInboundEventAndEnqueue(eventInput(
          clinicId!,
          `retained-history-${index}`,
          new Date(`2026-08-24T20:10:0${4 - index}.000Z`),
          {
            phone: `55118888001${index.toString().padStart(2, "0")}`,
            providerThreadId: `retained-history-${index}`,
          },
        ));
        if (registered.outcome !== "registered") throw new Error("retained stream conflicted");
        registrations.push(registered);
      }
      const [lead] = await testDb().insert(leads).values({
        clinicId: clinicId!, channel: "whatsapp", phone: "5511888800101",
      }).returning();
      const [conversation] = await testDb().insert(conversations).values({
        clinicId: clinicId!, leadId: lead.id, channel: "whatsapp",
      }).returning();
      for (const registered of registrations) {
        await authority.bindStreamToConversation({
          clinicId: clinicId!,
          conversationId: conversation.id,
          streamId: registered.streamId,
          streamGeneration: registered.streamGeneration,
          inboundEventId: registered.inboundEventId,
          now: new Date("2026-08-24T20:11:00.000Z"),
        });
        await repository.appendMessage({
          id: randomUUID(),
          conversationId: conversation.id,
          author: "lead",
          body: `stream-${registrations.indexOf(registered) + 1}`,
          sentAt: new Date(`2026-08-24T20:10:0${4 - registrations.indexOf(registered)}.000Z`),
          externalId: `retained-external-${registered.inboundEventId}`,
          inboundEventId: registered.inboundEventId,
          streamId: registered.streamId,
          streamGeneration: registered.streamGeneration,
        });
      }
      const streams = await testDb().execute<{
        id: string;
        state: string;
        conversation_stream_order: string;
      }>(sql`
        select id::text, state, conversation_stream_order::text
        from whatsapp_streams
        where conversation_id = ${conversation.id}::uuid
        order by conversation_stream_order
      `);
      expect(streams.rows.map(({ state, conversation_stream_order }) => ({
        state,
        order: Number(conversation_stream_order),
      }))).toEqual([
        { state: "active", order: 1 },
        { state: "retired", order: 2 },
        { state: "retired", order: 3 },
      ]);
      await expect(repository.listMessages(conversation.id)).resolves.toMatchObject([
        { body: "stream-1", streamId: registrations[0]!.streamId },
        { body: "stream-2", streamId: registrations[1]!.streamId },
        { body: "stream-3", streamId: registrations[2]!.streamId },
      ]);
    });

    it("uses generation and event id as canonical tie-breakers for equal and delayed timestamps", async () => {
      const store = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const authority = new DrizzleWhatsAppStreamAuthority(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const repository = new DrizzleConversationRepository();
      const identity = { phone: "5511888800023", providerThreadId: "canonical-ties" };
      const providerTimes = [
        new Date("2026-08-24T20:20:05.000Z"),
        new Date("2026-08-24T20:20:05.000Z"),
        new Date("2026-08-24T19:20:00.000Z"),
        new Date("2026-08-24T21:20:00.000Z"),
      ];
      const registrations = [];
      for (let index = 0; index < providerTimes.length; index++) {
        const registered = await store.recordInboundEventAndEnqueue(eventInput(
          clinicId!, `canonical-tie-${index + 1}`, providerTimes[index]!, identity,
        ));
        if (registered.outcome !== "registered") throw new Error("canonical tie conflicted");
        registrations.push(registered);
      }
      const [lead] = await testDb().insert(leads).values({
        clinicId: clinicId!, channel: "whatsapp", phone: "5511888800023",
      }).returning();
      const [conversation] = await testDb().insert(conversations).values({
        clinicId: clinicId!, leadId: lead.id, channel: "whatsapp",
      }).returning();
      await authority.bindStreamToConversation({
        clinicId: clinicId!,
        conversationId: conversation.id,
        streamId: registrations[0]!.streamId,
        streamGeneration: registrations[0]!.streamGeneration,
        inboundEventId: registrations[0]!.inboundEventId,
        now: new Date("2026-08-24T21:20:20.000Z"),
      });
      for (let index = 0; index < registrations.length; index++) {
        const registered = registrations[index]!;
        await repository.appendMessage({
          id: randomUUID(),
          conversationId: conversation.id,
          author: "lead",
          body: String.fromCharCode(65 + index),
          sentAt: providerTimes[index]!,
          externalId: `canonical-tie-external-${index}`,
          inboundEventId: registered.inboundEventId,
          streamId: registered.streamId,
          streamGeneration: registered.streamGeneration,
        });
      }
      const history = await repository.listMessages(conversation.id);
      expect(history.map(({ body }) => body)).toEqual(["A", "B", "C", "D"]);
      expect(history.map(({ streamGeneration }) => streamGeneration)).toEqual([1, 2, 3, 4]);
    });

    it("persists and validates a settled live outbound tuple without checking the latest generation", async () => {
      const ingress = new DrizzleInboundEventStore(
        createEmbeddedAtomicDatabaseBatch(runtime!.pool),
      );
      const first = await ingress.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "outbound-authority-a", new Date("2026-08-24T22:00:00.000Z"),
        { phone: "5511888800030", providerThreadId: "outbound-authority" },
      ));
      if (first.outcome !== "registered") throw new Error("live outbound ingress conflicted");
      const queue = new DrizzleJobQueue();
      const claim = await queue.claimNextInboundWork({
        workerId: "outbound-authority-worker",
        dedupeKey: `inbound-event:${first.inboundEventId}`,
        now: new Date("2026-08-24T22:00:15.000Z"),
      });
      if (!claim || claim.outcome !== "claimed" || !claim.claimToken) {
        throw new Error("live outbound event did not settle");
      }
      const second = await ingress.recordInboundEventAndEnqueue(eventInput(
        clinicId!, "outbound-authority-b", new Date("2026-08-24T22:00:20.000Z"),
        { phone: "5511888800030", providerThreadId: "outbound-authority" },
      ));
      if (second.outcome !== "registered") throw new Error("later ingress conflicted");
      const [lead] = await testDb().insert(leads).values({
        clinicId: clinicId!, channel: "whatsapp", phone: "5511888800030",
      }).returning();
      const [conversation] = await testDb().insert(conversations).values({
        clinicId: clinicId!, leadId: lead.id, channel: "whatsapp",
      }).returning();
      await testDb().insert(conversationAuthority).values({
        clinicId: clinicId!, version: 2,
      }).onConflictDoUpdate({
        target: conversationAuthority.clinicId,
        set: { version: 2 },
      });
      const outboundStore = new DrizzleOutboundMessageStore();
      const input = {
        clinicId: clinicId!,
        conversationId: conversation.id,
        channel: "whatsapp" as const,
        payload: { turnId: "outbound-authority-a" },
        deliveryKind: "text" as const,
        category: "reply" as const,
        dedupeKey: "outbound-authority-a",
        authorization: {
          kind: "live_stream_reply" as const,
          streamId: claim.streamId,
          streamGeneration: claim.streamGeneration,
          sourceInboundEventId: claim.inboundEventId,
          claimJobId: claim.job.id,
          claimToken: claim.claimToken,
        },
      };

      const firstOutbox = await outboundStore.createOutboundMessageAndEnqueue(input);
      await expect(outboundStore.authorizeOutboundMessageForSend(firstOutbox.outboundMessageId))
        .resolves.toEqual({ authorized: true });
      await expect(outboundStore.createOutboundMessageAndEnqueue({
        ...input,
        dedupeKey: "invalid-token-must-not-reuse-live-authority",
        authorization: { ...input.authorization, claimToken: "z".repeat(43) },
      })).rejects.toThrow("Outbound authorization rejected");
      await testDb().execute(sql`
        update outbound_messages set status = 'dead'
        where id = ${firstOutbox.outboundMessageId}::uuid
      `);
      const duplicate = await outboundStore.createOutboundMessageAndEnqueue({
        ...input,
        dedupeKey: "different-dedupe-must-not-create-a-second-live-reply",
      });
      expect(duplicate.outboundMessageId).toBe(firstOutbox.outboundMessageId);
      const persisted = await outboundStore.findOutboundMessage(firstOutbox.outboundMessageId);
      expect(persisted?.authorization).toMatchObject({
        kind: "live_stream_reply",
        streamId: claim.streamId,
        streamGeneration: claim.streamGeneration,
        sourceInboundEventId: claim.inboundEventId,
        claimJobId: claim.job.id,
        authorityVersion: 2,
      });
      expect(persisted?.authorization.claimTokenDigest).not.toBe(claim.claimToken);
      expect(persisted?.status).toBe("dead");
      const jobs = await testDb().execute<{ payload: Record<string, unknown>; count: string }>(sql`
        select min(payload::text)::jsonb as payload, count(*)::text as count
        from jobs where dedupe_key = ${`outbound-message:${firstOutbox.outboundMessageId}`}
      `);
      expect(jobs.rows[0]?.count).toBe("1");
      const serializedJob = JSON.stringify(jobs.rows[0]?.payload);
      expect(serializedJob).not.toContain(claim.claimToken);
      expect(serializedJob).not.toContain(persisted?.authorization.claimTokenDigest ?? "missing");
    });

    it("persists every explicit non-live kind and fences missing or legacy authorization at version 2", async () => {
      const [lead] = await testDb().insert(leads).values({
        clinicId: clinicId!, channel: "whatsapp", phone: "5511888800031",
      }).returning();
      const [conversation] = await testDb().insert(conversations).values({
        clinicId: clinicId!, leadId: lead.id, channel: "whatsapp",
      }).returning();
      await testDb().insert(conversationAuthority).values({ clinicId: clinicId!, version: 1 })
        .onConflictDoUpdate({ target: conversationAuthority.clinicId, set: { version: 1 } });
      const store = new DrizzleOutboundMessageStore();
      const cases = [
        ["follow_up", "follow_up"],
        ["reminder", "reminder"],
        ["campaign", "campaign"],
        ["human_manual", "reply"],
        ["operational", "operational"],
        ["system", "reply"],
        ["recovery", "recovery"],
        ["legacy", "reply"],
      ] as const;
      for (const [kind, category] of cases) {
        const created = await store.createOutboundMessageAndEnqueue({
          clinicId: clinicId!,
          conversationId: conversation.id,
          channel: "whatsapp",
          payload: { kind, text: kind },
          deliveryKind: "text",
          category,
          dedupeKey: `non-live-authorization:${kind}`,
          authorization: { kind },
        });
        const persisted = await store.findOutboundMessage(created.outboundMessageId);
        expect(persisted?.authorization).toEqual({
          kind,
          streamId: null,
          streamGeneration: null,
          sourceInboundEventId: null,
          claimJobId: null,
          claimTokenDigest: null,
          authorityVersion: 1,
        });
      }
      await testDb().update(conversationAuthority).set({ version: 2 })
        .where(eq(conversationAuthority.clinicId, clinicId!));
      const legacy = await testDb().execute<{ id: string }>(sql`
        select id::text from outbound_messages
        where conversation_id = ${conversation.id}::uuid
          and authorization_kind = 'legacy'
      `);
      await expect(store.authorizeOutboundMessageForSend(legacy.rows[0]!.id))
        .resolves.toEqual({ authorized: false, reason: "authority_version_activated" });

      const missingId = randomUUID();
      await testDb().insert(outboundMessages).values({
        id: missingId,
        clinicId: clinicId!,
        conversationId: conversation.id,
        channel: "whatsapp",
        payload: { text: "historical" },
        deliveryKind: "text",
        category: "reply",
        sequence: 100,
      });
      await expect(store.authorizeOutboundMessageForSend(missingId))
        .resolves.toEqual({ authorized: false, reason: "authority_version_activated" });
    });
});
