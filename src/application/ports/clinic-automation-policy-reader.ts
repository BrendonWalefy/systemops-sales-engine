export type ClinicAutomationPolicyReader = {
  canSendAutomatedReply(clinicId: string): Promise<boolean>;
};
