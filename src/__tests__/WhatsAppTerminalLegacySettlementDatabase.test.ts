import { createHash, randomUUID } from "node:crypto";
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
  organizations,
  outboundMessages,
  whatsappStreamAliases,
  whatsappStreams,
} from "@/infrastructure/db/schema";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleWhatsAppStreamAuthority } from "@/infrastructure/repositories/drizzle-whatsapp-stream-authority";
import {
  cleanupEmbeddedAuthorityDatabase,
  createEmbeddedAtomicDatabaseBatch,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "@/__tests__/helpers/embedded-authority-database";
import {
  settleWhatsAppTerminalLegacyHistory,
  type TerminalLegacySettlementResult,
} from "../../scripts/settle-whatsapp-terminal-legacy-history";
import { validateWhatsAppStreamAuthority } from "../../scripts/validate-whatsapp-stream-authority";

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
type EventStatus = "pending" | "processing" | "processed" | "failed" | "ignored";

const CUTOFF = new Date("2026-08-24T18:00:00.000Z");
const BEFORE_CUTOFF = new Date("2026-08-24T17:00:00.000Z");
const AFTER_CUTOFF = new Date("2026-08-24T19:00:00.000Z");
const ACTOR = "Brendon Walefy";

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
  await testDb().insert(conversationAuthority).values({
    clinicId: organization.id,
    version: 1,
    activatedBy: ACTOR,
    updatedAt: CUTOFF,
  });
  return organization.id;
}

async function createConversation(clinicId: string): Promise<string> {
  const [lead] = await testDb().insert(leads).values({
    clinicId,
    channel: "whatsapp",
    phone: `55${randomUUID().replace(/\D/g, "").padEnd(13, "0").slice(0, 13)}`,
  }).returning({ id: leads.id });
  const [conversation] = await testDb().insert(conversations).values({
    clinicId,
    leadId: lead.id,
    channel: "whatsapp",
  }).returning({ id: conversations.id });
  return conversation.id;
}

async function createTerminalEvent(input: Readonly<{
  clinicId: string;
  providerMessageId: string;
  status?: EventStatus;
  processedAt?: Date | null;
  receivedAt?: Date;
  phone?: string;
  providerThreadId?: string;
  claim?: boolean;
}>): Promise<string> {
  const id = randomUUID();
  const phone = input.phone ?? `55${randomUUID().replace(/\D/g, "").padEnd(13, "0").slice(0, 13)}`;
  const providerThreadId = input.providerThreadId ?? phone;
  const claimToken = input.claim ? "a".repeat(43) : null;
  await testDb().insert(inboundEvents).values({
    id,
    clinicId: input.clinicId,
    provider: "z_api",
    providerMessageId: input.providerMessageId,
    conversationKey: providerThreadId,
    payload: {
      phone,
      instanceId: "terminal-history-instance",
      messageId: input.providerMessageId,
      fromMe: false,
      isGroupMsg: false,
      isStatusReply: false,
      isEdit: false,
    },
    dedupeKey: `terminal-history:${input.clinicId}:${input.providerMessageId}`,
    processingStatus: input.status ?? "processed",
    receivedAt: input.receivedAt ?? BEFORE_CUTOFF,
    processedAt: input.processedAt === undefined ? BEFORE_CUTOFF : input.processedAt,
    claimToken,
    claimTokenDigest: claimToken,
    claimedAt: input.claim ? BEFORE_CUTOFF : null,
  });
  return id;
}

async function createActiveStream(input: Readonly<{
  clinicId: string;
  kind: "phone" | "provider_thread";
  providerScope: string;
  normalizedValue: string;
}>): Promise<void> {
  const conversationId = await createConversation(input.clinicId);
  const [stream] = await testDb().insert(whatsappStreams).values({
    clinicId: input.clinicId,
    conversationId,
    state: "active",
    conversationStreamOrder: 1,
    boundAt: BEFORE_CUTOFF,
  }).returning({ id: whatsappStreams.id });
  await testDb().insert(whatsappStreamAliases).values({
    clinicId: input.clinicId,
    streamId: stream.id,
    kind: input.kind,
    providerScope: input.providerScope,
    normalizedValue: input.normalizedValue,
  });
}

function settlementOptions(clinicId: string, input: Partial<{
  apply: boolean;
  reviewedEventIds: readonly string[];
  reviewDigest: string;
}> = {}) {
  return {
    clinicId,
    actor: ACTOR,
    apply: input.apply ?? false,
    batchSize: 500,
    afterId: null,
    reviewedEventIds: input.reviewedEventIds ?? [],
    reviewDigest: input.reviewDigest ?? null,
  };
}

