import type { ClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";

export type ClinicAutomationFacts = Readonly<{
  clinicId: string;
  isTest: boolean;
  isDemo: boolean;
  operationalStatus: ClinicOperationalStatus;
  autoReplyEnabled: boolean;
  liveAutomationEnabled: boolean;
  shadowModeEnabled: boolean;
}>;

export type ClinicAutomationFactsReader = {
  getAutomationFacts(clinicId: string): Promise<ClinicAutomationFacts | null>;
};
