import type { ClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";

type ClinicAutomationToggle = {
  autoReplyEnabled: boolean;
  operationalStatus?: ClinicOperationalStatus | null;
  shadowModeEnabled?: boolean | null;
};

// Kill switch operacional da clínica: se a IA foi desligada, nenhum outbound
// automatizado deve sair sem decisão explícita em contrário. Além disso,
// apenas clínicas ativas entram no fluxo automático; prospect, test, paused e
// cancelled ficam bloqueadas por policy única.
//
// Exceção: shadowModeEnabled força a composição da resposta independente do
// status operacional (permite observar comportamento em pré-onboarding ou
// clínicas pausadas). Clínicas arquivadas (cancelled) nunca compõem, nem em
// shadow mode. O envio real ao WhatsApp é bloqueado à parte, em
// send-message-job.ts — este flag NUNCA autoriza envio, só composição/log.
export function shouldSendAutomatedClinicOutbound(
  clinic: ClinicAutomationToggle,
): boolean {
  if (clinic.operationalStatus === "cancelled") return false;
  if (clinic.shadowModeEnabled) return true;
  return (
    clinic.autoReplyEnabled !== false && clinic.operationalStatus === "active"
  );
}
