import { describe, expect, it } from "vitest";
import {
  detectDailyMetricAlerts,
  DAILY_ALERT_MIN_CONVERSATIONS,
  DAILY_ALERT_TAKEOVER_RATE,
  DAILY_ALERT_UNCLEAR_RATE,
} from "@/application/health/daily-metric-alerts";

describe("daily metric alerts", () => {
  it("returns no alerts when metrics are within thresholds", () => {
    expect(
      detectDailyMetricAlerts({
        totalConversations: 3,
        unclearRate: DAILY_ALERT_UNCLEAR_RATE,
        needsHumanRate: DAILY_ALERT_TAKEOVER_RATE,
      }),
    ).toEqual([]);
  });

  it("raises a critical alert when no conversations were observed", () => {
    expect(
      detectDailyMetricAlerts({
        totalConversations: 0,
        unclearRate: 0,
        needsHumanRate: 0,
      }),
    ).toEqual([
      {
        metric: "total_conversations",
        value: 0,
        threshold: DAILY_ALERT_MIN_CONVERSATIONS,
        level: "critical",
      },
    ]);
  });

  it("raises warn alerts for unclear and needs human above threshold", () => {
    expect(
      detectDailyMetricAlerts({
        totalConversations: 5,
        unclearRate: 0.25,
        needsHumanRate: 0.5,
      }),
    ).toEqual([
      {
        metric: "unclear_rate",
        value: 0.25,
        threshold: DAILY_ALERT_UNCLEAR_RATE,
        level: "warn",
      },
      {
        metric: "needs_human_rate",
        value: 0.5,
        threshold: DAILY_ALERT_TAKEOVER_RATE,
        level: "warn",
      },
    ]);
  });
});
