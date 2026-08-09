import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_SAMPLES_PER_SESSION,
  normalizePerformanceRoute,
  parsePerformanceSample,
} from "@/application/observability/performance-telemetry";

describe("performance telemetry contract", () => {
  it.each([
    ["/app/inbox", "inbox_list"],
    ["/app/inbox/2e7162e4-0b75-49e5-8d53-a5b6337492bb", "conversation"],
    ["/app/agenda?new=1", "agenda"],
    ["/app/dashboard", "dashboard"],
  ])("normalizes %s without keeping IDs or queries", (raw, expected) => {
    expect(normalizePerformanceRoute(raw)).toBe(expected);
  });

  it("rejects an unknown route and non-finite duration", () => {
    expect(normalizePerformanceRoute("/owner/secret")).toBeNull();
    expect(() => parsePerformanceSample({
      schemaVersion: 1,
      source: "client",
      surface: "inbox_list",
      operation: "soft_navigation",
      durationMs: Number.POSITIVE_INFINITY,
      outcome: "ok",
    })).toThrow();
  });

  it("rejects arbitrary metadata that could contain private data", () => {
    expect(() => parsePerformanceSample({
      schemaVersion: 1,
      source: "client",
      surface: "inbox_list",
      operation: "soft_navigation",
      durationMs: 42,
      outcome: "ok",
      pathname: "/app/inbox/lead-123",
    })).toThrow();
  });

  it("caps one browser session", () => {
    expect(MAX_CLIENT_SAMPLES_PER_SESSION).toBe(30);
  });
});
