import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { count, eq } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import {
  conversations,
  conversationStates,
  leads,
  organizations,
} from "@/infrastructure/db/schema";
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
    set(value: unknown) { activeDb = value; },
  };
});

vi.mock("@/infrastructure/db/client", () => ({ db: databaseMock.proxy }));

type TestDb = ReturnType<typeof drizzleNodePostgres>;

describe("V2 journey state — PostgreSQL exact transitions", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let db: TestDb;
  let conversationId: string;

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    db = drizzleNodePostgres(runtime.pool);
    databaseMock.set(db);
    await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
    const [organization] = await db.insert(organizations).values({
      name: "V2 Journey State Test",
      slug: `v2-journey-state-${randomUUID().slice(0, 8)}`,
      specialty: "dental",
      operationalStatus: "test",
      isTest: true,
    }).returning({ id: organizations.id });
    const [lead] = await db.insert(leads).values({
      clinicId: organization.id,
      channel: "whatsapp",
    }).returning({ id: leads.id });
    const [conversation] = await db.insert(conversations).values({
      clinicId: organization.id,
      leadId: lead.id,
      channel: "whatsapp",
    }).returning({ id: conversations.id });
    conversationId = conversation.id;
  });

  afterAll(async () => {
    try {
      await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
    } finally {
      databaseMock.set(undefined);
    }
  });

  it("binds a starter to one turn and reuses it on exact retry", async () => {
    const machine = new ConversationStateMachine();
    const turnId = randomUUID();
    const input = {
      conversationId,
      turnId,
      treatmentId: randomUUID(),
      treatmentName: "Jornada",
      ttlMinutes: 240,
      stepIndex: 0,
      selectedTreatment: null,
      expectedCurrentStateId: null,
    };

    const first = await machine.startTreatmentPipelineForTurn(input);
    const retry = await machine.startTreatmentPipelineForTurn(input);
    const competing = await machine.startTreatmentPipelineForTurn({
      ...input,
      turnId: randomUUID(),
    });

    expect(first).toMatchObject({ applied: true });
    expect(retry).toMatchObject({ applied: false, state: { id: first.state!.id } });
    expect(competing).toMatchObject({ applied: false, state: { id: first.state!.id } });
    const [rows] = await db.select({ value: count() }).from(conversationStates)
      .where(eq(conversationStates.conversationId, conversationId));
    expect(rows.value).toBe(1);
  });

  it("lets only one competing turn consume an exact predecessor", async () => {
    const [idle] = await db.insert(conversationStates).values({
      conversationId,
      state: "idle",
      payload: null,
    }).returning({ id: conversationStates.id });
    const treatmentId = randomUUID();
    const machine = new ConversationStateMachine();
    const results = await Promise.all([randomUUID(), randomUUID()].map((turnId) =>
      machine.startTreatmentPipelineForTurn({
        conversationId,
        turnId,
        treatmentId,
        treatmentName: "Jornada concorrente",
        ttlMinutes: 240,
        stepIndex: 0,
        selectedTreatment: null,
        expectedCurrentStateId: idle.id,
      })));

    expect(results.filter(({ applied }) => applied)).toHaveLength(1);
    const current = await machine.getCurrentState(conversationId);
    expect(current).toMatchObject({
      state: "treatment_pipeline_active",
      supersedesStateId: idle.id,
      payload: { treatmentId, stepIndex: 0 },
    });
  });
});
