export const SYSTEMOPS_LAB_TRANSFER_CONFIRMATION =
  "TRANSFER_ROTATED_CREDENTIAL_TO_SYSTEMOPS_LAB";

export type SystemOpsLabClinicSnapshot = {
  id: string;
  name: string;
  isTest: boolean;
  isDemo: boolean;
  operationalStatus: "prospect" | "test" | "active" | "paused" | "cancelled";
  autoReplyEnabled: boolean;
  shadowModeEnabled: boolean;
  zapiInstanceId: string | null;
};

export type SystemOpsLabTransferContext = {
  target: SystemOpsLabClinicSnapshot | null;
  source: {
    id: string;
    name: string;
    zapiInstanceId: string;
    currentPlaintextToken: string | null;
  } | null;
};

export type SystemOpsLabTransferInput = {
  targetClinicId: string;
  instanceId: string;
  rotatedToken: string;
  clientToken: string | null;
  expectedSourceClinicId: string | null;
  confirmation: string;
};

export interface SystemOpsLabChannelTransferRepository {
  readContext(instanceId: string, targetClinicId: string): Promise<SystemOpsLabTransferContext>;
  transfer(input: Omit<SystemOpsLabTransferInput, "confirmation">): Promise<void>;
  resolveClinicIdByInstance(instanceId: string): Promise<string | null>;
}

export function validateSystemOpsLabTransfer(args: {
  context: SystemOpsLabTransferContext;
} & SystemOpsLabTransferInput): void {
  const { context, targetClinicId, instanceId, rotatedToken, expectedSourceClinicId, confirmation } = args;

  if (!targetClinicId.trim() || !instanceId.trim() || !rotatedToken.trim()) {
    throw new Error("Lab transfer requires target, instance, and rotated credential");
  }

  if (confirmation !== SYSTEMOPS_LAB_TRANSFER_CONFIRMATION) {
    throw new Error("Lab transfer confirmation is invalid");
  }

  const target = context.target;
  if (!target) {
    throw new Error("Lab transfer target was not found");
  }
  if (target.id !== targetClinicId) {
    throw new Error("Lab transfer target does not match request");
  }
  if (!target.isTest || target.isDemo || target.operationalStatus !== "test") {
    throw new Error("Lab transfer target is not an eligible test lab");
  }
  if (target.autoReplyEnabled || target.shadowModeEnabled) {
    throw new Error("Lab transfer target automation must be disabled");
  }
  if (target.zapiInstanceId !== null && target.zapiInstanceId !== instanceId) {
    throw new Error("Lab transfer target is bound to another instance");
  }

  const source = context.source;
  if (source?.id !== expectedSourceClinicId) {
    throw new Error("Lab transfer source does not match expected source");
  }
  if (source?.currentPlaintextToken === rotatedToken) {
    throw new Error("Lab transfer requires a rotated credential");
  }
}

export async function transferSystemOpsLabChannel(
  input: SystemOpsLabTransferInput,
  repository: SystemOpsLabChannelTransferRepository,
): Promise<{ targetClinicId: string; instanceId: string; detachedClinicId: string | null }> {
  const context = await repository.readContext(input.instanceId, input.targetClinicId);
  validateSystemOpsLabTransfer({ ...input, context });

  await repository.transfer({
    targetClinicId: input.targetClinicId,
    instanceId: input.instanceId,
    rotatedToken: input.rotatedToken,
    clientToken: input.clientToken,
    expectedSourceClinicId: input.expectedSourceClinicId,
  });

  if (await repository.resolveClinicIdByInstance(input.instanceId) !== input.targetClinicId) {
    throw new Error("Lab transfer postcondition failed");
  }

  return {
    targetClinicId: input.targetClinicId,
    instanceId: input.instanceId,
    detachedClinicId: context.source?.id ?? null,
  };
}