async function applyReviewed(result: TerminalLegacySettlementResult): Promise<TerminalLegacySettlementResult> {
  return settleWhatsAppTerminalLegacyHistory(settlementOptions(result.clinicId, {
    apply: true,
    reviewedEventIds: result.eventIds,
    reviewDigest: result.reviewDigest,
  }));
}

async function readEvent(eventId: string) {
  const [event] = await testDb().select().from(inboundEvents)
    .where(eq(inboundEvents.id, eventId)).limit(1);
  return event;
}

describe("terminal legacy WhatsApp history settlement", () => {
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

  it("settles an eligible pre-version-1 terminal event without inventing a stream tuple", async () => {
    const clinicId = await createOrganization("Terminal eligible");
    const eventId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-eligible" });

    const dryRun = await settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId));

    expect(dryRun).toMatchObject({
      mode: "dry-run",
      clinicId,
      actor: ACTOR,
      cutoff: CUTOFF.toISOString(),
      selected: 1,
      eligible: 1,
      ineligible: 0,
      conflicts: 0,
      eventIds: [eventId],
    });
    expect(dryRun.reviewDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await readEvent(eventId)).toMatchObject({
      processingStatus: "processed",
      streamId: null,
      streamGeneration: null,
    });

    const applied = await applyReviewed(dryRun);
    expect(applied).toMatchObject({ mode: "apply", selected: 1, settled: 1 });
    expect(await readEvent(eventId)).toMatchObject({
      processingStatus: "history_only",
      streamId: null,
      streamGeneration: null,
      claimToken: null,
      claimJobId: null,
    });
  });

  it("keeps dry-run read-only and records a deterministic ordered review digest", async () => {
    const clinicId = await createOrganization("Terminal dry run");
    const firstId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-dry-a" });
    const secondId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-dry-b", status: "ignored" });
    const before = await testDb().execute(sql`
      select jsonb_agg(to_jsonb(event) order by event.id) as events
      from inbound_events event where event.organization_id = ${clinicId}::uuid
    `);

    const result = await settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId));
    const after = await testDb().execute(sql`
      select jsonb_agg(to_jsonb(event) order by event.id) as events
      from inbound_events event where event.organization_id = ${clinicId}::uuid
    `);

    const orderedIds = [firstId, secondId].sort();
    expect(result.eventIds).toEqual(orderedIds);
    expect(result.reviewDigest).toBe(createHash("sha256").update(JSON.stringify({
      clinicId,
      actor: ACTOR,
      cutoff: CUTOFF.toISOString(),
      eventIds: orderedIds,
    })).digest("hex"));
    expect(after.rows).toEqual(before.rows);
  });

  it("rejects retryable, claimed, post-cutoff, job-backed, and outbound-backed rows", async () => {
    const clinicId = await createOrganization("Terminal ineligible");
    const pendingId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-pending", status: "pending", processedAt: null });
    await createTerminalEvent({ clinicId, providerMessageId: "terminal-failed", status: "failed", processedAt: null });
    await createTerminalEvent({ clinicId, providerMessageId: "terminal-processing", status: "processing", processedAt: null });
    await createTerminalEvent({ clinicId, providerMessageId: "terminal-claimed", claim: true });
    await createTerminalEvent({
      clinicId,
      providerMessageId: "terminal-post-cutoff",
      receivedAt: AFTER_CUTOFF,
      processedAt: BEFORE_CUTOFF,
    });
    const jobBackedId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-job-backed" });
    await testDb().insert(jobs).values({
      queue: "message.process",
      status: "pending",
      payload: { inboundEventId: jobBackedId },
      dedupeKey: `inbound-event:${jobBackedId}`,
      inboundEventId: jobBackedId,
    });
    const lockedJobBackedId = await createTerminalEvent({
      clinicId,
      providerMessageId: "terminal-locked-job-backed",
    });
    await testDb().insert(jobs).values({
      queue: "message.process",
      status: "processing",
      payload: { inboundEventId: lockedJobBackedId },
      dedupeKey: `inbound-event:${lockedJobBackedId}`,
      inboundEventId: lockedJobBackedId,
      lockedAt: BEFORE_CUTOFF,
      lockedBy: "legacy-worker",
    });
    const outboundBackedId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-outbound-backed" });
    const conversationId = await createConversation(clinicId);
    await testDb().insert(outboundMessages).values({
      clinicId,
      conversationId,
      channel: "whatsapp",
      payload: { turnId: outboundBackedId, text: "fixture" },
      deliveryKind: "text",
      category: "reply",
      sequence: 1,
      status: "pending",
      authorizationKind: "legacy",
      authorizationVersion: 1,
    });

    const result = await settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId));

    expect(result).toMatchObject({ selected: 8, eligible: 0, ineligible: 8, conflicts: 0 });
    await expect(settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId, {
      apply: true,
      reviewedEventIds: [pendingId],
      reviewDigest: "0".repeat(64),
    }))).rejects.toThrow();
  });

  it("keeps multiple-authority evidence as a conflict and never archives it", async () => {
    const clinicId = await createOrganization("Terminal conflict");
    const phone = "5511999990001";
    const thread = "terminal-conflict-thread";
    await createActiveStream({
      clinicId,
      kind: "phone",
      providerScope: "__provider_independent__",
      normalizedValue: phone,
    });
    await createActiveStream({
      clinicId,
      kind: "provider_thread",
      providerScope: "z_api:terminal-history-instance",
      normalizedValue: thread,
    });
    const eventId = await createTerminalEvent({
      clinicId,
      providerMessageId: "terminal-conflict",
      phone,
      providerThreadId: thread,
    });

    const result = await settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId));

    expect(result).toMatchObject({ selected: 0, eligible: 0, ineligible: 0, conflicts: 1 });
    expect(await readEvent(eventId)).toMatchObject({ processingStatus: "processed" });
  });

  it("changes only the reviewed event IDs and leaves later candidates untouched", async () => {
    const clinicId = await createOrganization("Terminal reviewed IDs");
    const firstId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-reviewed-a" });
    const secondId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-reviewed-b" });
    const reviewed = await settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId));
    const laterId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-reviewed-later" });

    const applied = await applyReviewed(reviewed);

    expect(applied.eventIds).toEqual([firstId, secondId].sort());
    expect(await readEvent(firstId)).toMatchObject({ processingStatus: "history_only" });
    expect(await readEvent(secondId)).toMatchObject({ processingStatus: "history_only" });
    expect(await readEvent(laterId)).toMatchObject({ processingStatus: "processed" });
  });

  it("never changes a matching row in another tenant", async () => {
    const clinicId = await createOrganization("Terminal tenant A");
    const otherClinicId = await createOrganization("Terminal tenant B");
    const eventId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-tenant-shared" });
    const otherEventId = await createTerminalEvent({
      clinicId: otherClinicId,
      providerMessageId: "terminal-tenant-shared",
    });

    await applyReviewed(await settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId)));

    expect(await readEvent(eventId)).toMatchObject({ processingStatus: "history_only" });
    expect(await readEvent(otherEventId)).toMatchObject({ processingStatus: "processed" });
  });

  it("cannot claim, repair, mutate, or recreate work for settled terminal history", async () => {
    const clinicId = await createOrganization("Terminal no resurrection");
    const eventId = await createTerminalEvent({
      clinicId,
      providerMessageId: "terminal-no-resurrection",
      phone: "5511888880001",
    });
    await applyReviewed(await settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId)));
    const batch = createEmbeddedAtomicDatabaseBatch(runtime!.pool);
    const store = new DrizzleInboundEventStore(batch);
    const queue = new DrizzleJobQueue();
    const authority = new DrizzleWhatsAppStreamAuthority(batch);

    await store.markInboundEventPending(eventId);
    await store.markInboundEventProcessing(eventId);
    await store.markInboundEventFailed(eventId);
    const duplicate = await store.recordInboundEventAndEnqueue({
      clinicId,
      provider: "z_api",
      providerMessageId: "terminal-no-resurrection",
      conversationKey: "5511888880001",
      aliases: [{
        kind: "phone",
        providerScope: "__provider_independent__",
        normalizedValue: "5511888880001",
      }],
      payload: {
        phone: "5511888880001",
        instanceId: "terminal-history-instance",
        messageId: "terminal-no-resurrection",
      },
      normalizedText: null,
      mediaType: null,
      dedupeKey: `terminal-history:${clinicId}:terminal-no-resurrection`,
      receivedAt: BEFORE_CUTOFF,
    });

    expect(duplicate).toMatchObject({ outcome: "history_only", inboundEventId: eventId, jobId: null });
    await expect(queue.claimNextInboundWork({ workerId: "terminal-worker", now: AFTER_CUTOFF })).resolves.toBeNull();
    await expect(authority.repairInboundAuthorityJob({
      inboundEventId: eventId,
      now: AFTER_CUTOFF,
      olderThan: AFTER_CUTOFF,
    })).resolves.toEqual({ outcome: "ineligible", jobId: null });
    expect(await readEvent(eventId)).toMatchObject({ processingStatus: "history_only" });
    const persistedJobs = await testDb().select({ id: jobs.id }).from(jobs)
      .where(eq(jobs.inboundEventId, eventId));
    expect(persistedJobs).toHaveLength(0);
  });

  it("rejects creating or sending an outbound reply tied to settled terminal history", async () => {
    const clinicId = await createOrganization("Terminal no outbound");
    const conversationId = await createConversation(clinicId);
    const eventId = await createTerminalEvent({ clinicId, providerMessageId: "terminal-no-outbound" });
    await applyReviewed(await settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId)));
    const store = new DrizzleOutboundMessageStore();

    await expect(store.createOutboundMessageAndEnqueue({
      clinicId,
      conversationId,
      channel: "whatsapp",
      payload: { turnId: eventId, text: "must not send" },
      deliveryKind: "text",
      category: "reply",
      dedupeKey: `terminal-outbound:${eventId}`,
      authorization: { kind: "legacy" },
    }, { turnId: eventId })).rejects.toThrow("Outbound authorization rejected");
    const [persisted] = await testDb().insert(outboundMessages).values({
      clinicId,
      conversationId,
      channel: "whatsapp",
      payload: { turnId: eventId, text: "must not send" },
      deliveryKind: "text",
      category: "reply",
      sequence: 2,
      status: "pending",
      authorizationKind: "legacy",
      authorizationVersion: 1,
    }).returning({ id: outboundMessages.id });
    await expect(store.authorizeOutboundMessageForSend(persisted.id)).resolves.toEqual({
      authorized: false,
      reason: "terminal_legacy_history",
    });
    const created = await testDb().select({ id: outboundMessages.id }).from(outboundMessages)
      .where(eq(outboundMessages.clinicId, clinicId));
    expect(created).toHaveLength(1);
  });

  it("reports terminal legacy history as non-blocking while ordinary unresolved remains blocking", async () => {
    const clinicId = await createOrganization("Terminal validation");
    await createTerminalEvent({ clinicId, providerMessageId: "terminal-validation-history" });
    await applyReviewed(await settleWhatsAppTerminalLegacyHistory(settlementOptions(clinicId)));

    const clean = await validateWhatsAppStreamAuthority(clinicId);
    expect(clean.clean).toBe(true);
    expect(clean.metrics).toContainEqual({ metric: "unresolved_events", count: 0 });
    expect(clean.metrics).toContainEqual({ metric: "terminal_legacy_events", count: 1 });
    expect(clean.issues).not.toContain("terminal_legacy_events=1");

    const malformedHistoryId = await createTerminalEvent({
      clinicId,
      providerMessageId: "terminal-validation-malformed-history",
      status: "pending",
      processedAt: null,
    });
    await testDb().update(inboundEvents).set({ processingStatus: "history_only" })
      .where(eq(inboundEvents.id, malformedHistoryId));
    const malformed = await validateWhatsAppStreamAuthority(clinicId);
    expect(malformed.clean).toBe(false);
    expect(malformed.metrics).toContainEqual({ metric: "unresolved_events", count: 1 });
    expect(malformed.metrics).toContainEqual({ metric: "terminal_legacy_events", count: 1 });

    await createTerminalEvent({
      clinicId,
      providerMessageId: "terminal-validation-unresolved",
      status: "pending",
      processedAt: null,
    });
    const blocked = await validateWhatsAppStreamAuthority(clinicId);
    expect(blocked.clean).toBe(false);
    expect(blocked.metrics).toContainEqual({ metric: "unresolved_events", count: 2 });
    expect(blocked.metrics).toContainEqual({ metric: "terminal_legacy_events", count: 1 });
  });

  it("accepts a pre-activation sent legacy outbound as version-2 audit history", async () => {
    const clinicId = await createOrganization("Terminal outbound validation");
    const conversationId = await createConversation(clinicId);
    await testDb().update(conversationAuthority).set({
      version: 2,
      activatedAt: CUTOFF,
      updatedAt: CUTOFF,
    }).where(eq(conversationAuthority.clinicId, clinicId));
    await testDb().insert(outboundMessages).values({
      clinicId,
      conversationId,
      channel: "whatsapp",
      payload: { version: 1, kind: "fixture" },
      deliveryKind: "text",
      category: "reminder",
      sequence: 1,
      status: "sent",
      providerMessageId: "terminal-outbound-provider-id",
      authorizationKind: "legacy",
      authorizationVersion: 1,
      createdAt: BEFORE_CUTOFF,
      sentAt: BEFORE_CUTOFF,
    });

    const report = await validateWhatsAppStreamAuthority(clinicId);

    expect(report.clean).toBe(true);
    expect(report.metrics).toContainEqual({
      metric: "invalid_outbound_authorization",
      count: 0,
    });
    expect(report.metrics).toContainEqual({
      metric: "terminal_legacy_outbounds",
      count: 1,
    });
  });
});
