import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type CronEntry = {
  path: string;
  schedule: string;
};

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  regions: string[];
  crons: CronEntry[];
};

const expectedSchedules = new Map<string, string>([
  ["/api/cron/message-worker", "*/10 * * * *"],
  ["/api/cron/sender-worker", "*/10 * * * *"],
  ["/api/cron/stale-conversations", "0 6 * * *"],
  ["/api/cron/deposit-expiry-sweep", "0 * * * *"],
  ["/api/cron/follow-up-dispatcher", "0 10 * * *"],
  ["/api/cron/appointment-reminder", "0 13 * * *"],
  ["/api/cron/metrics-aggregate", "0 2 * * *"],
  ["/api/cron/calendar-watch-renew", "0 5 * * 1"],
  ["/api/cron/recovery-campaign", "0 12 * * 1-6"],
  ["/api/cron/recovery-campaign-evening", "0 21 * * 1-5"],
  ["/api/cron/conversation-analytics", "0 8 * * *"],
  ["/api/cron/operational-alert-digest", "0 9 * * *"],
  ["/api/cron/conversation-insights", "0 7 * * *"],
  ["/api/cron/lead-outcome-classifier", "30 6 * * *"],
  ["/api/cron/appointment-reminder-staff", "0 0 * * *"],
  ["/api/cron/media-cleanup", "0 4 * * *"],
  ["/api/cron/resume-expired-takeovers", "*/10 * * * *"],
  ["/api/cron/post-appointment-followup", "0,30 * * * *"],
  ["/api/cron/stuck-conversation-sweep", "*/10 * * * *"],
  ["/api/cron/channel-health-alert", "0 * * * *"],
  ["/api/cron/tts-cleanup", "0 */2 * * *"],
  ["/api/cron/decision-trace-cleanup", "30 4 * * *"],
]);

describe("Vercel fallback cron consolidation", () => {
  it("retains every existing cron route while aligning the reviewed wake grid", () => {
    expect(config.crons).toHaveLength(expectedSchedules.size);
    expect(new Set(config.crons.map(({ path }) => path))).toEqual(
      new Set(expectedSchedules.keys()),
    );

    for (const { path, schedule } of config.crons) {
      expect(schedule, path).toBe(expectedSchedules.get(path));
    }
  });

  it("keeps durable queue recovery without one-minute database polling", () => {
    const schedules = new Map(config.crons.map(({ path, schedule }) => [path, schedule]));

    expect(schedules.get("/api/cron/message-worker")).toBe("*/10 * * * *");
    expect(schedules.get("/api/cron/sender-worker")).toBe("*/10 * * * *");
    expect(config.crons).not.toContainEqual(expect.objectContaining({ schedule: "* * * * *" }));
  });

  it("keeps functions colocated with the production database region", () => {
    expect(config.regions).toEqual(["gru1"]);
  });
});
