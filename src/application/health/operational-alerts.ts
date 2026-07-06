import {
  hasCompleteChannelConfig,
  isOperationallyMonitored,
  type ClinicHealthInput,
} from "@/application/health/clinic-health";

export type SnapshotMetricAlert = {
  metric: string;
  value: number;
  threshold: number;
  level: "warn" | "critical";
};

export type ClinicOperationalAlertInput = ClinicHealthInput & {
  latestMetricData?:
    | {
        totalConversations?: number | null;
        alerts?: SnapshotMetricAlert[] | null;
      }
    | null;
};

export type OperationalAlert = {
  clinicId: string;
  clinicName: string;
  source: "configuration" | "cron" | "quality" | "webhook" | "channel" | "queue";
  level: "warn" | "critical";
  title: string;
  detail: string;
};

export type OperationalAlertReport = {
  status: "ok" | "degraded";
  activeClinicCount: number;
  alertCount: number;
  criticalCount: number;
  warnCount: number;
  alerts: OperationalAlert[];
};

function sortAlerts(alerts: OperationalAlert[]): OperationalAlert[] {
  return [...alerts].sort((a, b) => {
    if (a.level !== b.level) {
      return a.level === "critical" ? -1 : 1;
    }

    return a.clinicName.localeCompare(b.clinicName, "pt-BR");
  });
}

export function appendOperationalAlerts(
  report: OperationalAlertReport,
  additionalAlerts: OperationalAlert[],
): OperationalAlertReport {
  const alerts = sortAlerts([...report.alerts, ...additionalAlerts]);
  const criticalCount = alerts.filter((alert) => alert.level === "critical").length;

  return {
    ...report,
    status: criticalCount > 0 ? "degraded" : "ok",
    alertCount: alerts.length,
    criticalCount,
    warnCount: alerts.length - criticalCount,
    alerts,
  };
}

function formatMetricValue(value: number): string {
  if (Number.isFinite(value) && value >= 0 && value <= 1) {
    return `${(value * 100).toFixed(1)}%`;
  }

  return String(value);
}

function mapSnapshotAlert(
  clinic: ClinicOperationalAlertInput,
  alert: SnapshotMetricAlert,
): OperationalAlert {
  if (alert.metric === "total_conversations") {
    return {
      clinicId: clinic.clinicId,
      clinicName: clinic.clinicName,
      source: "webhook",
      level: alert.level,
      title: "Possível falha de entrada",
      detail: `0 conversas no snapshot diário mais recente (mínimo esperado: ${alert.threshold})`,
    };
  }

  if (alert.metric === "unclear_rate") {
    return {
      clinicId: clinic.clinicId,
      clinicName: clinic.clinicName,
      source: "quality",
      level: alert.level,
      title: "Taxa alta de respostas unclear",
      detail: `${formatMetricValue(alert.value)} acima do limite ${formatMetricValue(alert.threshold)}`,
    };
  }

  if (alert.metric === "needs_human_rate") {
    return {
      clinicId: clinic.clinicId,
      clinicName: clinic.clinicName,
      source: "quality",
      level: alert.level,
      title: "Taxa alta de handoff humano",
      detail: `${formatMetricValue(alert.value)} acima do limite ${formatMetricValue(alert.threshold)}`,
    };
  }

  return {
    clinicId: clinic.clinicId,
    clinicName: clinic.clinicName,
    source: "quality",
    level: alert.level,
    title: "Métrica fora do limite",
    detail: `${alert.metric}: ${formatMetricValue(alert.value)} (limite ${formatMetricValue(alert.threshold)})`,
  };
}

export function evaluateOperationalAlerts(
  clinics: ClinicOperationalAlertInput[],
  now: Date,
): OperationalAlertReport {
  const activeClinics = clinics.filter(isOperationallyMonitored);
  const alerts: OperationalAlert[] = [];

  activeClinics.forEach((clinic) => {
    if (!hasCompleteChannelConfig(clinic)) {
      alerts.push({
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        source: "configuration",
        level: "critical",
        title: "Canal incompleto",
        detail: "Credenciais do canal de atendimento estão incompletas",
      });
    }

    if (clinic.channelStatus?.status === "degraded") {
      alerts.push({
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        source: "channel",
        level: "critical",
        title: "Canal indisponível",
        detail: clinic.channelStatus.detail ?? "Falha ativa ao validar a conectividade do canal",
      });
    }

    if (!clinic.hasActivePlaybook) {
      alerts.push({
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        source: "configuration",
        level: "critical",
        title: "Playbook inativo",
        detail: "A clínica ativa está sem playbook ativo publicado",
      });
    }

    if (!clinic.latestMetricAt) {
      alerts.push({
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        source: "cron",
        level: "critical",
        title: "Cron sem snapshot",
        detail: "Ainda não existe snapshot recente de métricas para a clínica ativa",
      });
      return;
    }

    const hoursSinceMetrics =
      (now.getTime() - clinic.latestMetricAt.getTime()) / 3_600_000;

    if (hoursSinceMetrics > 36) {
      alerts.push({
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        source: "cron",
        level: "critical",
        title: "Métricas desatualizadas",
        detail: "O cron de métricas está há mais de 36h sem snapshot novo",
      });
    }

    const snapshotAlerts = clinic.latestMetricData?.alerts ?? [];
    snapshotAlerts.forEach((alert) => {
      alerts.push(mapSnapshotAlert(clinic, alert));
    });
  });

  return appendOperationalAlerts(
    {
      status: "ok",
      activeClinicCount: activeClinics.length,
      alertCount: 0,
      criticalCount: 0,
      warnCount: 0,
      alerts: [],
    },
    alerts,
  );
}
