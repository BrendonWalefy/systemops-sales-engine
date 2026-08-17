import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import type { ClinicAutomationPolicyReader } from "@/application/ports/clinic-automation-policy-reader";
import type { InternalLabEligibilityReader } from "@/application/ports/internal-lab-eligibility-reader";
import type { CycleIRuntimeBuildIdentity } from "@/application/conversation-v2/configured-cycle-i-authority";
import {
  isRegisteredInternalLabApproval,
  type RegisteredInternalLabApproval,
} from "@/application/conversation-v2/internal-lab-approval";

type Dependencies = Readonly<{
  basePolicyReader: ClinicAutomationPolicyReader;
  eligibilityReader: InternalLabEligibilityReader;
  approval: RegisteredInternalLabApproval | null;
  runtimeIdentity: CycleIRuntimeBuildIdentity | null;
  expectedClinicId: string;
  expectedTenantDigest: string;
  expectedChannelDigest: string;
  expectedConfigDigest: string;
  now(): Date;
}>;

export class InternalLabAutomationPolicyReader implements ClinicAutomationPolicyReader {
  constructor(private readonly deps: Dependencies) {
    if (typeof deps.expectedClinicId !== "string" || deps.expectedClinicId.length === 0) {
      throw new Error("Internal Lab expected clinic id is required");
    }
  }

  async getAutomationMode(clinicId: string): Promise<ClinicAutomationMode> {
    const baseMode = await this.deps.basePolicyReader.getAutomationMode(clinicId);
    if (baseMode !== "disabled") return baseMode;
    if (clinicId !== this.deps.expectedClinicId || !this.deps.runtimeIdentity) {
      return "disabled";
    }

    const facts = await this.deps.eligibilityReader.getInternalLabEligibilityFacts(clinicId);
    if (!facts
      || facts.clinicId !== this.deps.expectedClinicId
      || !facts.isTest
      || facts.isDemo
      || facts.operationalStatus !== "test"
      || !facts.autoReplyEnabled
      || facts.shadowModeEnabled) return "disabled";

    const expected = {
      runtimeIdentity: this.deps.runtimeIdentity,
      tenantDigest: this.deps.expectedTenantDigest,
      channelDigest: this.deps.expectedChannelDigest,
      configDigest: this.deps.expectedConfigDigest,
      now: this.deps.now(),
    } as const;
    return isRegisteredInternalLabApproval(this.deps.approval, {
      ...expected,
      decision: "INTERNAL_LAB_SMOKE_AUTHORIZED",
    }) || isRegisteredInternalLabApproval(this.deps.approval, {
      ...expected,
      decision: "INTERNAL_LAB_READY",
    }) ? "live" : "disabled";
  }
}
