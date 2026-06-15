import type { ClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";

export type ClinicHealthInput = {
  clinicId: string;
  clinicName: string;
  operationalStatus: ClinicOperationalStatus;
  channelProvider?: "z_api" | "meta_cloud_api" | null;
  zapiInstanceId?: string | null;
  zapiToken?: string | null;
  metaPhoneNumberId?: string | null;
  metaAccessToken?: string | null;
  hasActivePlaybook: boolean;
  latestMetricAt?: Date | null;
};

export type ClinicHealthIssue = {
  clinicId: string;
  clinicName: string;
  issues: string[];
};

export type HealthcheckReport = {
  status: "ok" | "degraded";
  activeClinicCount: number;
  degradedClinicCount: number;
  degradedClinics: ClinicHealthIssue[];
  warnings: string[];
};

function normalize(value?: string | null): string {
  return value?.trim() ?? "";
}

export function hasCompleteChannelConfig(clinic: ClinicHealthInput): boolean {
  if (clinic.channelProvider === "z_api") {
    return Boolean(
      normalize(clinic.zapiInstanceId) && normalize(clinic.zapiToken),
    );
  }

  if (clinic.channelProvider === "meta_cloud_api") {
    return Boolean(
      normalize(clinic.metaPhoneNumberId) && normalize(clinic.metaAccessToken),
    );
  }

  return false;
}

export function evaluateClinicHealth(
  clinics: ClinicHealthInput[],
  now: Date,
): HealthcheckReport {
  const activeClinics = clinics.filter(
    (clinic) => clinic.operationalStatus === "active",
  );

  const degradedClinics: ClinicHealthIssue[] = activeClinics
    .map((clinic) => {
      const issues: string[] = [];

      if (!hasCompleteChannelConfig(clinic)) {
        issues.push("credenciais de canal incompletas");
      }

      if (!clinic.hasActivePlaybook) {
        issues.push("sem playbook ativo");
      }

      return {
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        issues,
      };
    })
    .filter((clinic) => clinic.issues.length > 0);

  const warnings: string[] = [];

  if (activeClinics.length === 0) {
    warnings.push("nenhuma clínica ativa no momento");
  }

  activeClinics.forEach((clinic) => {
    if (!clinic.latestMetricAt) {
      warnings.push(`${clinic.clinicName}: sem snapshot recente de métricas`);
      return;
    }

    const hoursSinceMetrics =
      (now.getTime() - clinic.latestMetricAt.getTime()) / 3_600_000;

    if (hoursSinceMetrics > 36) {
      warnings.push(
        `${clinic.clinicName}: métricas desatualizadas há mais de 36h`,
      );
    }
  });

  return {
    status: degradedClinics.length > 0 ? "degraded" : "ok",
    activeClinicCount: activeClinics.length,
    degradedClinicCount: degradedClinics.length,
    degradedClinics,
    warnings,
  };
}
