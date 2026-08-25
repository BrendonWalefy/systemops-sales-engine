import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import {
  conversationAuthority,
  conversations,
  jobs,
  leads,
  organizations,
  outboundMessages,
} from "@/infrastructure/db/schema";
import { DrizzleConversationAuthorityStore } from "@/infrastructure/repositories/drizzle-conversation-authority-store";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import {
  cleanupEmbeddedAuthorityDatabase,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "@/__tests__/helpers/embedded-authority-database";
import { activateWhatsAppStreamAuthority } from "../../scripts/activate-whatsapp-stream-authority";
import {
  parseTerminalLegacyOutboundSettlementOptions,
  settleWhatsAppTerminalLegacyOutbounds,
  type TerminalLegacyOutboundSettlementResult,
} from "../../scripts/settle-whatsapp-terminal-legacy-outbounds";
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
type OutboundStatus = "pending" | "processing" | "sent" | "failed" | "dead" | "cancelled";

const VERSION_ONE_AT = new Date("2026-08-24T18:00:00.000Z");
const VERSION_TWO_AT = new Date("2026-08-24T20:00:00.000Z");
const BEFORE_ACTIVATION = new Date("2026-08-24T19:00:00.000Z");
const AFTER_ACTIVATION = new Date("2026-08-24T21:00:00.000Z");
const ACTOR = "Brendon Walefy";

function testDb(): TestDb {
  return databaseMock.proxy as TestDb;
}

function uniqueSlug(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

async function createOrganization(label: string, version: 1 | 2 = 2): Promise<string> {
  const [organization] = await testDb().insert(organizations).values({
    name: label,
    slug: uniqueSlug(label.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
    specialty: "dental",
    operationalStatus: "test",
    isTest: true,
  }).returning({ id: organizations.id });
  await testDb().insert(conversationAuthority).values({
    clinicId: organization.id,
    version,
    activatedAt: version === 2 ? VERSION_TWO_AT : null,
    activatedBy: ACTOR,
    updatedAt: version === 2 ? VERSION_TWO_AT : VERSION_ONE_AT,
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

async function createOutbound(input: Readonly<{
  clinicId: string;
  category?: "reply" | "reminder";
  status?: OutboundStatus;
  createdAt?: Date;
  sentAt?: Date | null;
  authorizationKind?: "legacy" | null;
  authorizationVersion?: number | null;
}>): Promise<string> {
  const conversationId = await createConversation(input.clinicId);
  const [outbound] = await testDb().insert(outboundMessages).values({
    clinicId: input.clinicId,
    conversationId,
    channel: "whatsapp",
    payload: { version: 1, kind: "fixture", immutable: randomUUID() },
    deliveryKind: "text",
    category: input.category ?? "reply",
    sequence: 1,
    status: input.status ?? "sent",
    providerMessageId: `provider-${randomUUID()}`,
    authorizationKind: input.authorizationKind ?? null,
    authorizationVersion: input.authorizationVersion ?? null,
    createdAt: input.createdAt ?? BEFORE_ACTIVATION,
    sentAt: input.sentAt === undefined ? BEFORE_ACTIVATION : input.sentAt,
  }).returning({ id: outboundMessages.id });
  return outbound.id;
}

function settlementOptions(clinicId: string, input: Partial<{
  apply: boolean;
  reviewedOutboundIds: readonly string[];
  reviewDigest: string;
}> = {}) {
  return {
    clinicId,
    actor: ACTOR,
    apply: input.apply ?? false,
    batchSize: 500,
    afterId: null,
    reviewedOutboundIds: input.reviewedOutboundIds ?? [],
    reviewDigest: input.reviewDigest ?? null,
  };
}

async function applyReviewed(
  result: TerminalLegacyOutboundSettlementResult,
): Promise<TerminalLegacyOutboundSettlementResult> {
  return settleWhatsAppTerminalLegacyOutbounds(settlementOptions(result.clinicId, {
    apply: true,
    reviewedOutboundIds: result.outboundIds,
    reviewDigest: result.reviewDigest,
  }));
}

async function readOutbound(outboundId: string) {
  const [outbound] = await testDb().select().from(outboundMessages)
    .where(eq(outboundMessages.id, outboundId)).limit(1);
  return outbound;
}

describe("terminal legacy WhatsApp outbound settlement", () => {
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

  it("is bounded and dry-run by default", () => {
    const clinicId = "10000000-0000-4000-8000-000000000001";
    expect(parseTerminalLegacyOutboundSettlementOptions([
      "--clinic-id", clinicId,
      "--actor", ACTOR,
    ])).toEqual({
      clinicId,
      actor: ACTOR,
      apply: false,
      batchSize: 500,
      afterId: null,
      reviewedOutboundIds: [],
      reviewDigest: null,
    });
    expect(() => parseTerminalLegacyOutboundSettlementOptions([
      "--clinic-id", clinicId,
      "--actor", ACTOR,
      "--batch-size", "501",
    ])).toThrow("between 1 and 500");
  });

  it("settles reviewed pre-activation sent rows without changing delivery evidence", async () => {
    const clinicId = await createOrganization("Legacy outbound eligible");
    const replyId = await createOutbound({ clinicId, category: "reply" });
    const reminderId = await createOutbound({ clinicId, category: "reminder" });
    const before = await Promise.all([readOutbound(replyId), readOutbound(reminderId)]);

    const dryRun = await settleWhatsAppTerminalLegacyOutbounds(settlementOptions(clinicId));

    expect(dryRun).toMatchObject({
      mode: "dry-run",
      clinicId,
      actor: ACTOR,
      cutoff: VERSION_TWO_AT.toISOString(),
      selected: 2,
      eligible: 2,
      ineligible: 0,
      pendingOrProcessing: 0,
      activeOrLockedJobs: 0,
      crossTenantRows: 0,
      categories: { reply: 1, reminder: 1 },
      outboundIds: [replyId, reminderId].sort(),
    });
    expect(dryRun.reviewDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await Promise.all([readOutbound(replyId), readOutbound(reminderId)])).toEqual(before);

    const applied = await applyReviewed(dryRun);
    expect(applied).toMatchObject({ mode: "apply", settled: 2 });
    expect(await testDb().select({ id: jobs.id }).from(jobs)).toHaveLength(0);
    const after = await Promise.all([readOutbound(replyId), readOutbound(reminderId)]);
    after.forEach((row, index) => {
      expect(row).toMatchObject({
        status: before[index].status,
        payload: before[index].payload,
        providerMessageId: before[index].providerMessageId,
        sequence: before[index].sequence,
        sentAt: before[index].sentAt,
        authorizationKind: "legacy",
        authorizationVersion: 1,
        authorizationStreamId: null,
        authorizationGeneration: null,
        authorizationInboundEventId: null,
        authorizationClaimJobId: null,
        authorizationClaimTokenDigest: null,
      });
    });
  });

  it("rejects retryable, post-activation, partially authorized, and active-job rows", async () => {
    const clinicId = await createOrganization("Legacy outbound ineligible");
    await createOutbound({ clinicId, status: "pending", sentAt: null });
    await createOutbound({ clinicId, status: "processing", sentAt: null });
    await createOutbound({ clinicId, status: "failed", sentAt: null });
    await createOutbound({ clinicId, createdAt: AFTER_ACTIVATION, sentAt: AFTER_ACTIVATION });
    await createOutbound({ clinicId, authorizationVersion: 1 });
    const jobFixtures = [
      { status: "pending" as const, locked: false },
      { status: "processing" as const, locked: false },
      { status: "failed" as const, locked: false },
      { status: "done" as const, locked: true },
    ];
    for (const fixture of jobFixtures) {
      const outboundId = await createOutbound({ clinicId });
      await testDb().insert(jobs).values({
        queue: "message.send",
        status: fixture.status,
        payload: { outboundMessageId: outboundId },
        dedupeKey: `outbound-message:${outboundId}`,
        lockedAt: fixture.locked ? BEFORE_ACTIVATION : null,
        lockedBy: fixture.locked ? "legacy-worker" : null,
      });
    }

    const result = await settleWhatsAppTerminalLegacyOutbounds(settlementOptions(clinicId));

    expect(result).toMatchObject({
      selected: 9,
      eligible: 0,
      ineligible: 9,
      pendingOrProcessing: 2,
      activeOrLockedJobs: 4,
      crossTenantRows: 0,
    });
  });

  it("applies only exact reviewed IDs and fails closed on cross-tenant IDs", async () => {
    const clinicId = await createOrganization("Legacy outbound tenant A");
    const otherClinicId = await createOrganization("Legacy outbound tenant B");
    const firstId = await createOutbound({ clinicId });
    const secondId = await createOutbound({ clinicId });
    const otherId = await createOutbound({ clinicId: otherClinicId });
    const reviewed = await settleWhatsAppTerminalLegacyOutbounds(settlementOptions(clinicId));

    await expect(settleWhatsAppTerminalLegacyOutbounds(settlementOptions(clinicId, {
      apply: true,
      reviewedOutboundIds: [...reviewed.outboundIds, otherId],
      reviewDigest: reviewed.reviewDigest,
    }))).rejects.toThrow("cross-tenant");
    expect((await readOutbound(otherId)).authorizationKind).toBeNull();

    await applyReviewed(reviewed);
    expect((await readOutbound(firstId)).authorizationKind).toBe("legacy");
    expect((await readOutbound(secondId)).authorizationKind).toBe("legacy");
    expect((await readOutbound(otherId)).authorizationKind).toBeNull();
  });

  it("rejects apply when the bounded tenant batch changes after dry-run", async () => {
    const clinicId = await createOrganization("Legacy outbound changed review");
    const reviewedId = await createOutbound({ clinicId });
    const reviewed = await settleWhatsAppTerminalLegacyOutbounds(settlementOptions(clinicId));
    const laterId = await createOutbound({ clinicId, status: "pending", sentAt: null });

    await expect(applyReviewed(reviewed)).rejects.toThrow("review changed");

    expect((await readOutbound(reviewedId)).authorizationKind).toBeNull();
    expect((await readOutbound(laterId)).authorizationKind).toBeNull();
  });

  it("keeps a settled terminal row permanently outside sender preflight", async () => {
    const clinicId = await createOrganization("Legacy outbound sender fence");
    const outboundId = await createOutbound({ clinicId });
    await applyReviewed(await settleWhatsAppTerminalLegacyOutbounds(settlementOptions(clinicId)));
    const before = await readOutbound(outboundId);

    await expect(new DrizzleOutboundMessageStore().authorizeOutboundMessageForSend(outboundId))
      .resolves.toEqual({ authorized: false, reason: "outbound_not_sendable" });

    expect(await readOutbound(outboundId)).toEqual(before);
  });

  it("reports only well-formed terminal legacy outbounds as informational", async () => {
    const clinicId = await createOrganization("Legacy outbound report");
    await createOutbound({
      clinicId,
      authorizationKind: "legacy",
      authorizationVersion: 1,
    });
    await createOutbound({ clinicId });
    await createOutbound({
      clinicId,
      status: "pending",
      sentAt: null,
      authorizationKind: "legacy",
      authorizationVersion: 1,
    });
    await createOutbound({
      clinicId,
      status: "processing",
      sentAt: null,
      authorizationKind: "legacy",
      authorizationVersion: 1,
    });
    await createOutbound({
      clinicId,
      status: "failed",
      sentAt: null,
      authorizationKind: "legacy",
      authorizationVersion: 1,
    });
    await createOutbound({
      clinicId,
      createdAt: AFTER_ACTIVATION,
      sentAt: AFTER_ACTIVATION,
      authorizationKind: "legacy",
      authorizationVersion: 1,
    });

    const report = await validateWhatsAppStreamAuthority(clinicId);

    expect(report.clean).toBe(false);
    expect(report.metrics).toContainEqual({ metric: "terminal_legacy_outbounds", count: 1 });
    expect(report.metrics).toContainEqual({ metric: "invalid_outbound_authorization", count: 5 });
  });

  it("uses projected validation before a real monotonic 1 -> 2 compare-and-set", async () => {
    const clinicId = await createOrganization("Legacy projected activation", 1);
    const outboundId = await createOutbound({ clinicId });
    const store = new DrizzleConversationAuthorityStore();

    await expect(activateWhatsAppStreamAuthority({
      clinicId,
      expectedVersion: 1,
      nextVersion: 2,
      actor: ACTOR,
      now: VERSION_TWO_AT,
      store,
      validate: validateWhatsAppStreamAuthority,
      apply: false,
    })).rejects.toThrow("invalid_outbound_authorization=1");
    expect(await store.getVersion(clinicId)).toBe(1);

    await testDb().update(outboundMessages).set({
      authorizationKind: "legacy",
      authorizationVersion: 1,
    }).where(eq(outboundMessages.id, outboundId));
    await expect(activateWhatsAppStreamAuthority({
      clinicId,
      expectedVersion: 1,
      nextVersion: 2,
      actor: ACTOR,
      now: VERSION_TWO_AT,
      store,
      validate: validateWhatsAppStreamAuthority,
      apply: true,
    })).resolves.toMatchObject({ activated: true, version: 2 });
    expect(await store.getVersion(clinicId)).toBe(2);
  });
});
