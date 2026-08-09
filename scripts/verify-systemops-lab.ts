import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateSystemOpsLabReadiness,
  type SystemOpsLabReadinessReport,
} from "@/application/labs/systemops-lab-readiness";
import { resolveClinicByZapiInstance } from "@/application/tenancy/resolve-clinic";
import { getZApiInstanceStatus, type ZApiInstanceStatus } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import {
  resolveChannelConfig,
  type ClinicChannelConfig,
} from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";

export type SystemOpsLabReadinessVerifierEnv = Record<string, string | undefined>;

export const SYSTEMOPS_LAB_READINESS_FAILURE_REASON_CODES = [
  "readiness_check_failed",
] as const;

type SystemOpsLabReadinessSnapshot = {
  id: string;
  isTest: boolean;
  isDemo: boolean;
  operationalStatus: string;
  autoReplyEnabled: boolean;
  shadowModeEnabled: boolean;
  channelProvider: "z_api" | "meta_cloud_api" | null;
  zapiInstanceId: string | null;
  zapiToken: string | null;
  zapiClientToken: string | null;
};

type SystemOpsLabReadinessVerifierDependencies = {
  readSnapshot(clinicId: string): Promise<SystemOpsLabReadinessSnapshot | null>;
  resolveClinicByInstance(instanceId: string | null): Promise<string | null>;
  resolveChannel(snapshot: SystemOpsLabReadinessSnapshot): ClinicChannelConfig;
  getRemoteStatus(creds: NonNullable<ClinicChannelConfig["zapi"]>): Promise<ZApiInstanceStatus>;
  write(line: string): void;
};

function requiredEnv(env: SystemOpsLabReadinessVerifierEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function reportMissingClinic(): SystemOpsLabReadinessReport {
  return {
    readyForControlledInbound: false,
    readyForAutomation: false,
    blockers: ["target_not_test"],
  };
}

function writeReadinessFailure(
  clinicId: string,
  webhookSecretConfigured: boolean,
  write: (line: string) => void,
): void {
  write(JSON.stringify({
    clinicId,
    credentials: { configured: false },
    webhookSecret: { configured: webhookSecretConfigured },
    readiness: {
      readyForControlledInbound: false,
      readyForAutomation: false,
      blockers: [],
    },
    remote: { checked: false, connected: null, warnings: ["remote_not_connected"] },
    reasonCodes: SYSTEMOPS_LAB_READINESS_FAILURE_REASON_CODES,
  }));
}

export async function runSystemOpsLabReadinessVerifier(
  env: SystemOpsLabReadinessVerifierEnv,
  deps: SystemOpsLabReadinessVerifierDependencies,
): Promise<SystemOpsLabReadinessReport> {
  const clinicId = requiredEnv(env, "SYSTEMOPS_LAB_CLINIC_ID");
  const snapshot = await deps.readSnapshot(clinicId);

  if (!snapshot) {
    const readiness = reportMissingClinic();
    deps.write(JSON.stringify({
      clinicId,
      credentials: { configured: false },
      webhookSecret: { configured: Boolean(env.ZAPI_WEBHOOK_SECRET?.trim()) },
      readiness,
      remote: { checked: false, connected: null, warnings: ["remote_not_connected"] },
    }));
    return readiness;
  }

  const channel = deps.resolveChannel(snapshot);
  const remoteCheckRequested = env.SYSTEMOPS_LAB_CHECK_REMOTE === "true";
  const remoteConnected = remoteCheckRequested
    ? channel.zapi
      ? (() => deps.getRemoteStatus(channel.zapi))()
        .then((status) => status.connected === true && status.smartphoneConnected === true)
      : Promise.resolve(false)
    : Promise.resolve(null);
  const resolvedClinicId = await deps.resolveClinicByInstance(snapshot.zapiInstanceId);
  const readiness = evaluateSystemOpsLabReadiness({
    clinicId,
    isTest: snapshot.isTest,
    isDemo: snapshot.isDemo,
    operationalStatus: snapshot.operationalStatus,
    autoReplyEnabled: snapshot.autoReplyEnabled,
    shadowModeEnabled: snapshot.shadowModeEnabled,
    channelProvider: channel.provider,
    zapiInstanceId: channel.zapi?.instanceId ?? snapshot.zapiInstanceId,
    hasEncryptedToken: Boolean(snapshot.zapiToken?.trim()),
    resolvedClinicId,
    webhookSecretConfigured: Boolean(env.ZAPI_WEBHOOK_SECRET?.trim()),
    remoteConnected: await remoteConnected,
  });
  const remoteValue = remoteCheckRequested ? await remoteConnected : null;

  deps.write(JSON.stringify({
    clinicId,
    credentials: { configured: Boolean(snapshot.zapiToken?.trim()) },
    webhookSecret: { configured: Boolean(env.ZAPI_WEBHOOK_SECRET?.trim()) },
    readiness,
    remote: {
      checked: remoteCheckRequested,
      connected: remoteValue,
      warnings: remoteCheckRequested ? [] : ["remote_not_connected"],
    },
  }));
  return readiness;
}

export async function runSystemOpsLabReadinessCommand(
  env: SystemOpsLabReadinessVerifierEnv,
  deps: SystemOpsLabReadinessVerifierDependencies,
): Promise<SystemOpsLabReadinessReport | null> {
  const clinicId = env.SYSTEMOPS_LAB_CLINIC_ID?.trim() || "unknown";
  try {
    return await runSystemOpsLabReadinessVerifier(env, deps);
  } catch {
    writeReadinessFailure(
      clinicId,
      Boolean(env.ZAPI_WEBHOOK_SECRET?.trim()),
      deps.write,
    );
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runSystemOpsLabReadinessCommand(process.env, {
    readSnapshot: async (clinicId) => {
      const row = await db
        .select({
          id: organizations.id,
          isTest: organizations.isTest,
          isDemo: organizations.isDemo,
          operationalStatus: organizations.operationalStatus,
          autoReplyEnabled: organizations.autoReplyEnabled,
          shadowModeEnabled: organizations.shadowModeEnabled,
          channelProvider: organizations.channelProvider,
          zapiInstanceId: organizations.zapiInstanceId,
          zapiToken: organizations.zapiToken,
          zapiClientToken: organizations.zapiClientToken,
        })
        .from(organizations)
        .where(eq(organizations.id, clinicId))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      return row;
    },
    resolveClinicByInstance: resolveClinicByZapiInstance,
    resolveChannel: resolveChannelConfig,
    getRemoteStatus: getZApiInstanceStatus,
    write: (line) => process.stdout.write(`${line}\n`),
  }).then((readiness) => {
    if (readiness === null) process.exitCode = 1;
  });
}
