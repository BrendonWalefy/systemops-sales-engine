import { describe, expect, it, vi } from "vitest";

import {
  SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
  transferSystemOpsLabChannel,
  validateSystemOpsLabTransfer,
  type SystemOpsLabChannelTransferRepository,
  type SystemOpsLabTransferContext,
} from "@/application/labs/systemops-lab-channel-transfer";

const safeContext: SystemOpsLabTransferContext = {
  target: {
    id: "lab-id",
    name: "SystemOps Lab",
    isTest: true,
    isDemo: false,
    operationalStatus: "test",
    autoReplyEnabled: false,
    shadowModeEnabled: false,
    zapiInstanceId: null,
  },
  source: {
    id: "old-id",
    name: "Legacy tenant",
    zapiInstanceId: "instance-1",
    currentPlaintextToken: "old-token",
  },
};

const safeInput = {
  targetClinicId: "lab-id",
  instanceId: "instance-1",
  rotatedToken: "new-token",
  clientToken: "client-token",
  expectedSourceClinicId: "old-id",
  confirmation: SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
};

describe("SystemOps Lab channel transfer policy", () => {
  const invalidContexts: Array<[string, Partial<SystemOpsLabTransferContext>, string | null]> = [
    ["target must be test", { target: { ...safeContext.target!, isTest: false } }, "old-id"],
    ["target status must be test", { target: { ...safeContext.target!, operationalStatus: "active" } }, "old-id"],
    ["automation must be disabled", { target: { ...safeContext.target!, autoReplyEnabled: true } }, "old-id"],
    ["shadow must be disabled", { target: { ...safeContext.target!, shadowModeEnabled: true } }, "old-id"],
    ["demo is not a lab", { target: { ...safeContext.target!, isDemo: true } }, "old-id"],
    ["target is missing", { target: null }, "old-id"],
    ["target id differs from the requested target", { target: { ...safeContext.target!, id: "other-lab-id" } }, "old-id"],
    ["target is already bound to a different instance", { target: { ...safeContext.target!, zapiInstanceId: "other-instance" } }, "old-id"],
    ["source differs from the expected source", { source: { ...safeContext.source!, id: "other-source-id" } }, "old-id"],
    ["source exists but no expected source was supplied", {}, null],
  ];

  it.each(invalidContexts)("rejects when %s", (_label, patch, expectedSourceClinicId) => {
    expect(() => validateSystemOpsLabTransfer({
      ...safeInput,
      context: { ...safeContext, ...patch },
      expectedSourceClinicId,
    })).toThrow();
  });

  it.each([
    ["target clinic id", { targetClinicId: " " }],
    ["instance id", { instanceId: "" }],
    ["rotated token", { rotatedToken: "  " }],
    ["confirmation", { confirmation: "wrong-confirmation" }],
  ])("rejects a missing or invalid %s", (_label, patch) => {
    expect(() => validateSystemOpsLabTransfer({
      ...safeInput,
      ...patch,
      context: safeContext,
    })).toThrow();
  });

  it("rejects the current token instead of accepting an unrotated credential", () => {
    expect(() => validateSystemOpsLabTransfer({
      ...safeInput,
      context: safeContext,
      rotatedToken: "old-token",
    })).toThrow("rotated");
  });

  it("transfers once and verifies tenant resolution", async () => {
    const repository: SystemOpsLabChannelTransferRepository = {
      readContext: vi.fn().mockResolvedValue(safeContext),
      transfer: vi.fn().mockResolvedValue(undefined),
      resolveClinicIdByInstance: vi.fn().mockResolvedValue("lab-id"),
    };

    const result = await transferSystemOpsLabChannel(safeInput, repository);

    expect(result).toEqual({ targetClinicId: "lab-id", instanceId: "instance-1", detachedClinicId: "old-id" });
    expect(repository.transfer).toHaveBeenCalledOnce();
  });

  it("fails closed when the transferred instance resolves to another tenant", async () => {
    const repository: SystemOpsLabChannelTransferRepository = {
      readContext: vi.fn().mockResolvedValue(safeContext),
      transfer: vi.fn().mockResolvedValue(undefined),
      resolveClinicIdByInstance: vi.fn().mockResolvedValue("other-lab-id"),
    };

    await expect(transferSystemOpsLabChannel(safeInput, repository)).rejects.toThrow("Lab transfer postcondition failed");
  });
});
