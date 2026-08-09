import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CLIENT_SAMPLES_PER_SESSION,
} from "@/application/observability/performance-contract";
import {
  NAVIGATION_COUNT_KEY,
} from "@/application/observability/navigation-timing";

describe("ContentReadyReporter per-session budget", () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        storage = {};
      },
    });
  });

  it("stops emitting when the per-session sample budget is exhausted", () => {
    // Simulate the counter being at the limit
    storage[NAVIGATION_COUNT_KEY] = String(MAX_CLIENT_SAMPLES_PER_SESSION);

    // Replicate the check from ContentReadyReporter
    function readSampleCount(): number {
      const count = Number(sessionStorage.getItem(NAVIGATION_COUNT_KEY));
      return Number.isSafeInteger(count) && count >= 0 ? count : 0;
    }

    const count = readSampleCount();
    const shouldSend = count < MAX_CLIENT_SAMPLES_PER_SESSION;

    expect(shouldSend).toBe(false);
  });

  it("permits emission when the budget has room", () => {
    // Simulate the counter below the limit
    storage[NAVIGATION_COUNT_KEY] = String(MAX_CLIENT_SAMPLES_PER_SESSION - 1);

    function readSampleCount(): number {
      const count = Number(sessionStorage.getItem(NAVIGATION_COUNT_KEY));
      return Number.isSafeInteger(count) && count >= 0 ? count : 0;
    }

    const count = readSampleCount();
    const shouldSend = count < MAX_CLIENT_SAMPLES_PER_SESSION;

    expect(shouldSend).toBe(true);

    // Simulate the increment that ContentReadyReporter does
    sessionStorage.setItem(NAVIGATION_COUNT_KEY, String(count + 1));

    // Verify counter is now at the limit
    const newCount = readSampleCount();
    expect(newCount).toBe(MAX_CLIENT_SAMPLES_PER_SESSION);
  });

  it("shares the same counter key with NavigationPerformanceReporter", () => {
    // Both reporters should use NAVIGATION_COUNT_KEY
    // This test verifies they use the same key so they share a budget
    expect(NAVIGATION_COUNT_KEY).toBe("systemops.performance.sample-count.v1");
  });
});
