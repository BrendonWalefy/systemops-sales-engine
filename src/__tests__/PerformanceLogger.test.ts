import { afterEach, describe, expect, it, vi } from "vitest";
import {
  measureServerOperation,
  recordServerPerformance,
} from "@/infrastructure/observability/performance-logger";

describe("performance logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the work result and emits only sanitized fields", async () => {
    const emit = vi.fn();
    const ticks = [100, 137];

    const result = await measureServerOperation({
      clinicId: "clinic-id",
      surface: "inbox_list",
      operation: "inbox_base_query",
      enabled: true,
    }, async () => "rows", {
      now: () => ticks.shift()!,
      emit,
    });

    expect(result).toBe("rows");
    expect(emit).toHaveBeenCalledWith({
      schemaVersion: 1,
      source: "server",
      surface: "inbox_list",
      operation: "inbox_base_query",
      durationMs: 37,
      outcome: "ok",
      clinicId: "clinic-id",
    });
  });

  it("does not emit when disabled", async () => {
    const emit = vi.fn();

    await measureServerOperation({
      clinicId: "clinic-id",
      surface: "agenda",
      operation: "agenda_bootstrap",
      enabled: false,
    }, async () => undefined, { now: () => 0, emit });

    expect(emit).not.toHaveBeenCalled();
  });

  it("emits an error outcome and rethrows the original error", async () => {
    const emit = vi.fn();
    const failure = new Error("database unavailable");
    const ticks = [200, 215];

    await expect(measureServerOperation({
      clinicId: "clinic-id",
      surface: "dashboard",
      operation: "dashboard_total",
      enabled: true,
    }, async () => {
      throw failure;
    }, {
      now: () => ticks.shift()!,
      emit,
    })).rejects.toBe(failure);

    expect(emit).toHaveBeenCalledWith({
      schemaVersion: 1,
      source: "server",
      surface: "dashboard",
      operation: "dashboard_total",
      durationMs: 15,
      outcome: "error",
      clinicId: "clinic-id",
    });
  });

  it("preserves the work outcome when telemetry emission fails", async () => {
    const failure = new Error("database unavailable");
    const deps = {
      now: () => 0,
      emit: () => {
        throw new Error("log unavailable");
      },
    };

    await expect(measureServerOperation({
      clinicId: "clinic-id",
      surface: "dashboard",
      operation: "dashboard_total",
      enabled: true,
    }, async () => {
      throw failure;
    }, deps)).rejects.toBe(failure);

    await expect(measureServerOperation({
      clinicId: "clinic-id",
      surface: "dashboard",
      operation: "dashboard_total",
      enabled: true,
    }, async () => "rows", deps)).resolves.toBe("rows");
  });

  it("uses the opt-in environment flag when enablement is omitted", async () => {
    const emit = vi.fn();
    vi.stubEnv("PERFORMANCE_TELEMETRY_ENABLED", "1");

    await measureServerOperation({
      clinicId: "clinic-id",
      surface: "clinic_shell",
      operation: "shell_context",
    }, async () => undefined, { now: () => 10, emit });

    expect(emit).toHaveBeenCalledOnce();
  });

  it("writes clinic identity only as logger context", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    recordServerPerformance({
      schemaVersion: 1,
      source: "server",
      surface: "conversation",
      operation: "conversation_total",
      durationMs: 42,
      outcome: "ok",
      clinicId: "clinic-id",
    });

    const output = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(output).toMatchObject({
      msg: "performance.sample",
      scope: "PerformanceTelemetry",
      clinicId: "clinic-id",
      schemaVersion: 1,
      source: "server",
      surface: "conversation",
      operation: "conversation_total",
      durationMs: 42,
      outcome: "ok",
    });
    expect(Object.keys(output)).toEqual([
      "level",
      "ts",
      "msg",
      "scope",
      "clinicId",
      "schemaVersion",
      "source",
      "surface",
      "operation",
      "durationMs",
      "outcome",
    ]);
  });

  it.each([
    ["inbox_list", "inbox_total"],
    ["conversation", "conversation_total"],
    ["dashboard", "dashboard_total"],
  ] as const)("starts %s/%s before late clinic context is resolved", async (surface, operation) => {
    const events: string[] = [];
    const ticks = [100, 125];
    let clinicId: string | null = null;

    await measureServerOperation({
      getClinicId: () => {
        events.push("context");
        return clinicId;
      },
      surface,
      operation,
      enabled: true,
    }, async () => {
      events.push("tenant_resolution");
      clinicId = "clinic-id";
      events.push("prepared_props");
    }, {
      now: () => {
        events.push("clock");
        return ticks.shift()!;
      },
      emit: (sample) => {
        events.push("emit");
        expect(sample.clinicId).toBe("clinic-id");
      },
    });

    expect(events).toEqual([
      "clock",
      "tenant_resolution",
      "prepared_props",
      "clock",
      "context",
      "emit",
    ]);
  });

  it("drops forbidden runtime fields before logging", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    recordServerPerformance({
      schemaVersion: 1,
      source: "server",
      surface: "inbox_list",
      operation: "inbox_total",
      durationMs: 42,
      outcome: "ok",
      clinicId: "clinic-id",
      query: "?lead=private-id",
      headers: { authorization: "secret" },
    } as Parameters<typeof recordServerPerformance>[0]);

    const output = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(output).not.toHaveProperty("query");
    expect(output).not.toHaveProperty("headers");
  });

  it("preserves the work result when strict sample parsing rejects a measurement", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const ticks = [0, 120_001];

    await expect(measureServerOperation({
      clinicId: "clinic-id",
      surface: "dashboard",
      operation: "dashboard_total",
      enabled: true,
    }, async () => "rows", {
      now: () => ticks.shift()!,
      emit: recordServerPerformance,
    })).resolves.toBe("rows");

    expect(log).not.toHaveBeenCalled();
  });

  it("preserves the work outcome when late clinic context cannot be resolved", async () => {
    const emit = vi.fn();
    const failure = new Error("tenant unavailable");
    const input = {
      getClinicId: () => null,
      surface: "dashboard" as const,
      operation: "dashboard_total" as const,
      enabled: true,
    };
    const deps = { now: () => 0, emit };

    await expect(measureServerOperation(input, async () => "rows", deps)).resolves.toBe("rows");
    await expect(measureServerOperation(input, async () => {
      throw failure;
    }, deps)).rejects.toBe(failure);
    expect(emit).not.toHaveBeenCalled();
  });
});
