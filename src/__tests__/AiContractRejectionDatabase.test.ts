import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import {
  aiContractRejectionAccessAudits,
  aiContractRejections,
  conversations,
  inboundEvents,
  leads,
  organizations,
  whatsappStreams,
} from "@/infrastructure/db/schema";
import { RuntimeAiContractRejectionRecorder } from "@/infrastructure/observability/runtime-ai-contract-rejection-recorder";
import { DrizzleAiContractRejectionStore } from "@/infrastructure/repositories/drizzle-ai-contract-rejection-store";
import { sealAiEvidence } from "@/infrastructure/crypto/ai-evidence-vault";
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

const KEY = "71".repeat(32);
const NOW = new Date("2026-08-27T03:00:00.000Z");

function testDb(): TestDb {
  return databaseMock.proxy as TestDb;
}

async function createAuthorityFixture(label: string) {
  const [organization] = await testDb().insert(organizations).values({
    name: label,
    slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`,
    specialty: "dental",
    operationalStatus: "test",
    isTest: true,
  }).returning({ id: organizations.id });
  const [lead] = await testDb().insert(leads).values({
    clinicId: organization.id,
    channel: "whatsapp",
    phone: `55${randomUUID().replace(/\D/g, "").padEnd(13, "0").slice(0, 13)}`,
  }).returning({ id: leads.id });
  const [conversation] = await testDb().insert(conversations).values({
    clinicId: organization.id,
    leadId: lead.id,
    channel: "whatsapp",
  }).returning({ id: conversations.id });
  const [stream] = await testDb().insert(whatsappStreams).values({
    clinicId: organization.id,
    conversationId: conversation.id,
    state: "active",
    currentGeneration: 1,
    conversationStreamOrder: 1,
    boundAt: NOW,
  }).returning({ id: whatsappStreams.id });
  const inboundEventId = randomUUID();
  await testDb().insert(inboundEvents).values({
    id: inboundEventId,
    clinicId: organization.id,
    provider: "z_api",
    providerMessageId: `${label}-${randomUUID()}`,
    conversationKey: `thread-${randomUUID()}`,
    payload: { test: true },
    dedupeKey: `evidence-${randomUUID()}`,
    processingStatus: "processing",
    receivedAt: NOW,
    streamId: stream.id,
    streamGeneration: 1,
    registeredAt: NOW,
  });
  await testDb().update(whatsappStreams).set({
    latestInboundEventId: inboundEventId,
  }).where(eq(whatsappStreams.id, stream.id));
  return {
    organizationId: organization.id,
    conversationId: conversation.id,
    streamId: stream.id,
    inboundEventId,
  };
}

function recorder(store = new DrizzleAiContractRejectionStore()) {
  return new RuntimeAiContractRejectionRecorder({
    store,
    seal: (rawOutput, aad) => sealAiEvidence(rawOutput, aad, KEY),
  });
}

function input(fixture: Awaited<ReturnType<typeof createAuthorityFixture>>, rawOutput: string) {
  return {
    organizationId: fixture.organizationId,
    conversationId: fixture.conversationId,
    inboundEventId: fixture.inboundEventId,
    turnId: fixture.inboundEventId,
    stage: "understanding_semantic" as const,
    modelId: "gpt-4o-mini",
    promptVersion: "dental-understanding.v1",
    contractVersion: "understanding.v1",
    attempt: 1,
    rawOutput,
    issues: [{
      path: ["entities", "service"],
      code: "service_required_for_request" as const,
    }],
    occurredAt: NOW,
  };
}

describe("AI contract rejection durable evidence", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let database: TestDb;

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

  it("persists one exact tenant-stream event and deduplicates its retry", async () => {
    const fixture = await createAuthorityFixture("Evidence dedupe");
    const evidenceRecorder = recorder();

    const first = await evidenceRecorder.capture(input(fixture, "rejected first"));
    const retry = await evidenceRecorder.capture(input(fixture, "rejected first"));
    const different = await evidenceRecorder.capture(input(fixture, "rejected second"));

    expect(first).toMatchObject({ status: "stored" });
    expect(retry).toEqual({ status: "deduplicated", evidenceRef: first.evidenceRef });
    expect(different).toMatchObject({ status: "stored" });
    expect(different.evidenceRef).not.toBe(first.evidenceRef);

    const rows = await testDb().select().from(aiContractRejections)
      .where(eq(aiContractRejections.organizationId, fixture.organizationId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.inboundEventId === fixture.inboundEventId)).toBe(true);
  });

  it("fails closed when tenant, conversation or inbound authority differs", async () => {
    const first = await createAuthorityFixture("Evidence first tenant");
    const second = await createAuthorityFixture("Evidence second tenant");
    const evidenceRecorder = recorder();

    const attempts = [
      { ...input(first, "wrong tenant"), organizationId: second.organizationId },
      { ...input(first, "wrong conversation"), conversationId: second.conversationId },
      { ...input(first, "wrong inbound"), inboundEventId: second.inboundEventId, turnId: second.inboundEventId },
    ];

    for (const attempt of attempts) {
      await expect(evidenceRecorder.capture(attempt)).resolves.toEqual({
        status: "persistence_failed",
      });
    }

    const rows = await testDb().select().from(aiContractRejections)
      .where(eq(aiContractRejections.organizationId, first.organizationId));
    expect(rows).toHaveLength(0);
  });

  it("fails closed when the bound stream is no longer active", async () => {
    const fixture = await createAuthorityFixture("Evidence inactive stream");
    await testDb().update(whatsappStreams).set({
      state: "retired",
      retiredAt: NOW,
      retirementReason: "manual",
    }).where(eq(whatsappStreams.id, fixture.streamId));

    await expect(recorder().capture(input(fixture, "inactive stream"))).resolves.toEqual({
      status: "persistence_failed",
    });

    const rows = await testDb().select().from(aiContractRejections)
      .where(eq(aiContractRejections.organizationId, fixture.organizationId));
    expect(rows).toHaveLength(0);
  });

  it("uses one database round trip per new warm capture within the p95 budget", async () => {
    const fixture = await createAuthorityFixture("Evidence warm capture");
    let executeCalls = 0;
    const countedDatabase = new Proxy(database, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === "execute" && typeof value === "function") {
          return (...args: unknown[]) => {
            executeCalls += 1;
            return value.apply(target, args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    databaseMock.set(countedDatabase);
    const durations: number[] = [];
    try {
      const evidenceRecorder = recorder();
      for (let index = 0; index < 20; index += 1) {
        const startedAt = performance.now();
        const captured = await evidenceRecorder.capture(
          input(fixture, `warm rejected output ${index}`),
        );
        durations.push(performance.now() - startedAt);
        expect(captured.status).toBe("stored");
      }
    } finally {
      databaseMock.set(database);
    }

    durations.sort((left, right) => left - right);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
    expect(executeCalls).toBe(20);
    expect(p95).toBeLessThanOrEqual(250);
  });

  it("lists sanitized summaries without ciphertext or output digest", async () => {
    const fixture = await createAuthorityFixture("Evidence summary");
    const store = new DrizzleAiContractRejectionStore();
    await recorder(store).capture(input(fixture, "private rejected output"));

    const summaries = await store.listByConversation(
      fixture.organizationId,
      fixture.conversationId,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      stage: "understanding_semantic",
      captureStatus: "stored",
      outputBytes: 23,
    });
    expect(JSON.stringify(summaries)).not.toContain("private rejected output");
    expect(JSON.stringify(summaries)).not.toMatch(/[a-f0-9]{64}/);
    expect(summaries[0]).not.toHaveProperty("encryptedOutput");
    expect(summaries[0]).not.toHaveProperty("outputSha256");
  });

  it("records reveal audit only for the exact rejection and tenant", async () => {
    const fixture = await createAuthorityFixture("Evidence audit");
    const store = new DrizzleAiContractRejectionStore();
    const captured = await recorder(store).capture(input(fixture, "audited raw"));
    const other = await createAuthorityFixture("Evidence audit other");

    await expect(store.recordRevealAudit({
      organizationId: fixture.organizationId,
      rejectionId: captured.evidenceRef!,
      ownerSubject: "owner@example.test",
      accessedAt: NOW,
    })).resolves.toBe(true);
    await expect(store.recordRevealAudit({
      organizationId: other.organizationId,
      rejectionId: captured.evidenceRef!,
      ownerSubject: "owner@example.test",
      accessedAt: NOW,
    })).resolves.toBe(false);

    const audits = await testDb().select().from(aiContractRejectionAccessAudits);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId: fixture.organizationId,
      rejectionId: captured.evidenceRef,
      action: "raw_output_revealed",
    });
  });
});
