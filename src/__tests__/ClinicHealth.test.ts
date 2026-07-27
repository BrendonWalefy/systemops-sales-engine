import { describe, expect, it } from "vitest";
import {
  evaluateClinicHealth,
  hasCompleteChannelConfig,
} from "@/application/health/clinic-health";

describe("clinic health", () => {
  it("detects missing channel credentials", () => {
    expect(
      hasCompleteChannelConfig({
        clinicId: "1",
        clinicName: "Teste",
        operationalStatus: "active",
        channelProvider: "z_api",
        zapiInstanceId: "",
        zapiToken: "",
        hasActivePlaybook: true,
      }),
    ).toBe(false);
  });

  it("marks active organizations as degraded when core config is missing", () => {
    const report = evaluateClinicHealth(
      [
        {
          clinicId: "1",
          clinicName: "Clinica A",
          operationalStatus: "active",
          channelProvider: "z_api",
          zapiInstanceId: "inst",
          zapiToken: "token",
          hasActivePlaybook: false,
          latestMetricAt: new Date("2026-06-14T10:00:00.000Z"),
        },
      ],
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(report.status).toBe("degraded");
    expect(report.degradedClinicCount).toBe(1);
    expect(report.degradedClinics[0]?.issues).toContain("sem playbook ativo");
  });

  it("excludes demo clinics from health evaluation", () => {
    const report = evaluateClinicHealth(
      [
        {
          clinicId: "demo-1",
          clinicName: "Odonto Marques (Demo)",
          operationalStatus: "active",
          isDemo: true,
          channelProvider: "z_api",
          zapiInstanceId: "inst",
          zapiToken: "token",
          hasActivePlaybook: false,
          latestMetricAt: null,
          channelStatus: {
            status: "degraded",
            detail: "canal fictício",
          },
        },
      ],
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(report.status).toBe("ok");
    expect(report.activeClinicCount).toBe(0);
    expect(report.degradedClinicCount).toBe(0);
  });

  it("marks active organizations as degraded when the channel health probe fails", () => {
    const report = evaluateClinicHealth(
      [
        {
          clinicId: "1",
          clinicName: "Clinica A",
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
    expect(report.degradedClinics[0]?.issues).toContain(
      "canal indisponível: Z-API retornou Instance not found",
    );
  });

  it("keeps health ok when active organizations are configured and only warns on stale metrics", () => {
    const report = evaluateClinicHealth(
      [
        {
          clinicId: "1",
          clinicName: "Clinica A",
          operationalStatus: "active",
          channelProvider: "meta_cloud_api",
          metaPhoneNumberId: "123",
          metaAccessToken: "token",
          metaAppSecret: "app-secret",
          hasActivePlaybook: true,
          latestMetricAt: new Date("2026-06-12T00:00:00.000Z"),
        },
        {
          clinicId: "2",
          clinicName: "Clinica B",
          operationalStatus: "prospect",
          channelProvider: "z_api",
          zapiInstanceId: "",
          zapiToken: "",
          hasActivePlaybook: false,
        },
      ],
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(report.status).toBe("ok");
    expect(report.activeClinicCount).toBe(1);
    expect(report.warnings).toContain(
      "Clinica A: métricas desatualizadas há mais de 36h",
    );
  });
});
