import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
  transferSystemOpsLabChannel,
  type SystemOpsLabTransferInput,
} from "@/application/labs/systemops-lab-channel-transfer";
import { DrizzleSystemOpsLabChannelTransferRepository } from "@/infrastructure/repositories/drizzle-systemops-lab-channel-transfer-repository";

export type SystemOpsLabTransferCommandEnv = Record<string, string | undefined>;

type SystemOpsLabTransferInspection = {
  safe: boolean;
  sourceClinicId: string | null;
  reasons?: string[];
};

type SystemOpsLabTransferCommandDependencies = {
  inspect(input: {
    targetClinicId: string;
    instanceId: string;
    expectedSourceClinicId: string | null;
  }): Promise<SystemOpsLabTransferInspection>;
  transfer(input: SystemOpsLabTransferInput): Promise<unknown>;
  write(line: string): void;
};

const SAFE_INSPECTION_REASON_CODES = new Set([
  "target_not_found",
  "target_not_test",
  "target_is_demo",
  "target_status_not_test",
  "target_automation_enabled",
  "target_shadow_enabled",
  "target_bound_to_other_instance",
  "source_mismatch",
]);

function requiredEnv(env: SystemOpsLabTransferCommandEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(env: SystemOpsLabTransferCommandEnv, name: string): string | null {
  return env[name]?.trim() || null;
}

export async function runSystemOpsLabTransferCommand(
  env: SystemOpsLabTransferCommandEnv,
  deps: SystemOpsLabTransferCommandDependencies,
): Promise<{ mode: "dry-run" | "apply"; applied: boolean }> {
  const targetClinicId = requiredEnv(env, "SYSTEMOPS_LAB_CLINIC_ID");
  const instanceId = requiredEnv(env, "SYSTEMOPS_LAB_ZAPI_INSTANCE_ID");
  const expectedSourceClinicId = optionalEnv(
    env,
    "SYSTEMOPS_LAB_EXPECTED_SOURCE_CLINIC_ID",
  );
  const mode = env.SYSTEMOPS_LAB_APPLY === "true" ? "apply" : "dry-run";
  let inspection: SystemOpsLabTransferInspection;
  try {
    inspection = await deps.inspect({
      targetClinicId,
      instanceId,
      expectedSourceClinicId,
    });
  } catch {
    throw new Error("SystemOps Lab transfer inspection failed");
  }
  const sourceMatchesExpected = inspection.sourceClinicId === expectedSourceClinicId;
  const reasonCodes = [
    ...new Set((inspection.reasons ?? []).map((reason) => (
      SAFE_INSPECTION_REASON_CODES.has(reason)
        ? reason
        : "unrecognized_reason_code"
    ))),
  ];

  deps.write(`mode=${mode}`);
  deps.write(`targetClinicId=${targetClinicId}`);
  deps.write(`instanceId=${instanceId}`);
  deps.write(`expectedSourceClinicId=${expectedSourceClinicId ?? "none"}`);
  deps.write(`sourceClinicId=${inspection.sourceClinicId ?? "none"}`);
  deps.write(`inspectionSafe=${inspection.safe}`);
  deps.write(`sourceOwnerPresent=${inspection.sourceClinicId !== null}`);
  deps.write(`sourceMatchesExpected=${sourceMatchesExpected}`);
  deps.write(`reasonCodes=${reasonCodes.join(",") || "none"}`);

  if (inspection.sourceClinicId && !expectedSourceClinicId) {
    throw new Error(
      "SYSTEMOPS_LAB_EXPECTED_SOURCE_CLINIC_ID is required when an owner exists",
    );
  }
  if (!sourceMatchesExpected) {
    throw new Error("SystemOps Lab transfer source does not match inspected owner");
  }
  if (!inspection.safe) {
    throw new Error("SystemOps Lab transfer inspection rejected");
  }

  if (mode === "dry-run") {
    deps.write("applied=false");
    return { mode, applied: false };
  }

  const rotatedToken = requiredEnv(env, "SYSTEMOPS_LAB_ZAPI_TOKEN");
  const confirmation = requiredEnv(
    env,
    "SYSTEMOPS_LAB_TRANSFER_CONFIRMATION",
  );
  if (confirmation !== SYSTEMOPS_LAB_TRANSFER_CONFIRMATION) {
    throw new Error("SYSTEMOPS_LAB_TRANSFER_CONFIRMATION is invalid");
  }

  try {
    await deps.transfer({
      targetClinicId,
      instanceId,
      rotatedToken,
      clientToken: optionalEnv(env, "SYSTEMOPS_LAB_ZAPI_CLIENT_TOKEN"),
      expectedSourceClinicId,
      confirmation,
    });
  } catch {
    throw new Error("SystemOps Lab transfer apply failed");
  }

  deps.write("applied=true");
  return { mode, applied: true };
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repository = new DrizzleSystemOpsLabChannelTransferRepository();

  void runSystemOpsLabTransferCommand(process.env, {
    inspect: async ({ targetClinicId, instanceId, expectedSourceClinicId }) => {
      const context = await repository.readContext(instanceId, targetClinicId);
      const reasons: string[] = [];
      const target = context.target;

      if (!target) {
        reasons.push("target_not_found");
      } else {
        if (!target.isTest) reasons.push("target_not_test");
        if (target.isDemo) reasons.push("target_is_demo");
        if (target.operationalStatus !== "test") reasons.push("target_status_not_test");
        if (target.autoReplyEnabled) reasons.push("target_automation_enabled");
        if (target.shadowModeEnabled) reasons.push("target_shadow_enabled");
        if (target.zapiInstanceId && target.zapiInstanceId !== instanceId) {
          reasons.push("target_bound_to_other_instance");
        }
      }
      if ((context.source?.id ?? null) !== expectedSourceClinicId) {
        reasons.push("source_mismatch");
      }

      return {
        safe: reasons.length === 0,
        sourceClinicId: context.source?.id ?? null,
        reasons,
      };
    },
    transfer: (input) => transferSystemOpsLabChannel(input, repository),
    write: (line) => process.stdout.write(`${line}\n`),
  }).catch(() => {
    process.stderr.write("reasonCodes=command_failed\n");
    process.exitCode = 1;
  });
}
