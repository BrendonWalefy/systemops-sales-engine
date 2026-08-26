import path from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq } from "drizzle-orm";
import {
  evaluateSystemOpsLabReadiness,
  type SystemOpsLabReadinessReport,
} from "@/application/labs/systemops-lab-readiness";
import { digestSystemOpsDentalLabOwnerMembership } from "@/application/labs/systemops-dental-lab-config";
import type { ConversationRuntimeControl } from "@/application/ports/conversation-runtime-control-store";
import { resolveClinicByZapiInstance } from "@/application/tenancy/resolve-clinic";
import { getZApiInstanceStatus, type ZApiInstanceStatus } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import {
  resolveChannelConfig,
  type ClinicChannelConfig,
} from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { db } from "@/infrastructure/db/client";
import { clinicMembers, organizations } from "@/infrastructure/db/schema";
import { DrizzleInternalLabRuntimeBindingsReader } from "@/infrastructure/conversation-v2/drizzle-internal-lab-runtime-bindings-reader";
import { DrizzleConversationAuthorityStore } from "@/infrastructure/repositories/drizzle-conversation-authority-store";
import { DrizzleConversationRuntimeControlStore } from "@/infrastructure/repositories/drizzle-conversation-runtime-control-store";

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
  liveAutomationEnabled: boolean;
  shadowModeEnabled: boolean;
  channelProvider: "z_api" | "meta_cloud_api" | null;
  zapiInstanceId: string | null;
  zapiToken: string | null;
  zapiClientToken: string | null;
  ownerMembershipDigest: string | null;
};

type SystemOpsLabReadinessVerifierDependencies = {
  readSnapshot(clinicId: string): Promise<SystemOpsLabReadinessSnapshot | null>;
  readAuthorityVersion(clinicId: string): Promise<number | null>;
  readRuntimeControl(): Promise<ConversationRuntimeControl | null>;
  resolveConfigurationDigest(clinicId: string): Promise<string | null>;
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
    authority: { version: null },
    runtimeControl: null,
    configuration: { digest: null },
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
      authority: { version: null },
      runtimeControl: null,
      configuration: { digest: null },
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
      ? deps.getRemoteStatus(channel.zapi)
        .then((status) => status.connected === true && status.smartphoneConnected === true)
      : Promise.resolve(false)
    : Promise.resolve(null);
  const [
    resolvedClinicId,
    authorityVersion,
    runtimeControl,
    configurationDigest,
    remoteValue,
  ] = await Promise.all([
    deps.resolveClinicByInstance(snapshot.zapiInstanceId),
    deps.readAuthorityVersion(clinicId),
    deps.readRuntimeControl(),
    deps.resolveConfigurationDigest(clinicId),
    remoteConnected,
  ]);
  const readiness = evaluateSystemOpsLabReadiness({
    clinicId,
    isTest: snapshot.isTest,
    isDemo: snapshot.isDemo,
    operationalStatus: snapshot.operationalStatus,
    autoReplyEnabled: snapshot.autoReplyEnabled,
    liveAutomationEnabled: snapshot.liveAutomationEnabled,
    shadowModeEnabled: snapshot.shadowModeEnabled,
    channelProvider: channel.provider,
    zapiInstanceId: channel.zapi?.instanceId ?? snapshot.zapiInstanceId,
    hasEncryptedToken: Boolean(snapshot.zapiToken?.trim()),
    resolvedClinicId,
    ownerMembershipMatches: Boolean(
      snapshot.ownerMembershipDigest
      && snapshot.ownerMembershipDigest
        === env.SYSTEMOPS_LAB_OWNER_MEMBERSHIP_DIGEST?.trim(),
    ),
    webhookSecretConfigured: Boolean(env.ZAPI_WEBHOOK_SECRET?.trim()),
    remoteConnected: remoteValue,
    authorityVersion,
    runtimeControl,
    configurationDigest,
  });

  deps.write(JSON.stringify({
    clinicId,
    authority: { version: authorityVersion },
    runtimeControl,
    configuration: { digest: configurationDigest },
    credentials: { configured: Boolean(snapshot.zapiToken?.trim()) },
    webhookSecret: { configured: Boolean(env.ZAPI_WEBHOOK_SECRET?.trim()) },
    readiness,
    remote: {
      checked: remoteCheckRequested,
      connected: remoteCheckRequested ? remoteValue : null,
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
  const authorityStore = new DrizzleConversationAuthorityStore();
  const runtimeControlStore = new DrizzleConversationRuntimeControlStore();
  const configurationReader = new DrizzleInternalLabRuntimeBindingsReader();
  void runSystemOpsLabReadinessCommand(process.env, {
    readSnapshot: async (clinicId) => {
      const [row, ownerMembership] = await Promise.all([
        db
          .select({
            id: organizations.id,
            isTest: organizations.isTest,
            isDemo: organizations.isDemo,
            operationalStatus: organizations.operationalStatus,
            autoReplyEnabled: organizations.autoReplyEnabled,
            liveAutomationEnabled: organizations.liveAutomationEnabled,
            shadowModeEnabled: organizations.shadowModeEnabled,
            channelProvider: organizations.channelProvider,
            zapiInstanceId: organizations.zapiInstanceId,
            zapiToken: organizations.zapiToken,
            zapiClientToken: organizations.zapiClientToken,
          })
          .from(organizations)
          .where(eq(organizations.id, clinicId))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        db
          .select({
            id: clinicMembers.id,
            email: clinicMembers.email,
            role: clinicMembers.role,
          })
          .from(clinicMembers)
          .where(and(eq(clinicMembers.clinicId, clinicId), eq(clinicMembers.role, "owner"))),
      ]);
      return row
        ? {
            ...row,
            ownerMembershipDigest: ownerMembership.length > 0
              ? digestSystemOpsDentalLabOwnerMembership(ownerMembership)
              : null,
          }
        : null;
    },
    readAuthorityVersion: (clinicId) => authorityStore.getVersion(clinicId),
    readRuntimeControl: () => runtimeControlStore.getGlobal(),
    resolveConfigurationDigest: async (clinicId) =>
      (await configurationReader.resolve(clinicId)).configDigest,
    resolveClinicByInstance: resolveClinicByZapiInstance,
    resolveChannel: resolveChannelConfig,
    getRemoteStatus: getZApiInstanceStatus,
    write: (line) => process.stdout.write(`${line}\n`),
  }).then((readiness) => {
    if (readiness === null) process.exitCode = 1;
  });
}
