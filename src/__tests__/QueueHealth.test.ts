import { describe, expect, it } from "vitest";
import {
  evaluateQueueHealth,
  mapQueueHealthAlertsToOperationalAlerts,
} from "@/application/health/queue-health";

const EMPTY_SNAPSHOT = {
  dead: [],
  stalledPending: [],
  staleProcessing: [],
  repeatedFailures: [],
};

describe("queue health", () => {
  it("stays healthy when no queue threshold is breached", () => {
    const report = evaluateQueueHealth(EMPTY_SNAPSHOT, new Date("2026-06-23T12:00:00.000Z"));
    expect(report.alerts).toEqual([]);
  });

  it("reports dead, stalled and repeated failures with the appropriate severity", () => {
    const report = evaluateQueueHealth({
      dead: [{ queue: "message.send", count: 2 }],
      stalledPending: [{ queue: "message.process", count: 4, oldestAt: new Date("2026-06-23T11:45:00.000Z") }],
      staleProcessing: [{ queue: "message.process", count: 1, oldestAt: new Date("2026-06-23T11:50:00.000Z") }],
      repeatedFailures: [{ queue: "message.send", count: 3 }],
    }, new Date("2026-06-23T12:00:00.000Z"));

    expect(report.alerts).toEqual([
      expect.objectContaining({ queue: "message.send", kind: "dead_jobs", level: "critical", count: 2 }),
      expect.objectContaining({ queue: "message.process", kind: "stalled_pending", level: "critical", count: 4 }),
      expect.objectContaining({ queue: "message.process", kind: "stale_processing", level: "critical", count: 1 }),
      expect.objectContaining({ queue: "message.send", kind: "repeated_failures", level: "warn", count: 3 }),
    ]);
    expect(mapQueueHealthAlertsToOperationalAlerts(report.alerts)[0]).toMatchObject({
      clinicName: "Plataforma",
      source: "queue",
      title: "Jobs mortos na fila",
    });
  });
});
