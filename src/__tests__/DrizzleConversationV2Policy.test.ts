import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { LIVE_COMPARISON_VERSION } from "@/application/conversation-v2/comparison-record";

const dbMock = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), delete: vi.fn() }));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

import { DrizzleConversationEnginePolicyReader } from "@/infrastructure/repositories/drizzle-conversation-engine-policy-reader";
import { DrizzleConversationV2ComparisonSink } from "@/infrastructure/repositories/drizzle-conversation-v2-comparison-sink";
import {
  conversationEngineEnum,
  conversationV2Comparisons,
  organizations,
} from "@/infrastructure/db/schema";
import { DrizzleClinicResetRepository } from "@/infrastructure/repositories/drizzle-clinic-reset-repository";

const ref = (tail: string): `hmac:${string}` => `hmac:${"a".repeat(63)}${tail}`;
function liveRecord(overrides: Record<string, unknown> = {}) {
  const emptyEngine = {
    status: "unsupported",
    understandingRequest: null,
    capabilityIds: [],
    decisionKinds: [],
    outcomeTypes: [],
    semanticClasses: [],
    finalTextCharacters: null,
    finalTextDigest: null,
    fallbackSource: null,
    errorCode: "shared_read_unavailable",
    model: null,
  };
  return {
    version: LIVE_COMPARISON_VERSION,
    turnRef: ref("1"),
    conversationRef: null,
    inputRef: ref("2"),
    occurredAt: "2026-08-16T12:00:00.000Z",
    commit: "e86201ad",
    configDigest: ref("3"),
    datasetDigest: null,
    v1: { ...emptyEngine, status: "observed", errorCode: null },
    v2: emptyEngine,
    intendedEffects: [],
    divergenceCodes: [],
    ...overrides,
  };
}

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

describe("Cycle I Drizzle engine policy and sanitized comparison persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares the closed DB enum, v1 organization default, retention table and indexes", () => {
    expect(conversationEngineEnum.enumValues).toEqual(["v1", "v1_with_v2_shadow", "v2_internal"]);
    expect(organizations.conversationEngine.default).toBe("v1");
    expect(organizations.conversationEngine.notNull).toBe(true);

    const config = getTableConfig(conversationV2Comparisons);
    expect(config.columns.map((column) => column.name)).toEqual([
      "turn_ref",
      "organization_id",
      "record",
      "occurred_at",
      "expires_at",
      "created_at",
    ]);
    expect(config.indexes.map((index) => index.config.name).sort()).toEqual([
      "conversation_v2_comparisons_expires_at_idx",
      "conversation_v2_comparisons_org_occurred_at_idx",
    ]);
  });

  it("reads one tenant exactly once and fails closed to v1 when it no longer exists", async () => {
    dbMock.select
      .mockReturnValueOnce(selectRows([{ engine: "v1_with_v2_shadow", isTest: true }]))
      .mockReturnValueOnce(selectRows([]));
    const reader = new DrizzleConversationEnginePolicyReader();

    await expect(reader.getConversationEnginePolicy("clinic-a")).resolves.toEqual({
      clinicId: "clinic-a",
      engine: "v1_with_v2_shadow",
      isTest: true,
    });
    await expect(reader.getConversationEnginePolicy("clinic-b")).resolves.toEqual({
      clinicId: "clinic-b",
      engine: "v1",
      isTest: false,
    });
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });

  it("parses the closed live record before insert and writes a 30-day expiry", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    dbMock.insert.mockReturnValue({ values });
    const sink = new DrizzleConversationV2ComparisonSink({
      allowedModelIds: new Set(),
      now: () => new Date("2026-08-16T12:00:00.000Z"),
    });

    await sink.append({ clinicId: "clinic-a", record: liveRecord() as never });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      turnRef: ref("1"),
      clinicId: "clinic-a",
      occurredAt: new Date("2026-08-16T12:00:00.000Z"),
      expiresAt: new Date("2026-09-15T12:00:00.000Z"),
    }));
    expect(Object.isFrozen(values.mock.calls[0]![0].record)).toBe(true);
  });

  it("rejects invalid/PII-bearing records before touching persistence", async () => {
    const sink = new DrizzleConversationV2ComparisonSink({ allowedModelIds: new Set() });
    await expect(sink.append({
      clinicId: "clinic-a",
      record: liveRecord({ leadMessage: "5511999999999" }) as never,
    })).rejects.toThrow();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("deletes comparison rows in clinic reset and reports the count", async () => {
    const select = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    dbMock.select.mockReturnValue(select);
    const deleteTables: unknown[] = [];
    dbMock.delete.mockImplementation((table: unknown) => {
      deleteTables.push(table);
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(table === conversationV2Comparisons ? [{ turnRef: ref("1") }] : []),
        }),
      };
    });

    const counts = await new DrizzleClinicResetRepository().deleteAllData("clinic-a");
    expect(deleteTables).toContain(conversationV2Comparisons);
    expect(counts.conversationV2Comparisons).toBe(1);
  });
});
