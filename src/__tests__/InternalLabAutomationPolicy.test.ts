import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InternalLabAutomationPolicyReader } from "@/application/automation/internal-lab-automation-policy-reader";
import { createRegisteredInternalLabApprovalFixture } from "@/__tests__/test-support/registered-internal-lab-approval";

type ApprovalFixture = ReturnType<typeof createRegisteredInternalLabApprovalFixture>;
let registered: ApprovalFixture;

const exactFacts = {
  clinicId: "systemops-lab",
  isTest: true,
  isDemo: false,
  operationalStatus: "test" as const,
  autoReplyEnabled: true,
  shadowModeEnabled: false,
};

beforeAll(() => {
  registered = createRegisteredInternalLabApprovalFixture();
});

afterAll(() => registered.restoreEnvironment());

function makeReader(input: {
  baseMode?: "live" | "observe" | "disabled";
  facts?: typeof exactFacts | null;
  approval?: ApprovalFixture["approval"] | null;
  expectedClinicId?: string;
  target?: ApprovalFixture["target"];
} = {}) {
  const base = { getAutomationMode: vi.fn().mockResolvedValue(input.baseMode ?? "disabled") };
  const eligibility = {
    getInternalLabEligibilityFacts: vi.fn().mockResolvedValue(
      input.facts === undefined ? exactFacts : input.facts,
    ),
  };
  return {
    reader: new InternalLabAutomationPolicyReader({
      base,
      eligibility,
      approval: input.approval === undefined ? registered.approval : input.approval,
      runtimeIdentity: registered.runtimeIdentity,
      expectedClinicId: input.expectedClinicId ?? "systemops-lab",
      internalLabTarget: input.target ?? registered.target,
      now: () => registered.now,
    }),
    base,
    eligibility,
  };
}

describe("InternalLabAutomationPolicyReader", () => {
  it("opens status=test automation only when every Lab predicate and registered target matches", async () => {
    const { reader, base, eligibility } = makeReader();

    await expect(reader.getAutomationMode("systemops-lab")).resolves.toBe("live");

    expect(base.getAutomationMode).toHaveBeenCalledOnce();
    expect(eligibility.getInternalLabEligibilityFacts).toHaveBeenCalledOnce();
  });

  it.each([
    ["approval is missing", { approval: null }],
    ["raw tenant target differs", { expectedClinicId: "other-lab" }],
    ["channel approval differs", { target: { tenantDigest: "hmac:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaf", channelDigest: "hmac:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", configDigest: "hmac:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }],
    ["tenant is not test", { facts: { ...exactFacts, isTest: false } }],
    ["tenant is demo", { facts: { ...exactFacts, isDemo: true } }],
    ["status is not test", { facts: { ...exactFacts, operationalStatus: "active" as const } }],
    ["kill switch is off", { facts: { ...exactFacts, autoReplyEnabled: false } }],
    ["tenant binding differs", { facts: { ...exactFacts, clinicId: "other-tenant" } }],
  ] as const)("keeps status=test disabled when %s", async (_case, override) => {
    const { reader } = makeReader(override as never);
    await expect(reader.getAutomationMode("systemops-lab")).resolves.toBe("disabled");
  });

  it("preserves observe precedence when legacy shadow mode is enabled", async () => {
    const { reader, eligibility } = makeReader({ baseMode: "observe" });

    await expect(reader.getAutomationMode("systemops-lab")).resolves.toBe("observe");

    expect(eligibility.getInternalLabEligibilityFacts).not.toHaveBeenCalled();
  });

  it("preserves normal active automation without requiring Lab approval", async () => {
    const { reader, eligibility } = makeReader({ baseMode: "live", approval: null });

    await expect(reader.getAutomationMode("ordinary-active-tenant")).resolves.toBe("live");

    expect(eligibility.getInternalLabEligibilityFacts).not.toHaveBeenCalled();
  });

  it("keeps the status=test exception independent of engine selection for next-turn V1 rollback", async () => {
    const { reader } = makeReader();

    await expect(reader.getAutomationMode("systemops-lab")).resolves.toBe("live");

    expect(reader).not.toHaveProperty("getConversationEnginePolicy");
    expect(JSON.stringify(reader)).not.toContain("conversationEngine");
  });
});
