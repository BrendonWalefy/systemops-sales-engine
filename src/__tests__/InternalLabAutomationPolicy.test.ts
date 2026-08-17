import { describe, expect, it, vi } from "vitest";
import { InternalLabAutomationPolicyReader } from "@/application/automation/internal-lab-automation-policy-reader";
import { createRegisteredInternalLabSmokeApproval, INTERNAL_LAB_TEST_BINDINGS } from "@/__tests__/helpers/internal-lab-approval-fixture";

function makeReader(overrides: Record<string, unknown> = {}) {
  const registered = createRegisteredInternalLabSmokeApproval();
  return new InternalLabAutomationPolicyReader({
    basePolicyReader: { getAutomationMode: vi.fn().mockResolvedValue("disabled") },
    eligibilityReader: { getInternalLabEligibilityFacts: vi.fn().mockResolvedValue({
      clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId, isTest: true, isDemo: false,
      operationalStatus: "test", autoReplyEnabled: true, shadowModeEnabled: false,
    }) },
    runtimeBindingsReader: { resolve: vi.fn().mockResolvedValue({
      tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
      channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
      configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
    }) },
    approval: registered.approval,
    runtimeIdentity: registered.runtimeIdentity,
    expectedClinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
    expectedTenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
    expectedChannelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
    expectedConfigDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
    now: () => INTERNAL_LAB_TEST_BINDINGS.now,
    ...overrides,
  } as never);
}

describe("InternalLabAutomationPolicyReader", () => {
  it("promotes status=test to live only for the exact approved Lab", async () => {
    await expect(makeReader().getAutomationMode(INTERNAL_LAB_TEST_BINDINGS.expectedClinicId)).resolves.toBe("live");
    await expect(makeReader().getAutomationMode("other-test-tenant")).resolves.toBe("disabled");
    await expect(makeReader({ approval: null }).getAutomationMode(INTERNAL_LAB_TEST_BINDINGS.expectedClinicId)).resolves.toBe("disabled");
  });

  it.each(["observe", "live"] as const)("preserves the base %s decision", async (mode) => {
    await expect(makeReader({ basePolicyReader: { getAutomationMode: vi.fn().mockResolvedValue(mode) } })
      .getAutomationMode(INTERNAL_LAB_TEST_BINDINGS.expectedClinicId)).resolves.toBe(mode);
  });

  it.each([
    ["isTest", false], ["isDemo", true], ["operationalStatus", "cancelled"],
    ["autoReplyEnabled", false], ["shadowModeEnabled", true],
  ] as const)("keeps the Lab disabled when %s is invalid", async (field, value) => {
    const facts = { clinicId: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId, isTest: true, isDemo: false,
      operationalStatus: "test", autoReplyEnabled: true, shadowModeEnabled: false, [field]: value };
    await expect(makeReader({ eligibilityReader: { getInternalLabEligibilityFacts: vi.fn().mockResolvedValue(facts) } })
      .getAutomationMode(INTERNAL_LAB_TEST_BINDINGS.expectedClinicId)).resolves.toBe("disabled");
  });
});
