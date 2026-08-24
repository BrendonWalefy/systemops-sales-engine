import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { organizations } from "@/infrastructure/db/schema";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
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

type TestDb = ReturnType<typeof drizzleNodePostgres>;

function testDb(): TestDb {
  return databaseMock.proxy as TestDb;
}

type InboundJsonRow = {
  id: string;
  provider_message_id: string;
  raw: Record<string, unknown>;
};

function eventInput(clinicId: string, providerMessageId: string, receivedAt: Date) {
  return {
    clinicId,
    provider: "z_api" as const,
    providerMessageId,
    conversationKey: "unknown-phone-alias",
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
    dedupeKey: `z-api:instance-1:${providerMessageId}`,
    receivedAt,
  };
}

async function readInboundRows(clinicId: string): Promise<InboundJsonRow[]> {
  const result = await testDb().execute<InboundJsonRow>(sql`
    select
      id::text,
      provider_message_id,
      to_jsonb(inbound_events) as raw
    from inbound_events
    where organization_id = ${clinicId}::uuid
    order by received_at asc, id asc
  `);
  return result.rows;
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

    it("converges simultaneous unknown-alias ingress through PostgreSQL authority", async () => {
      const store = new DrizzleInboundEventStore();
      const receivedAt = new Date("2026-08-24T12:00:00.000Z");

      await Promise.all([
        store.recordInboundEventAndEnqueue(eventInput(clinicId!, "database-a", receivedAt)),
        store.recordInboundEventAndEnqueue(eventInput(clinicId!, "database-b", new Date(receivedAt.getTime() + 5_000))),
      ]);

      const rows = await readInboundRows(clinicId!);
      expect(rows).toHaveLength(2);

      const streamIds = rows.map((row) => row.raw.stream_id);
      expect(streamIds.every((streamId) => typeof streamId === "string")).toBe(true);
      expect(new Set(streamIds)).toHaveLength(1);

      const generations = rows.map((row) => row.raw.stream_generation);
      expect(new Set(generations)).toEqual(new Set([1, 2]));

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
      expect(activeStreams.rows).toHaveLength(1);
      expect(rows.every((row) => row.raw.stream_id === activeStreams.rows[0]?.id)).toBe(true);

      const provisionalStreams = await testDb().execute<{ id: string }>(sql`
        select id::text
        from whatsapp_streams
        where organization_id = ${clinicId}::uuid
          and state = 'provisional'
      `);
      expect(provisionalStreams.rows).toHaveLength(0);
    });

    it("deduplicates simultaneous deliveries of one provider message", async () => {
      const store = new DrizzleInboundEventStore();
      const input = eventInput(clinicId!, "database-duplicate", new Date("2026-08-24T12:00:00.000Z"));

      await Promise.all([
        store.recordInboundEventAndEnqueue(input),
        store.recordInboundEventAndEnqueue(input),
      ]);

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

    it("uses the real claim path to persist and retain one durable claim token", async () => {
      const store = new DrizzleInboundEventStore();
      const queue = new DrizzleJobQueue();
      const input = eventInput(
        clinicId!,
        "database-claim",
        new Date("2026-08-24T11:00:00.000Z"),
      );
      const recorded = await store.recordInboundEventAndEnqueue(input);
      const jobRows = await testDb().execute<{ dedupe_key: string }>(sql`
        select dedupe_key
        from jobs
        where dedupe_key = ${`inbound-event:${recorded.inboundEventId}`}
      `);
      const dedupeKey = jobRows.rows[0]?.dedupe_key;
      expect(dedupeKey).toBe(`inbound-event:${recorded.inboundEventId}`);

      const claimed = await queue.claimNextJob({
        queues: ["message.process"],
        workerId: "database-worker-1",
        dedupeKey,
        now: new Date("2026-08-24T12:00:00.000Z"),
      });
      expect(claimed).not.toBeNull();

      const firstRow = await readInboundRow(recorded.inboundEventId);
      expect.soft(claimed?.payload).toMatchObject({
        inboundEventId: recorded.inboundEventId,
        streamId: expect.any(String),
        streamGeneration: 1,
      });
      expect.soft(firstRow.raw.stream_id).toEqual(expect.any(String));
      expect.soft(firstRow.raw.stream_generation).toBe(1);
      expect.soft(firstRow.raw.claim_token).toEqual(expect.any(String));
      expect.soft(firstRow.raw.claim_job_id).toBe(claimed?.id);
      const firstToken = firstRow.raw.claim_token;

      expect(claimed).not.toBeNull();
      const released = await queue.releaseJob(
        claimed!.id,
        "database-worker-1",
        new Date("2026-08-24T12:00:05.000Z"),
      );
      expect(released).toBe(true);

      const retried = await queue.claimNextJob({
        queues: ["message.process"],
        workerId: "database-worker-2",
        dedupeKey,
        now: new Date("2026-08-24T12:00:10.000Z"),
      });
      expect(retried).not.toBeNull();
      const retryRow = await readInboundRow(recorded.inboundEventId);
      expect.soft(retryRow.raw.claim_token).toBe(firstToken);
      expect.soft(retryRow.raw.claim_job_id).toBe(retried?.id);

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

        const competingClaim = await queue.claimNextJob({
          queues: ["message.process"],
          workerId: `database-${competing.label}`,
          dedupeKey: competingDedupeKey,
          now: new Date("2026-08-24T12:00:10.000Z"),
        });
        expect.soft(competingClaim, competing.label).toBeNull();
      }
    });
});
