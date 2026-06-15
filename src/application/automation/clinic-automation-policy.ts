import type { ClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";

type ClinicAutomationToggle = {
  autoReplyEnabled: boolean;
  operationalStatus?: ClinicOperationalStatus | null;
};

// Kill switch operacional da clínica: se a IA foi desligada, nenhum outbound
// automatizado deve sair sem decisão explícita em contrário. Além disso,
// apenas clínicas ativas entram no fluxo automático; prospect, test, paused e
// cancelled ficam bloqueadas por policy única.
export function shouldSendAutomatedClinicOutbound(
  clinic: ClinicAutomationToggle,
): boolean {
  return (
    clinic.autoReplyEnabled !== false && clinic.operationalStatus === "active"
  );
}
