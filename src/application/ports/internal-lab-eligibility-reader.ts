import type { ClinicAutomationFacts } from "@/application/ports/clinic-automation-policy-reader";

export type InternalLabEligibilityFacts = ClinicAutomationFacts;

export interface InternalLabEligibilityReader {
  getInternalLabEligibilityFacts(
    clinicId: string,
  ): Promise<InternalLabEligibilityFacts | null>;
}
