import type { ClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";

type ClinicAutomationToggle = {
  autoReplyEnabled: boolean;
  operationalStatus?: ClinicOperationalStatus | null;
  shadowModeEnabled?: boolean | null;
};

export type ClinicAutomationMode = "live" | "observe" | "disabled";

// Kill switch operacional da clínica: se a IA foi desligada, nenhum outbound
// automatizado deve sair sem decisão explícita em contrário. Além disso,
// apenas clínicas ativas entram no fluxo automático; prospect, test, paused e
// cancelled ficam bloqueadas por policy única.
//
// Shadow é coleta segura: registra o inbound real, mas a avaliação da IA roda
// depois no replay isolado. Executar o orquestrador produtivo e suprimir apenas
// o WhatsApp ainda criava estado, follow-up e agendamento hipotéticos no tenant.
export function resolveClinicAutomationMode(
  clinic: ClinicAutomationToggle,
): ClinicAutomationMode {
  if (clinic.operationalStatus === "cancelled") return "disabled";
  if (clinic.shadowModeEnabled) return "observe";
  return clinic.autoReplyEnabled !== false && clinic.operationalStatus === "active"
    ? "live"
    : "disabled";
}

export function shouldSendAutomatedClinicOutbound(
  clinic: ClinicAutomationToggle,
): boolean {
  return resolveClinicAutomationMode(clinic) === "live";
}
