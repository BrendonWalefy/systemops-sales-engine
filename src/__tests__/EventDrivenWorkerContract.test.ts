import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const messageWorker = readFileSync("src/app/api/cron/message-worker/route.ts", "utf8");
const senderWorker = readFileSync("src/app/api/cron/sender-worker/route.ts", "utf8");
const inboundStore = readFileSync(
  "src/infrastructure/repositories/drizzle-inbound-event-store.ts",
  "utf8",
);

describe("event-driven worker integration contract", () => {
  it("returns the persisted message.process run_at with the authority tuple", () => {
    expect(inboundStore).toContain("job.run_at as job_run_at");
    expect(inboundStore).toContain("runAt: new Date(row.job_run_at)");
  });

  it("accepts a bounded post-response message wake tied to the persisted run_at", () => {
    expect(messageWorker).toContain("schedule: after");
    expect(messageWorker).toContain("notBefore");
    expect(messageWorker).toContain("scheduleAcceptedWorkerRun");
  });

  it("accepts a post-response sender wake without weakening cron authorization", () => {
    expect(senderWorker).toContain("requireCronAuthorization(request)");
    expect(senderWorker).toContain("schedule: after");
    expect(senderWorker).toContain("scheduleAcceptedWorkerRun");
    expect(senderWorker).toContain("notBefore");
    expect(senderWorker).toContain("scheduleSenderWorkerWake");
    expect(senderWorker).toContain('deferredWake") === "1"');
    expect(senderWorker).toContain("!isDeferredWake");
  });

  it("keeps both fallback crons while event-driven wakes are introduced", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const paths = new Set(config.crons.map((cron) => cron.path));

    expect(paths).toContain("/api/cron/message-worker");
    expect(paths).toContain("/api/cron/sender-worker");
  });
});
