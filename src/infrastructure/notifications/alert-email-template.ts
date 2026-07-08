import type { OperationalAlertReport } from "@/application/health/operational-alerts";

const LEVEL_COLOR: Record<string, string> = {
  critical: "#ef4444",
  warn: "#f59e0b",
};

const LEVEL_LABEL: Record<string, string> = {
  critical: "CRÍTICO",
  warn: "ATENÇÃO",
};

const SOURCE_LABEL: Record<string, string> = {
  configuration: "Configuração",
  cron: "Cron / Automação",
  quality: "Qualidade",
  webhook: "Webhook / Entrada",
  channel: "Canal / Saída",
  queue: "Fila / Workers",
  credits: "Créditos / Saldo",
};

function alertRow(alert: OperationalAlertReport["alerts"][number]): string {
  const color = LEVEL_COLOR[alert.level] ?? "#6b7280";
  const badge = LEVEL_LABEL[alert.level] ?? alert.level.toUpperCase();
  const source = SOURCE_LABEL[alert.source] ?? alert.source;
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #1f2937;">
        <span style="display:inline-block;background:${color};color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.5px;">${badge}</span>
        &nbsp;
        <span style="color:#9ca3af;font-size:12px;">${source}</span>
        <br>
        <strong style="color:#f9fafb;font-size:14px;">${alert.clinicName}</strong>
        &nbsp;&mdash;&nbsp;
        <span style="color:#d1d5db;font-size:14px;">${alert.title}</span>
        <br>
        <span style="color:#9ca3af;font-size:12px;">${alert.detail}</span>
      </td>
    </tr>`;
}

export function buildAlertDigestEmail(
  report: OperationalAlertReport,
  dashboardUrl: string,
): { subject: string; html: string } {
  const statusIcon = report.criticalCount > 0 ? "🔴" : "🟡";
  const statusLabel =
    report.criticalCount > 0
      ? `${report.criticalCount} crítico(s), ${report.warnCount} aviso(s)`
      : `${report.warnCount} aviso(s)`;

  const subject = `${statusIcon} SystemOps — ${statusLabel} em ${report.activeClinicCount} clínica(s) ativa(s)`;

  const alertRows = report.alerts.map(alertRow).join("");

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#030712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#030712;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:12px;overflow:hidden;border:1px solid #1f2937;">

          <!-- Header -->
          <tr>
            <td style="background:#065f46;padding:24px 32px;">
              <p style="margin:0;color:#6ee7b7;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">SystemOps</p>
              <h1 style="margin:4px 0 0;color:#f9fafb;font-size:22px;font-weight:700;">Digest de Alertas Operacionais</h1>
            </td>
          </tr>

          <!-- Summary -->
          <tr>
            <td style="padding:24px 32px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#1f2937;border-radius:8px;padding:16px;text-align:center;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;">Clínicas ativas</p>
                    <p style="margin:4px 0 0;color:#f9fafb;font-size:28px;font-weight:700;">${report.activeClinicCount}</p>
                  </td>
                  <td width="16"></td>
                  <td style="background:#7f1d1d;border-radius:8px;padding:16px;text-align:center;">
                    <p style="margin:0;color:#fca5a5;font-size:12px;">Críticos</p>
                    <p style="margin:4px 0 0;color:#f9fafb;font-size:28px;font-weight:700;">${report.criticalCount}</p>
                  </td>
                  <td width="16"></td>
                  <td style="background:#78350f;border-radius:8px;padding:16px;text-align:center;">
                    <p style="margin:0;color:#fcd34d;font-size:12px;">Avisos</p>
                    <p style="margin:4px 0 0;color:#f9fafb;font-size:28px;font-weight:700;">${report.warnCount}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Alert list -->
          <tr>
            <td style="padding:24px 32px 0;">
              <p style="margin:0 0 12px;color:#6ee7b7;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;">Alertas detectados</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${alertRows}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:24px 32px 32px;text-align:center;">
              <a href="${dashboardUrl}" style="display:inline-block;background:#10b981;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">Abrir painel operacional</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0;color:#4b5563;font-size:11px;text-align:center;">
                Este digest é enviado automaticamente quando há alertas nas clínicas ativas.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
