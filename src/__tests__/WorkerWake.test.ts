import { describe, expect, it, vi } from "vitest";
import {
  MAX_EVENT_DRIVEN_MESSAGE_DELAY_MS,
  requestMessageWorkerRun,
  requestSenderWorkerRun,
  resolveWorkerBaseUrl,
  resolveWorkerWakeDelay,
  scheduleAcceptedWorkerRun,
  scheduleMessageWorkerWake,
} from "@/application/jobs/worker-wake";

const ENV = {
  CRON_SECRET: "cron-secret",
  VERCEL_ENV: "production",
  VERCEL_URL: "deployment.example.test",
  NEXT_PUBLIC_APP_URL: "https://production.example.test",
};

describe("worker wake policy", () => {
  it("uses the public alias in production and the current deployment in preview", () => {
    expect(resolveWorkerBaseUrl(ENV)).toBe("https://production.example.test");
    expect(resolveWorkerBaseUrl({ ...ENV, VERCEL_ENV: "preview" }))
      .toBe("https://deployment.example.test");
    expect(resolveWorkerBaseUrl({ NEXT_PUBLIC_APP_URL: "https://app.test/" }))
      .toBe("https://app.test");
  });

  it("accepts one bounded delay and rejects longer clinic windows for cron recovery", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    expect(resolveWorkerWakeDelay({
      now,
      notBefore: new Date(now.getTime() + 15_000),
    })).toEqual({ accepted: true, delayMs: 15_000 });
    expect(resolveWorkerWakeDelay({
      now,
      notBefore: new Date(now.getTime() + MAX_EVENT_DRIVEN_MESSAGE_DELAY_MS + 1),
    })).toEqual({ accepted: false });
  });

  it("requests the message worker with the exact persisted notBefore", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const now = new Date("2026-08-25T12:00:00.000Z");
    const notBefore = new Date("2026-08-25T12:00:15.000Z");

    await expect(requestMessageWorkerRun({
      env: ENV,
      fetchImpl,
      now,
      notBefore,
    })).resolves.toEqual({ requested: true, status: 202 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/cron/message-worker");
    expect(parsed.searchParams.get("ack")).toBe("1");
    expect(parsed.searchParams.get("notBefore")).toBe(notBefore.toISOString());
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer cron-secret");
  });

  it("does not invoke a worker for a delay beyond the bounded function budget", async () => {
    const fetchImpl = vi.fn();
    const now = new Date("2026-08-25T12:00:00.000Z");

    await expect(requestMessageWorkerRun({
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
      notBefore: new Date(now.getTime() + 60_000),
    })).resolves.toEqual({ requested: false, reason: "delay_exceeds_limit" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requests the sender immediately and degrades network failure to the cron", async () => {
    const successFetch = vi.fn(async () => new Response(null, { status: 202 }));
    const failedFetch = vi.fn(async () => { throw new Error("offline"); });

    await expect(requestSenderWorkerRun({ env: ENV, fetchImpl: successFetch }))
      .resolves.toEqual({ requested: true, status: 202 });
    const [senderUrl] = successFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(senderUrl).pathname)
      .toBe("/api/cron/sender-worker");
    await expect(requestSenderWorkerRun({ env: ENV, fetchImpl: failedFetch }))
      .resolves.toEqual({ requested: false, reason: "failed" });
  });

  it("rejects protected or failed HTTP responses instead of reporting a wake", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(requestSenderWorkerRun({ env: ENV, fetchImpl }))
      .resolves.toEqual({ requested: false, reason: "rejected", status: 401 });
  });

  it("carries an exact deferred sender run_at into the one-shot wake", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const now = new Date("2026-08-25T12:00:00.000Z");
    const notBefore = new Date("2026-08-25T12:00:01.000Z");

    await expect(requestSenderWorkerRun({
      env: ENV,
      fetchImpl,
      now,
      notBefore,
      deferredWake: true,
    } as never))
      .resolves.toEqual({ requested: true, status: 202 });

    const [senderUrl] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(senderUrl).searchParams.get("notBefore")).toBe(notBefore.toISOString());
    expect(new URL(senderUrl).searchParams.get("deferredWake")).toBe("1");
  });

  it("runs exactly one delayed task without polling", async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const sleep = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-08-25T12:00:00.000Z");

    expect(scheduleAcceptedWorkerRun({
      schedule: (task) => scheduled.push(task),
      notBefore: new Date(now.getTime() + 15_000),
      now,
      sleep,
      run,
    })).toBe(true);
    expect(scheduled).toHaveLength(1);

    await scheduled[0]!();
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(15_000);
    expect(run).toHaveBeenCalledOnce();
  });

  it("never throws when the request-scoped scheduler is unavailable", () => {
    const schedule = vi.fn(() => { throw new Error("outside request scope"); });

    expect(() => scheduleMessageWorkerWake(schedule, {
      notBefore: new Date("2026-08-25T12:00:15.000Z"),
    })).not.toThrow();
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("supports a deployment-scoped rollback switch without disabling fallback crons", async () => {
    const fetchImpl = vi.fn();
    await expect(requestSenderWorkerRun({
      env: { ...ENV, DISABLE_EVENT_DRIVEN_WORKERS: "1" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).resolves.toEqual({ requested: false, reason: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
