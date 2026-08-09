import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { summarizePerformanceSamples } from "@/application/observability/performance-summary";

describe("performance summary", () => {
  it("groups samples by source, surface, operation, and outcome with nearest-rank percentiles", () => {
    const durations = [100, 200, 300, 400, 500, 600, 700, 800];

    const summary = summarizePerformanceSamples(durations.map((durationMs) => ({
      schemaVersion: 1 as const,
      source: "client" as const,
      surface: "inbox_list" as const,
      operation: "soft_navigation" as const,
      durationMs,
      cacheState: "unknown" as const,
      outcome: "ok" as const,
    })));

    expect(summary).toEqual([{
      key: "client|inbox_list|soft_navigation|ok",
      count: 8,
      p50Ms: 400,
      p75Ms: 600,
      p95Ms: 800,
      maxMs: 800,
    }]);
  });

  it("separates mixed source, operation, and outcome groups in stable key order", () => {
    const summary = summarizePerformanceSamples([
      {
        schemaVersion: 1,
        source: "server",
        surface: "agenda",
        operation: "agenda_bootstrap",
        durationMs: 24,
        outcome: "error",
      },
      {
        schemaVersion: 1,
        source: "client",
        surface: "agenda",
        operation: "soft_navigation",
        durationMs: 48,
        outcome: "ok",
      },
      {
        schemaVersion: 1,
        source: "client",
        surface: "agenda",
        operation: "soft_navigation",
        durationMs: 12,
        outcome: "ok",
      },
    ]);

    expect(summary).toEqual([
      {
        key: "client|agenda|soft_navigation|ok",
        count: 2,
        p50Ms: 12,
        p75Ms: 48,
        p95Ms: 48,
        maxMs: 48,
      },
      {
        key: "server|agenda|agenda_bootstrap|error",
        count: 1,
        p50Ms: 24,
        p75Ms: 24,
        p95Ms: 24,
        maxMs: 24,
      },
    ]);
  });

  it("rejects invalid samples instead of aggregating an unversioned or unsupported shape", () => {
    expect(() => summarizePerformanceSamples([{
      schemaVersion: 2,
      source: "client",
      surface: "inbox_list",
      operation: "soft_navigation",
      durationMs: 100,
      outcome: "ok",
    }] as never)).toThrow();
  });

  it("prints only aggregate rows and marks groups below the baseline coverage", () => {
    const directory = mkdtempSync(join(tmpdir(), "performance-summary-"));
    const filePath = join(directory, "samples.jsonl");

    try {
      writeFileSync(filePath, [
        JSON.stringify({
          msg: "performance.sample",
          schemaVersion: 1,
          source: "client",
          surface: "inbox_list",
          operation: "soft_navigation",
          durationMs: 120,
          cacheState: "unknown",
          outcome: "ok",
          clinicId: "clinic-private-id",
        }),
        JSON.stringify({ msg: "other.event", patientName: "not-for-report" }),
        "not-json",
      ].join("\n"));

      const result = spawnSync(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "scripts/summarize-performance-logs.ts", filePath],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("client|inbox_list|soft_navigation|ok");
      expect(result.stdout).toContain("insufficient");
      expect(result.stdout).not.toContain("clinic-private-id");
      expect(result.stdout).not.toContain("not-for-report");
      expect(result.stdout).not.toContain("not-json");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a missing log path with usage guidance", () => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "scripts/summarize-performance-logs.ts"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage: npm run performance:summary -- <performance-log.jsonl>");
  });

  it("drops JSONL samples with an unsupported schema, source, operation, or outcome", () => {
    const directory = mkdtempSync(join(tmpdir(), "performance-summary-invalid-"));
    const filePath = join(directory, "samples.jsonl");

    try {
      writeFileSync(filePath, [
        { schemaVersion: 2, source: "client", surface: "inbox_list", operation: "soft_navigation", durationMs: 10, outcome: "ok" },
        { schemaVersion: 1, source: "worker", surface: "inbox_list", operation: "soft_navigation", durationMs: 20, outcome: "ok" },
        { schemaVersion: 1, source: "client", surface: "inbox_list", operation: "unapproved", durationMs: 30, outcome: "ok" },
        { schemaVersion: 1, source: "client", surface: "inbox_list", operation: "soft_navigation", durationMs: 40, outcome: "pending" },
        { schemaVersion: 1, source: "client", surface: "inbox_list", operation: "soft_navigation", durationMs: 50, outcome: "ok" },
      ].map((entry) => JSON.stringify({ msg: "performance.sample", ...entry })).join("\n"));

      const result = spawnSync(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "scripts/summarize-performance-logs.ts", filePath],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("| client|inbox_list|soft_navigation|ok | 1 |");
      expect(result.stdout).not.toContain("worker");
      expect(result.stdout).not.toContain("unapproved");
      expect(result.stdout).not.toContain("pending");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
