export const DAILY_ALERT_UNCLEAR_RATE = 0.2;
export const DAILY_ALERT_TAKEOVER_RATE = 0.3;
export const DAILY_ALERT_MIN_CONVERSATIONS = 1;

export type DailyMetricAlertLevel = "warn" | "critical";

export type DailyMetricAlert = {
  metric: string;
  value: number;
  threshold: number;
  level: DailyMetricAlertLevel;
};

type DetectDailyMetricAlertsInput = {
  unclearRate: number;
  needsHumanRate: number;
  totalConversations: number;
};

export function detectDailyMetricAlerts(
  input: DetectDailyMetricAlertsInput,
): DailyMetricAlert[] {
  const alerts: DailyMetricAlert[] = [];

  if (input.totalConversations < DAILY_ALERT_MIN_CONVERSATIONS) {
    alerts.push({
      metric: "total_conversations",
      value: input.totalConversations,
      threshold: DAILY_ALERT_MIN_CONVERSATIONS,
      level: "critical",
    });
  }

  if (input.unclearRate > DAILY_ALERT_UNCLEAR_RATE) {
    alerts.push({
      metric: "unclear_rate",
      value: input.unclearRate,
      threshold: DAILY_ALERT_UNCLEAR_RATE,
      level: "warn",
    });
  }

  if (input.needsHumanRate > DAILY_ALERT_TAKEOVER_RATE) {
    alerts.push({
      metric: "needs_human_rate",
      value: input.needsHumanRate,
      threshold: DAILY_ALERT_TAKEOVER_RATE,
      level: "warn",
    });
  }

  return alerts;
}
