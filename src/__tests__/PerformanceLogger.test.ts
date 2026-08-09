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
});
