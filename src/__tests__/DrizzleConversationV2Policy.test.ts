import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getTableConfig } from "drizzle-orm/pg-core";
import { LIVE_COMPARISON_VERSION } from "@/application/conversation-v2/comparison-record";

const dbMock = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), delete: vi.fn() }));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));
vi.mock("@/app/api/cron/_auth", () => ({ requireCronAuthorization: () => null }));

import { DrizzleConversationEnginePolicyReader } from "@/infrastructure/repositories/drizzle-conversation-engine-policy-reader";
import { DrizzleClinicAutomationPolicyReader } from "@/infrastructure/repositories/drizzle-clinic-automation-policy-reader";
import { DrizzleConversationV2ComparisonSink } from "@/infrastructure/repositories/drizzle-conversation-v2-comparison-sink";
import {
  conversationEngineEnum,
  conversationV2Comparisons,
  organizations,
} from "@/infrastructure/db/schema";
import { DrizzleClinicResetRepository } from "@/infrastructure/repositories/drizzle-clinic-reset-repository";
import { GET as cleanupExpiredTraces } from "@/app/api/cron/decision-trace-cleanup/route";
import { decisionTraces } from "@/infrastructure/db/schema";

const ref = (tail: string): `hmac:${string}` => `hmac:${"a".repeat(63)}${tail}`;
function liveRecord(overrides: Record<string, unknown> = {}) {
  const emptyEngine = {
    status: "unsupported",
    understandingRequest: null,
    capabilityIds: [],
    decisionKinds: [],
    outcomes: [],
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
    v1: { ...emptyEngine, status: "unavailable", errorCode: "final_response_unavailable" },
    v2: emptyEngine,
    comparisonStatus: "not_measurable",
    comparisonReason: "v1_final_response_unavailable",
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
  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.insert.mockReset();
    dbMock.delete.mockReset();
  });

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

  it("returns the exact automation eligibility facts without exposing engine policy", async () => {
    dbMock.select.mockReturnValueOnce(selectRows([{
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: true,
      shadowModeEnabled: false,
    }]));
    const reader = new DrizzleClinicAutomationPolicyReader();

    await expect(reader.getInternalLabEligibilityFacts("systemops-lab")).resolves.toEqual({
      clinicId: "systemops-lab",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: true,
      shadowModeEnabled: false,
    });
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it("parses the closed live record before insert and writes a 30-day expiry", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    dbMock.insert.mockReturnValue({ values });
    const sink = new DrizzleConversationV2ComparisonSink({
      allowedModelIds: [],
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

  it("rejects proxy/accessor model allowlists in the sink constructor without executing traps", () => {
    let reads = 0;
    const proxied = new Proxy(["gpt-test"], {
      get(target, key, receiver) {
        reads += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        reads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(() => new DrizzleConversationV2ComparisonSink({
      allowedModelIds: proxied as never,
    })).toThrow(/model|allowlist|invalid/i);
    expect(reads).toBe(0);

    const proxiedConfig = new Proxy({ allowedModelIds: [] }, {
      getOwnPropertyDescriptor(target, key) {
        reads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(() => new DrizzleConversationV2ComparisonSink(proxiedConfig))
      .toThrow(/config|invalid/i);
    expect(reads).toBe(0);

    const input = {} as Record<string, unknown>;
    Object.defineProperty(input, "allowedModelIds", {
      enumerable: true,
      get() {
        reads += 1;
        return ["gpt-test"];
      },
    });
    expect(() => new DrizzleConversationV2ComparisonSink(input as never))
      .toThrow(/model|allowlist|invalid/i);
    expect(reads).toBe(0);
  });

  it("keeps sink allowlist and clock in runtime-private fields despite cast mutation", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    dbMock.insert.mockReturnValue({ values });
    const sink = new DrizzleConversationV2ComparisonSink({
      allowedModelIds: ["trusted-model"],
      now: () => new Date("2026-08-16T12:00:00.000Z"),
    });
    const cast = sink as unknown as {
      allowedModelIds?: Set<string>;
      now?: () => Date;
    };
    cast.allowedModelIds = new Set(["attacker-model"]);
    cast.now = () => new Date("2030-01-01T00:00:00.000Z");
    const record = liveRecord();
    const attackerRecord = {
      ...record,
      v2: {
        ...record.v2,
        model: {
          modelId: "attacker-model", calls: 1, inputTokens: null,
          outputTokens: null, latencyMs: 1, estimatedCostMinor: null,
        },
      },
    };

    await expect(sink.append({ clinicId: "clinic-a", record: attackerRecord as never }))
      .rejects.toThrow(/allowlist|model/i);
    expect(values).not.toHaveBeenCalled();

    await sink.append({ clinicId: "clinic-a", record: liveRecord() as never });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      expiresAt: new Date("2026-09-15T12:00:00.000Z"),
    }));
  });

  it("rejects proxy/accessor append envelopes before executing traps", async () => {
    const sink = new DrizzleConversationV2ComparisonSink({ allowedModelIds: [] });
    let reads = 0;
    const proxied = new Proxy({ clinicId: "clinic-a", record: liveRecord() }, {
      get(target, key, receiver) {
        reads += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        reads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    await expect(sink.append(proxied as never)).rejects.toThrow(/input|envelope|invalid/i);
    expect(reads).toBe(0);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("rejects invalid/PII-bearing records before touching persistence", async () => {
    const sink = new DrizzleConversationV2ComparisonSink({ allowedModelIds: [] });
    await expect(sink.append({
      clinicId: "clinic-a",
      record: liveRecord({ leadMessage: "5511999999999" }) as never,
    })).rejects.toThrow();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("deletes expired comparisons in bounded idempotent batches and leaves an empty batch untouched", async () => {
    const firstSelect = selectRows([{ turnRef: ref("1") }, { turnRef: ref("2") }]);
    const secondSelect = selectRows([]);
    dbMock.select.mockReturnValueOnce(firstSelect).mockReturnValueOnce(secondSelect);
    const returning = vi.fn().mockResolvedValue([{ turnRef: ref("1") }, { turnRef: ref("2") }]);
    dbMock.delete.mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) });
    const sink = new DrizzleConversationV2ComparisonSink({ allowedModelIds: [] });
    const now = new Date("2026-09-16T12:00:00.000Z");

    await expect(sink.deleteExpired(now, 2)).resolves.toBe(2);
    await expect(sink.deleteExpired(now, 2)).resolves.toBe(0);
    expect(firstSelect.limit).toHaveBeenCalledWith(2);
    expect(secondSelect.limit).toHaveBeenCalledWith(2);
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
    await expect(sink.deleteExpired(now, 1_001)).rejects.toThrow(/limit|bounded|invalid/i);
  });

  it("runs comparison retention in the canonical decision-trace cleanup route", async () => {
    dbMock.select
      .mockReturnValueOnce(selectRows([{ turnId: "trace-1" }]))
      .mockReturnValueOnce(selectRows([{ turnRef: ref("1") }]));
    dbMock.delete.mockImplementation((table: unknown) => ({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(table === decisionTraces
          ? [{ turnId: "trace-1" }]
          : [{ turnRef: ref("1") }]),
      }),
    }));

    const response = await cleanupExpiredTraces(new NextRequest("https://example.test/api/cron/decision-trace-cleanup"));
    await expect(response.json()).resolves.toEqual({
      deleted: { decisionTraces: 1, conversationV2Comparisons: 1 },
    });
  });

  it("still attempts comparison cleanup when decision-trace cleanup fails", async () => {
    dbMock.select
      .mockImplementationOnce(() => { throw new Error("decision trace cleanup unavailable"); })
      .mockReturnValueOnce(selectRows([]));

    await expect(cleanupExpiredTraces(
      new NextRequest("https://example.test/api/cron/decision-trace-cleanup"),
    )).rejects.toThrow(/decision trace cleanup unavailable/i);
    expect(dbMock.select).toHaveBeenCalledTimes(2);
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
