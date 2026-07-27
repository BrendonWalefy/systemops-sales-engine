import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";

export type ClinicAutomationPolicyReader = {
  getAutomationMode(clinicId: string): Promise<ClinicAutomationMode>;
};
