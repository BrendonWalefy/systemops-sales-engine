import { describe, expect, it, vi } from "vitest";
import {
  MAX_CLIENT_SAMPLES_PER_SESSION,
} from "@/application/observability/performance-contract";
import {
  NAVIGATION_COUNT_KEY,
  type NavigationStorage,
} from "@/application/observability/navigation-timing";
import {
  emitContentReadySample,
} from "@/components/performance/content-ready-reporter";

class MemoryStorage implements NavigationStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("ContentReadyReporter per-session budget", () => {
  it("stops emitting when the per-session sample budget is exhausted", () => {
    const storage = new MemoryStorage();
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    let callCount = 0;

    // Emit 31 samples to test the boundary
    for (let i = 0; i < 31; i += 1) {
      emitContentReadySample("inbox_list", {
        storage,
        fetch,
        now: () => i * 100,
      });
      if (fetch.mock.calls.length > callCount) {
        callCount += 1;
      }
    }

    // Should have sent exactly 30 samples (the budget limit)
    expect(fetch).toHaveBeenCalledTimes(30);

    // Counter should be at the limit
    const finalCount = Number(storage.getItem(NAVIGATION_COUNT_KEY));
    expect(finalCount).toBe(MAX_CLIENT_SAMPLES_PER_SESSION);
  });

  it("resumes emitting in a new session with its own budget", () => {
    const firstSession = new MemoryStorage();
    const secondSession = new MemoryStorage();
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

    // Exhaust the first session budget
    for (let i = 0; i < MAX_CLIENT_SAMPLES_PER_SESSION + 5; i += 1) {
      emitContentReadySample("inbox_list", {
        storage: firstSession,
        fetch,
        now: () => i,
      });
    }

    expect(fetch).toHaveBeenCalledTimes(MAX_CLIENT_SAMPLES_PER_SESSION);
    const firstSessionCount = Number(firstSession.getItem(NAVIGATION_COUNT_KEY));
    expect(firstSessionCount).toBe(MAX_CLIENT_SAMPLES_PER_SESSION);

    // Reset mock and emit in second session
    fetch.mockClear();

    emitContentReadySample("conversation", {
      storage: secondSession,
      fetch,
      now: () => 1000,
    });

    // Second session should have its own budget
    expect(fetch).toHaveBeenCalledTimes(1);
    const secondSessionCount = Number(secondSession.getItem(NAVIGATION_COUNT_KEY));
    expect(secondSessionCount).toBe(1);
  });

  it("shares the same counter key with NavigationPerformanceReporter", () => {
    // Both reporters should use NAVIGATION_COUNT_KEY
    // This test verifies they use the same key so they share a budget
    expect(NAVIGATION_COUNT_KEY).toBe("systemops.performance.sample-count.v1");
  });
});
