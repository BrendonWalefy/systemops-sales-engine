import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_OPERATIONS,
  createContentReadySample,
  createFirstOpenSample,
} from "@/application/observability/performance-contract";

describe("content-ready performance contract", () => {
  it("exposes content_ready and app_first_open as allowed operations", () => {
    expect(PERFORMANCE_OPERATIONS).toContain("content_ready");
    expect(PERFORMANCE_OPERATIONS).toContain("app_first_open");
  });

  it("builds a content-ready sample carrying the observed cache state", () => {
    expect(createContentReadySample("inbox_list", 412, "warm")).toEqual({
      schemaVersion: 1,
      source: "client",
      surface: "inbox_list",
      operation: "content_ready",
      durationMs: 412,
      cacheState: "warm",
      outcome: "ok",
    });
  });

  it("defaults cache state to unknown when the caller cannot attribute it", () => {
    expect(createContentReadySample("conversation", 300).cacheState).toBe("unknown");
  });

  it("builds a first-open sample that is always cold", () => {
    expect(createFirstOpenSample("clinic_shell", 1200)).toEqual({
      schemaVersion: 1,
      source: "client",
      surface: "clinic_shell",
      operation: "app_first_open",
      durationMs: 1200,
      cacheState: "cold",
      outcome: "ok",
    });
  });
});
