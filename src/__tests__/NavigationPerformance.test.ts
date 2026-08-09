import { describe, expect, it, vi } from "vitest";
import {
  completeNavigation,
  markNavigationStart,
  markNavigationStartInSession,
  type NavigationStorage,
} from "@/application/observability/navigation-timing";
import { reportNavigationCompletion } from "@/components/performance/navigation-performance-reporter";

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

describe("soft navigation timing", () => {
  it("matches the intended normalized surface and consumes the pending mark", () => {
    const pending = markNavigationStart(null, "/app/inbox", 100);
    const completed = completeNavigation(pending, "/app/inbox", 245);

    expect(completed).toEqual({
      nextPending: null,
      sample: {
        schemaVersion: 1,
        source: "client",
        surface: "inbox_list",
        operation: "soft_navigation",
        durationMs: 145,
        cacheState: "unknown",
        outcome: "ok",
      },
    });
  });

  it("drops and consumes mismatched, unknown, stale, or negative marks", () => {
    const pending = markNavigationStart(null, "/app/agenda", 100);

    expect(completeNavigation(pending, "/app/inbox", 200)).toEqual({
      nextPending: null,
      sample: null,
    });
    expect(completeNavigation(pending, "/owner/secret", 200).sample).toBeNull();
    expect(completeNavigation(pending, "/app/agenda", 121_000).sample).toBeNull();
    expect(completeNavigation(pending, "/app/agenda", 99).sample).toBeNull();
    expect(markNavigationStart(null, "http://[", 200)).toBeNull();
    expect(completeNavigation(pending, "http://[", 200).sample).toBeNull();
  });

  it("never stores raw routes and clears a pending mark for unknown destinations", () => {
    const storage = new MemoryStorage();

    markNavigationStartInSession(
      "/app/inbox/private-conversation-id?token=secret#message",
      { storage, now: () => 100 },
    );

    const serialized = storage.getItem("systemops.performance.pending-navigation.v1");
    expect(serialized).toBe('{"surface":"conversation","startedAt":100}');
    expect(serialized).not.toContain("private-conversation-id");
    expect(serialized).not.toContain("token");

    markNavigationStartInSession("/owner/clinics/private-id", {
      storage,
      now: () => 110,
    });
    expect(storage.getItem("systemops.performance.pending-navigation.v1")).toBeNull();
  });

  it("consumes one mark once and keeps session caps isolated", () => {
    const firstSession = new MemoryStorage();
    const secondSession = new MemoryStorage();
    const sendBeacon = vi.fn(() => true);
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

    for (let index = 0; index < 31; index += 1) {
      markNavigationStartInSession("/app/agenda", {
        storage: firstSession,
        now: () => index * 10,
      });
      reportNavigationCompletion("/app/agenda", {
        storage: firstSession,
        now: () => index * 10 + 5,
        sendBeacon,
        fetch,
      });
    }

    expect(sendBeacon).toHaveBeenCalledTimes(30);
    expect(fetch).not.toHaveBeenCalled();
    expect(firstSession.getItem("systemops.performance.pending-navigation.v1")).toBeNull();
    expect(firstSession.getItem("systemops.performance.sample-count.v1")).toBe("30");

    markNavigationStartInSession("/app/agenda", {
      storage: secondSession,
      now: () => 500,
    });
    reportNavigationCompletion("/app/agenda", {
      storage: secondSession,
      now: () => 510,
      sendBeacon,
      fetch,
    });
    reportNavigationCompletion("/app/agenda", {
      storage: secondSession,
      now: () => 520,
      sendBeacon,
      fetch,
    });

    expect(sendBeacon).toHaveBeenCalledTimes(31);
    expect(secondSession.getItem("systemops.performance.sample-count.v1")).toBe("1");
  });

  it("falls back once without retrying or registering global listeners", async () => {
    const storage = new MemoryStorage();
    const sendBeacon = vi.fn(() => false);
    const fetch = vi.fn(() => Promise.reject(new Error("offline")));
    const addEventListener = vi.fn();
    vi.stubGlobal("addEventListener", addEventListener);

    markNavigationStartInSession("/app/dashboard", {
      storage,
      now: () => 40,
    });
    expect(() => reportNavigationCompletion("/app/dashboard", {
      storage,
      now: () => 90,
      sendBeacon,
      fetch,
    })).not.toThrow();
    await Promise.resolve();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/telemetry/performance",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
    expect(addEventListener).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
