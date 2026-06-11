type ClinicAutomationToggle = {
  autoReplyEnabled: boolean;
};

// Kill switch operacional da clínica: se a IA foi desligada, nenhum outbound
// automatizado deve sair sem decisão explícita em contrário.
export function shouldSendAutomatedClinicOutbound(
  clinic: ClinicAutomationToggle,
): boolean {
  return clinic.autoReplyEnabled !== false;
}
