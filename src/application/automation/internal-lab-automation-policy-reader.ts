import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import type { ClinicAutomationPolicyReader } from "@/application/ports/clinic-automation-policy-reader";
import type { InternalLabEligibilityReader } from "@/application/ports/internal-lab-eligibility-reader";
import type { InternalLabRuntimeBindingsReader } from "@/application/conversation-v2/internal-lab-runtime-bindings";
import {
  isInternalLabAuthorized,
  type InternalLabAuthorizationBindings,
} from "@/application/conversation-v2/internal-lab-authorization";

type Dependencies = Readonly<{
  basePolicyReader: ClinicAutomationPolicyReader;
  eligibilityReader: InternalLabEligibilityReader;
  runtimeBindingsReader: InternalLabRuntimeBindingsReader;
}> & InternalLabAuthorizationBindings;

export class InternalLabAutomationPolicyReader implements ClinicAutomationPolicyReader {
  constructor(private readonly deps: Dependencies) {
    if (typeof deps.expectedClinicId !== "string" || deps.expectedClinicId.length === 0) {
      throw new Error("Internal Lab expected clinic id is required");
    }
  }

  async getAutomationMode(clinicId: string): Promise<ClinicAutomationMode> {
    const baseMode = await this.deps.basePolicyReader.getAutomationMode(clinicId);
    if (baseMode !== "disabled") return baseMode;
    if (clinicId !== this.deps.expectedClinicId) {
      return "disabled";
    }

    try {
      const [facts, currentBindings] = await Promise.all([
        this.deps.eligibilityReader.getInternalLabEligibilityFacts(clinicId),
        this.deps.runtimeBindingsReader.resolve(clinicId),
      ]);
      return isInternalLabAuthorized(facts, {
        ...this.deps,
        expectedTenantDigest: currentBindings.tenantDigest,
        expectedChannelDigest: currentBindings.channelDigest,
        expectedConfigDigest: currentBindings.configDigest,
      }) ? "live" : "disabled";
    } catch {
      return "disabled";
    }
  }
}
