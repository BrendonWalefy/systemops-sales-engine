import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import {
  conversationAuthority,
  conversations,
  inboundEvents,
  jobs,
  leads,
  messages,
  organizations,
  whatsappStreamAliases,
  whatsappStreams,
} from "@/infrastructure/db/schema";
import { backfillWhatsAppStreamAuthority } from "../../scripts/backfill-whatsapp-stream-authority";
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
type StreamFixture = Readonly<{ conversationId: string; streamId: string }>;

function testDb(): TestDb {
  return databaseMock.proxy as TestDb;
}

function uniqueSlug(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

async function createOrganization(label: string): Promise<string> {
  const [organization] = await testDb().insert(organizations).values({
    name: label,
    slug: uniqueSlug(label.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
    specialty: "dental",
    operationalStatus: "test",
    isTest: true,
  }).returning({ id: organizations.id });
  return organization.id;
}

async function createStream(input: Readonly<{
  clinicId: string;
  state?: "active" | "retired";
  aliases?: readonly Readonly<{
    kind: "phone" | "whatsapp_lid" | "provider_thread";
    providerScope: string;
    normalizedValue: string;
  }>[];
}>): Promise<StreamFixture> {
  const [lead] = await testDb().insert(leads).values({
    clinicId: input.clinicId,
    channel: "whatsapp",
    phone: `55${randomUUID().replace(/\D/g, "").padEnd(13, "0").slice(0, 13)}`,
  }).returning({ id: leads.id });
  const [conversation] = await testDb().insert(conversations).values({
    clinicId: input.clinicId,
    leadId: lead.id,
    channel: "whatsapp",
  }).returning({ id: conversations.id });
  const state = input.state ?? "active";
  const [stream] = await testDb().insert(whatsappStreams).values({
    clinicId: input.clinicId,
    conversationId: conversation.id,
    conversationStreamOrder: 1,
    boundAt: new Date("2026-08-01T00:00:00.000Z"),
    state,
    ...(state === "retired" ? {
      retiredAt: new Date("2026-08-02T00:00:00.000Z"),
      retirementReason: "conversation_convergence" as const,
    } : {}),
  }).returning({ id: whatsappStreams.id });
  if (input.aliases?.length) {
    await testDb().insert(whatsappStreamAliases).values(input.aliases.map((alias) => ({
      clinicId: input.clinicId,
      streamId: stream.id,
      kind: alias.kind,
      providerScope: alias.providerScope,
      normalizedValue: alias.normalizedValue,
    })));
  }
  return { conversationId: conversation.id, streamId: stream.id };
}

async function createHistoricalEvent(input: Readonly<{
  clinicId: string;
  providerMessageId: string;
  phone?: string;
  whatsappLid?: string;
  providerInstanceId?: string;
  providerThreadId?: string;
  canonicalConversationId?: string;
  processedAt?: Date | null;
}>): Promise<string> {
  const providerThreadId = input.providerThreadId
    ?? input.whatsappLid
    ?? input.phone
    ?? `thread-${input.providerMessageId}`;
  const id = randomUUID();
  await testDb().insert(inboundEvents).values({
    id,
    clinicId: input.clinicId,
    provider: "z_api",
    providerMessageId: input.providerMessageId,
    conversationKey: providerThreadId,
    payload: {
      phone: input.phone,
      chatLid: input.whatsappLid,
      instanceId: input.providerInstanceId ?? "instance-1",
      messageId: input.providerMessageId,
      fromMe: false,
      isGroupMsg: false,
      isStatusReply: false,
      isEdit: false,
    },
    dedupeKey: `historical:${input.clinicId}:${input.providerMessageId}`,
    processingStatus: "processed",
    receivedAt: new Date("2026-07-01T00:00:00.000Z"),
    processedAt: input.processedAt,
  });
  if (input.canonicalConversationId) {
    await testDb().insert(messages).values({
      conversationId: input.canonicalConversationId,
      author: "lead",
      body: "historical fixture",
      sentAt: new Date("2026-07-01T00:00:00.000Z"),
      externalId: input.providerMessageId,
    });
  }
  return id;
}

async function readEventAuthority(eventId: string): Promise<{
  stream_id: string | null;
  stream_generation: string | null;
  processing_status: string;
}> {
  const result = await testDb().execute<{
    stream_id: string | null;
    stream_generation: string | null;
    processing_status: string;
  }>(sql`
    select stream_id::text, stream_generation::text, processing_status::text
    from inbound_events where id = ${eventId}::uuid
  `);
  return result.rows[0]!;
}

describe("historical WhatsApp authority backfill", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    const database = drizzleNodePostgres(runtime.pool);
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

  it("does not let a second conversation stream contaminate canonical evidence", async () => {
    const clinicId = await createOrganization("Backfill canonical scope");
    const winner = await createStream({ clinicId });
    await createStream({ clinicId });
    await createHistoricalEvent({
      clinicId,
      providerMessageId: "canonical-two-streams",
      canonicalConversationId: winner.conversationId,
    });

    await expect(backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: null,
    })).resolves.toMatchObject({ selected: 1, backfilled: 1, conflicts: 0, unresolved: 0 });
  });

  it("binds one canonical message only to the active stream for its conversation", async () => {
    const clinicId = await createOrganization("Backfill exact conversation");
    const winner = await createStream({ clinicId });
    const unrelated = await createStream({ clinicId });
    const eventId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "canonical-exact-stream",
      canonicalConversationId: winner.conversationId,
    });

    await backfillWhatsAppStreamAuthority({ clinicId, apply: true, batchSize: 500, afterId: null });

    expect(await readEventAuthority(eventId)).toMatchObject({ stream_id: winner.streamId });
    expect((await readEventAuthority(eventId)).stream_id).not.toBe(unrelated.streamId);
  });

  it("resolves an event without a canonical message through one normalized active alias", async () => {
    const clinicId = await createOrganization("Backfill alias fallback");
    const winner = await createStream({
      clinicId,
      aliases: [{
        kind: "phone",
        providerScope: "__provider_independent__",
        normalizedValue: "5511987654321",
      }],
    });
    const eventId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "alias-only",
      phone: "+55 (11) 98765-4321",
    });

    await expect(backfillWhatsAppStreamAuthority({
      clinicId, apply: true, batchSize: 500, afterId: null,
    })).resolves.toMatchObject({ selected: 1, backfilled: 1, conflicts: 0, unresolved: 0 });
    expect(await readEventAuthority(eventId)).toMatchObject({ stream_id: winner.streamId });
  });

  it("keeps identical aliases isolated by tenant", async () => {
    const clinicId = await createOrganization("Backfill tenant A");
    const otherClinicId = await createOrganization("Backfill tenant B");
    const alias = {
      kind: "phone" as const,
      providerScope: "__provider_independent__",
      normalizedValue: "5511977770000",
    };
    const winner = await createStream({ clinicId, aliases: [alias] });
    await createStream({ clinicId: otherClinicId, aliases: [alias] });
    const eventId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "tenant-alias",
      phone: alias.normalizedValue,
    });

    await backfillWhatsAppStreamAuthority({ clinicId, apply: true, batchSize: 500, afterId: null });

    expect(await readEventAuthority(eventId)).toMatchObject({ stream_id: winner.streamId });
  });

  it("accepts canonical and alias evidence only when both identify the same stream", async () => {
    const clinicId = await createOrganization("Backfill evidence agreement");
    const winner = await createStream({
      clinicId,
      aliases: [{
        kind: "provider_thread",
        providerScope: "z_api:instance-agree",
        normalizedValue: "thread-agree",
      }],
    });
    await createHistoricalEvent({
      clinicId,
      providerMessageId: "evidence-agrees",
      providerInstanceId: "instance-agree",
      providerThreadId: "thread-agree",
      canonicalConversationId: winner.conversationId,
    });

    await expect(backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: null,
    })).resolves.toMatchObject({ backfilled: 1, conflicts: 0, unresolved: 0 });
  });

  it("fails closed when canonical and alias evidence disagree", async () => {
    const clinicId = await createOrganization("Backfill evidence disagreement");
    const canonical = await createStream({ clinicId });
    await createStream({
      clinicId,
      aliases: [{
        kind: "provider_thread",
        providerScope: "z_api:instance-disagree",
        normalizedValue: "thread-disagree",
      }],
    });
    const eventId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "evidence-disagrees",
      providerInstanceId: "instance-disagree",
      providerThreadId: "thread-disagree",
      canonicalConversationId: canonical.conversationId,
    });

    await expect(backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: null,
    })).resolves.toMatchObject({ backfilled: 0, conflicts: 1, unresolved: 0 });
    expect(await readEventAuthority(eventId)).toMatchObject({
      stream_id: null,
      processing_status: "processed",
    });
  });

  it("reports zero evidence as unresolved without guessing", async () => {
    const clinicId = await createOrganization("Backfill no evidence");
    await createStream({ clinicId });
    const eventId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "no-evidence",
      providerInstanceId: "instance-no-evidence",
      providerThreadId: "thread-no-evidence",
    });

    await expect(backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: null,
    })).resolves.toMatchObject({ backfilled: 0, conflicts: 0, unresolved: 1 });
    expect(await readEventAuthority(eventId)).toMatchObject({
      stream_id: null,
      processing_status: "processed",
    });
  });

  it("separates terminal legacy history from ordinary unresolved rows and applies only authority winners", async () => {
    const clinicId = await createOrganization("Backfill terminal legacy split");
    const cutoff = new Date("2026-08-24T18:00:00.000Z");
    await testDb().insert(conversationAuthority).values({
      clinicId,
      version: 1,
      activatedBy: "Brendon Walefy",
      updatedAt: cutoff,
    });
    const winner = await createStream({ clinicId });
    const backfillableId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "terminal-split-winner",
      canonicalConversationId: winner.conversationId,
      processedAt: new Date("2026-08-24T17:00:00.000Z"),
    });
    const terminalId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "terminal-split-zero-authority",
      providerInstanceId: "terminal-split-instance",
      providerThreadId: "terminal-split-thread",
      processedAt: new Date("2026-08-24T17:00:00.000Z"),
    });

    const dryRun = await backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: null,
    });
    expect(dryRun).toMatchObject({
      selected: 2,
      backfillable: 1,
      backfilled: 1,
      terminalLegacyEligible: 1,
      unresolved: 0,
      conflicts: 0,
      backfillableEventIds: [backfillableId],
      terminalLegacyEventIds: [terminalId],
    });
    expect(await readEventAuthority(backfillableId)).toMatchObject({ stream_id: null });
    expect(await readEventAuthority(terminalId)).toMatchObject({
      stream_id: null,
      processing_status: "processed",
    });

    const applied = await backfillWhatsAppStreamAuthority({
      clinicId, apply: true, batchSize: 500, afterId: null,
    });
    expect(applied).toMatchObject({
      backfillable: 1,
      terminalLegacyEligible: 1,
      unresolved: 0,
      conflicts: 0,
      backfillableEventIds: [backfillableId],
      terminalLegacyEventIds: [terminalId],
    });
    expect(await readEventAuthority(backfillableId)).toMatchObject({ stream_id: winner.streamId });
    expect(await readEventAuthority(terminalId)).toMatchObject({
      stream_id: null,
      processing_status: "processed",
    });
  });

  it("reports multiple genuine alias authorities as a conflict", async () => {
    const clinicId = await createOrganization("Backfill genuine conflict");
    await createStream({
      clinicId,
      aliases: [{
        kind: "phone",
        providerScope: "__provider_independent__",
        normalizedValue: "5511966660000",
      }],
    });
    await createStream({
      clinicId,
      aliases: [{
        kind: "provider_thread",
        providerScope: "z_api:instance-conflict",
        normalizedValue: "thread-conflict",
      }],
    });
    await createHistoricalEvent({
      clinicId,
      providerMessageId: "genuine-conflict",
      phone: "5511966660000",
      providerInstanceId: "instance-conflict",
      providerThreadId: "thread-conflict",
    });

    await expect(backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: null,
    })).resolves.toMatchObject({ backfilled: 0, conflicts: 1, unresolved: 0 });
  });

  it("never selects a retired stream or an unrelated active stream", async () => {
    const clinicId = await createOrganization("Backfill retired authority");
    const retired = await createStream({
      clinicId,
      state: "retired",
      aliases: [{
        kind: "phone",
        providerScope: "__provider_independent__",
        normalizedValue: "5511955550000",
      }],
    });
    await createStream({ clinicId });
    const eventId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "retired-alias",
      phone: "5511955550000",
    });

    await expect(backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: null,
    })).resolves.toMatchObject({ backfilled: 0, conflicts: 0, unresolved: 1 });
    expect((await readEventAuthority(eventId)).stream_id).not.toBe(retired.streamId);
  });

  it("keeps dry-run read-only across event, stream, message, and jobs", async () => {
    const clinicId = await createOrganization("Backfill dry run");
    const winner = await createStream({ clinicId });
    await createStream({ clinicId });
    const eventId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "dry-run-read-only",
      canonicalConversationId: winner.conversationId,
    });
    const before = await testDb().execute(sql`
      select
        (select to_jsonb(event) from inbound_events event where event.id = ${eventId}::uuid) as event,
        (select jsonb_agg(to_jsonb(stream) order by stream.id) from whatsapp_streams stream
          where stream.organization_id = ${clinicId}::uuid) as streams,
        (select jsonb_agg(to_jsonb(message) order by message.id) from messages message
          join conversations conversation on conversation.id = message.conversation_id
          where conversation.organization_id = ${clinicId}::uuid) as messages,
        (select count(*) from jobs job join inbound_events event on event.id = job.inbound_event_id
          where event.organization_id = ${clinicId}::uuid) as jobs
    `);

    await backfillWhatsAppStreamAuthority({ clinicId, apply: false, batchSize: 500, afterId: null });

    const after = await testDb().execute(sql`
      select
        (select to_jsonb(event) from inbound_events event where event.id = ${eventId}::uuid) as event,
        (select jsonb_agg(to_jsonb(stream) order by stream.id) from whatsapp_streams stream
          where stream.organization_id = ${clinicId}::uuid) as streams,
        (select jsonb_agg(to_jsonb(message) order by message.id) from messages message
          join conversations conversation on conversation.id = message.conversation_id
          where conversation.organization_id = ${clinicId}::uuid) as messages,
        (select count(*) from jobs job join inbound_events event on event.id = job.inbound_event_id
          where event.organization_id = ${clinicId}::uuid) as jobs
    `);
    expect(after.rows).toEqual(before.rows);
  });

  it("rejects an apply batch containing unresolved rows before its first write", async () => {
    const clinicId = await createOrganization("Backfill reviewed rows");
    const winner = await createStream({ clinicId });
    const backfillableId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "reviewed-winner",
      canonicalConversationId: winner.conversationId,
    });
    const unresolvedId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "reviewed-unresolved",
      providerInstanceId: "instance-unresolved",
      providerThreadId: "thread-unresolved",
    });

    await expect(backfillWhatsAppStreamAuthority({
      clinicId, apply: true, batchSize: 500, afterId: null,
    })).rejects.toThrow("authority backfill apply requires a fully resolved batch");
    expect(await readEventAuthority(backfillableId)).toMatchObject({ stream_id: null });
    expect(await readEventAuthority(unresolvedId)).toEqual({
      stream_id: null,
      stream_generation: null,
      processing_status: "processed",
    });
  });

  it("serializes unique generations without creating process or sender jobs", async () => {
    const clinicId = await createOrganization("Backfill serialized generation");
    const winner = await createStream({ clinicId });
    const firstId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "generation-a",
      canonicalConversationId: winner.conversationId,
    });
    const secondId = await createHistoricalEvent({
      clinicId,
      providerMessageId: "generation-b",
      canonicalConversationId: winner.conversationId,
    });

    const ordered = await testDb().select({ id: inboundEvents.id })
      .from(inboundEvents)
      .where(eq(inboundEvents.clinicId, clinicId))
      .orderBy(inboundEvents.id);
    await Promise.all([
      backfillWhatsAppStreamAuthority({
        clinicId, apply: true, batchSize: 1, afterId: null,
      }),
      backfillWhatsAppStreamAuthority({
        clinicId, apply: true, batchSize: 1, afterId: ordered[0]!.id,
      }),
    ]);

    const persisted = await testDb().select({
      id: inboundEvents.id,
      generation: inboundEvents.streamGeneration,
    }).from(inboundEvents).where(eq(inboundEvents.clinicId, clinicId));
    expect(new Set(persisted.map(({ generation }) => generation))).toEqual(new Set([1, 2]));
    expect(new Set(persisted.map(({ id }) => id))).toEqual(new Set([firstId, secondId]));
    const createdJobs = await testDb().select({ id: jobs.id }).from(jobs)
      .where(sql`${jobs.inboundEventId} in (${firstId}::uuid, ${secondId}::uuid)`);
    expect(createdJobs).toHaveLength(0);
  });

  it("keeps UUID-keyset batches bounded to 500 candidates", async () => {
    const clinicId = await createOrganization("Backfill batch bound");
    const rows = Array.from({ length: 501 }, (_, index) => ({
      clinicId,
      provider: "z_api" as const,
      providerMessageId: `bounded-${index}`,
      conversationKey: `bounded-thread-${index}`,
      payload: {
        instanceId: "bounded-instance",
        messageId: `bounded-${index}`,
      },
      dedupeKey: `bounded:${index}`,
      processingStatus: "processed" as const,
      receivedAt: new Date("2026-07-01T00:00:00.000Z"),
    }));
    await testDb().insert(inboundEvents).values(rows);

    const first = await backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: null,
    });
    const second = await backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: first.nextAfterId,
    });
    expect(first).toMatchObject({ selected: 500, unresolved: 500 });
    expect(second).toMatchObject({ selected: 1, unresolved: 1 });
  });

  it("handles the SystemopsLab-shaped mix without organization-wide false conflicts", async () => {
    const clinicId = await createOrganization("Backfill SystemopsLab shape");
    const phoneA = "5511944440001";
    const phoneB = "5511944440002";
    const streamA = await createStream({
      clinicId,
      aliases: [{
        kind: "phone",
        providerScope: "__provider_independent__",
        normalizedValue: phoneA,
      }],
    });
    const streamB = await createStream({
      clinicId,
      aliases: [{
        kind: "phone",
        providerScope: "__provider_independent__",
        normalizedValue: phoneB,
      }],
    });
    await createHistoricalEvent({
      clinicId,
      providerMessageId: "lab-canonical-a",
      phone: phoneA,
      canonicalConversationId: streamA.conversationId,
    });
    await createHistoricalEvent({
      clinicId,
      providerMessageId: "lab-alias-a",
      phone: phoneA,
    });
    await createHistoricalEvent({
      clinicId,
      providerMessageId: "lab-canonical-b",
      phone: phoneB,
      canonicalConversationId: streamB.conversationId,
    });
    await createHistoricalEvent({
      clinicId,
      providerMessageId: "lab-alias-b",
      phone: phoneB,
    });

    await expect(backfillWhatsAppStreamAuthority({
      clinicId, apply: false, batchSize: 500, afterId: null,
    })).resolves.toMatchObject({ selected: 4, backfilled: 4, conflicts: 0, unresolved: 0 });
  });
});
