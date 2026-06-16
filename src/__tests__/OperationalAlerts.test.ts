import { describe, expect, it } from "vitest";
import { evaluateOperationalAlerts } from "@/application/health/operational-alerts";

describe("operational alerts", () => {
  it("ignores non-active clinics", () => {
    const report = evaluateOperationalAlerts(
      [
        {
          clinicId: "1",
          clinicName: "Prospect Clinic",
          operationalStatus: "prospect",
          channelProvider: "z_api",
          zapiInstanceId: "",
          zapiToken: "",
          hasActivePlaybook: false,
          latestMetricAt: null,
        },
      ],
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(report.status).toBe("ok");
    expect(report.activeClinicCount).toBe(0);
    expect(report.alertCount).toBe(0);
  });

  it("raises critical alerts for missing config and stale cron", () => {
    const report = evaluateOperationalAlerts(
      [
        {
          clinicId: "1",
          clinicName: "Clinic A",
          operationalStatus: "active",
          channelProvider: "z_api",
          zapiInstanceId: "inst",
          zapiToken: "",
          hasActivePlaybook: false,
          latestMetricAt: new Date("2026-06-12T00:00:00.000Z"),
        },
      ],
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(report.status).toBe("degraded");
    expect(report.criticalCount).toBe(3);
    expect(report.alerts.map((alert) => alert.title)).toEqual([
      "Canal incompleto",
      "Playbook inativo",
      "Métricas desatualizadas",
    ]);
  });

  it("maps daily snapshot alerts into webhook and quality issues", () => {
    const report = evaluateOperationalAlerts(
      [
        {
          clinicId: "1",
          clinicName: "Clinic A",
          operationalStatus: "active",
          channelProvider: "meta_cloud_api",
          metaPhoneNumberId: "phone",
          metaAccessToken: "token",
          hasActivePlaybook: true,
          latestMetricAt: new Date("2026-06-14T10:00:00.000Z"),
          latestMetricData: {
            totalConversations: 0,
            alerts: [
              {
                metric: "total_conversations",
                value: 0,
                threshold: 1,
                level: "critical",
              },
              {
                metric: "unclear_rate",
                value: 0.25,
                threshold: 0.2,
                level: "warn",
              },
            ],
          },
        },
      ],
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(report.status).toBe("degraded");
    expect(report.alertCount).toBe(2);
    expect(report.criticalCount).toBe(1);
    expect(report.warnCount).toBe(1);
    expect(report.alerts[0]).toMatchObject({
      source: "webhook",
      title: "Possível falha de entrada",
    });
    expect(report.alerts[1]).toMatchObject({
      source: "quality",
      title: "Taxa alta de respostas unclear",
    });
  });

  it("raises a critical alert when the channel probe says the clinic is down", () => {
    const report = evaluateOperationalAlerts(
      [
        {
          clinicId: "1",
          clinicName: "Clinic A",
          operationalStatus: "active",
          channelProvider: "z_api",
          zapiInstanceId: "inst",
          zapiToken: "token",
          hasActivePlaybook: true,
          latestMetricAt: new Date("2026-06-14T10:00:00.000Z"),
          channelStatus: {
            status: "degraded",
            detail: "Z-API retornou Instance not found",
          },
        },
      ],
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(report.status).toBe("degraded");
    expect(report.alerts[0]).toMatchObject({
      source: "channel",
      title: "Canal indisponível",
      detail: "Z-API retornou Instance not found",
    });
  });
});
