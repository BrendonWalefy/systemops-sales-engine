import { describe, it, expect } from "vitest";
import { buildAlertDigestEmail } from "@/infrastructure/notifications/alert-email-template";
import type { OperationalAlertReport } from "@/application/health/operational-alerts";

const BASE_REPORT: OperationalAlertReport = {
  status: "degraded",
  activeClinicCount: 2,
  alertCount: 2,
  criticalCount: 1,
  warnCount: 1,
  alerts: [
    {
      clinicId: "clinic-1",
      clinicName: "Clínica Alpha",
      source: "configuration",
      level: "critical",
      title: "Canal incompleto",
      detail: "Credenciais do canal de atendimento estão incompletas",
    },
    {
      clinicId: "clinic-2",
      clinicName: "Clínica Beta",
      source: "quality",
      level: "warn",
      title: "Taxa alta de respostas unclear",
      detail: "45.0% acima do limite 30.0%",
    },
  ],
};

describe("buildAlertDigestEmail", () => {
  it("gera subject com ícone crítico quando há alertas críticos", () => {
    const { subject } = buildAlertDigestEmail(BASE_REPORT, "https://app.example.com/owner");
    expect(subject).toContain("🔴");
    expect(subject).toContain("1 crítico(s)");
    expect(subject).toContain("1 aviso(s)");
  });

  it("gera subject com ícone amarelo quando há só avisos", () => {
    const report: OperationalAlertReport = {
      ...BASE_REPORT,
      criticalCount: 0,
      warnCount: 2,
      alerts: BASE_REPORT.alerts.map((a) => ({ ...a, level: "warn" as const })),
    };
    const { subject } = buildAlertDigestEmail(report, "https://app.example.com/owner");
    expect(subject).toContain("🟡");
    expect(subject).not.toContain("🔴");
  });

  it("html contém nome das clínicas e títulos dos alertas", () => {
    const { html } = buildAlertDigestEmail(BASE_REPORT, "https://app.example.com/owner");
    expect(html).toContain("Clínica Alpha");
    expect(html).toContain("Canal incompleto");
    expect(html).toContain("Clínica Beta");
    expect(html).toContain("Taxa alta de respostas unclear");
  });

  it("html contém link para o dashboard", () => {
    const url = "https://systemops-core.vercel.app/owner";
    const { html } = buildAlertDigestEmail(BASE_REPORT, url);
    expect(html).toContain(url);
  });

  it("html contém contagem de clínicas ativas", () => {
    const { html } = buildAlertDigestEmail(BASE_REPORT, "https://app.example.com/owner");
    expect(html).toContain("2");
  });
});
