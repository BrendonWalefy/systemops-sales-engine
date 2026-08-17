import type { ClinicOperationalStatus } from "@/application/clinics/clinic-operational-status";

export type InternalLabEligibilityFacts = Readonly<{
  clinicId: string;
  isTest: boolean;
  isDemo: boolean;
  operationalStatus: ClinicOperationalStatus;
  autoReplyEnabled: boolean;
  shadowModeEnabled: boolean;
}>;

export interface InternalLabEligibilityReader {
  getInternalLabEligibilityFacts(
    clinicId: string,
  ): Promise<InternalLabEligibilityFacts | null>;
}
