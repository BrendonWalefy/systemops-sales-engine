import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateSystemOpsLabReadiness,
  type SystemOpsLabReadinessPhase,
  type SystemOpsLabReadinessReport,
} from "@/application/labs/systemops-lab-readiness";
import { digestSystemOpsDentalLabOwnerMembership } from "@/application/labs/systemops-dental-lab-config";
import {
  parseAndRegisterDeployedInternalLabApproval,
} from "@/application/conversation-v2/internal-lab-approval";
import { createConfiguredCycleIRuntimeBuildIdentity } from "@/application/conversation-v2/configured-cycle-i-authority";
import { resolveClinicByZapiInstance } from "@/application/tenancy/resolve-clinic";
import { getZApiInstanceStatus, type ZApiInstanceStatus } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import {
  resolveChannelConfig,
  type ClinicChannelConfig,
} from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { db } from "@/infrastructure/db/client";
import { clinicMembers, organizations } from "@/infrastructure/db/schema";
import {
  loadConfiguredInternalLabAuthority,
  loadConfiguredInternalLabDeploymentIdentity,
} from "@/infrastructure/conversation-v2/configured-internal-lab-authority";
import { DrizzleInternalLabRuntimeBindingsReader } from "@/infrastructure/conversation-v2/drizzle-internal-lab-runtime-bindings-reader";
import { and, eq } from "drizzle-orm";

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
  conversationEngine?: string;
  channelProvider: "z_api" | "meta_cloud_api" | null;
  zapiInstanceId: string | null;
  zapiToken: string | null;
  zapiClientToken: string | null;
  ownerMembershipDigest: string | null;
};

type SystemOpsLabReadinessVerifierDependencies = {
  readSnapshot(clinicId: string): Promise<SystemOpsLabReadinessSnapshot | null>;
  resolveClinicByInstance(instanceId: string | null): Promise<string | null>;
  resolveChannel(snapshot: SystemOpsLabReadinessSnapshot): ClinicChannelConfig;
  getRemoteStatus(creds: NonNullable<ClinicChannelConfig["zapi"]>): Promise<ZApiInstanceStatus>;
  resolveApproval?(input: {
    clinicId: string;
    phase: SystemOpsLabReadinessPhase;
  }): Promise<{
    configDigest: string | null;
    expectedConfigDigest: string | null;
    decision: "INTERNAL_LAB_SMOKE_AUTHORIZED" | "INTERNAL_LAB_READY" | null;
    registered: boolean;
  }>;
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

function readinessPhase(env: SystemOpsLabReadinessVerifierEnv): SystemOpsLabReadinessPhase {
  const value = env.SYSTEMOPS_LAB_READINESS_PHASE?.trim() || "preactivation";
  if (value !== "preactivation" && value !== "smoke" && value !== "ready") {
    throw new Error("SYSTEMOPS_LAB_READINESS_PHASE is invalid");
  }
  return value;
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
  const phase = readinessPhase(env);
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
  const approval = phase === "preactivation"
    ? {
        configDigest: null,
        expectedConfigDigest: null,
        decision: null,
        registered: false,
      } as const
    : deps.resolveApproval
      ? await deps.resolveApproval({ clinicId, phase })
      : {
          configDigest: null,
          expectedConfigDigest: null,
          decision: null,
          registered: false,
        } as const;
  const readiness = evaluateSystemOpsLabReadiness({
    phase,
    clinicId,
    isTest: snapshot.isTest,
    isDemo: snapshot.isDemo,
    operationalStatus: snapshot.operationalStatus,
    autoReplyEnabled: snapshot.autoReplyEnabled,
    shadowModeEnabled: snapshot.shadowModeEnabled,
    conversationEngine: snapshot.conversationEngine,
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
    remoteConnected: await remoteConnected,
    configDigest: approval.configDigest,
    expectedConfigDigest: approval.expectedConfigDigest,
    approvalDecision: approval.decision,
    approvalRegistered: approval.registered,
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
      const [row, ownerMembership] = await Promise.all([
        db
          .select({
            id: organizations.id,
            isTest: organizations.isTest,
            isDemo: organizations.isDemo,
            operationalStatus: organizations.operationalStatus,
            autoReplyEnabled: organizations.autoReplyEnabled,
            shadowModeEnabled: organizations.shadowModeEnabled,
            conversationEngine: organizations.conversationEngine,
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
    resolveClinicByInstance: resolveClinicByZapiInstance,
    resolveChannel: resolveChannelConfig,
    getRemoteStatus: getZApiInstanceStatus,
    resolveApproval: async ({ clinicId }) => {
      try {
        const bindings = await new DrizzleInternalLabRuntimeBindingsReader().resolve(clinicId);
        const runtimeIdentity = createConfiguredCycleIRuntimeBuildIdentity();
        const approval = parseAndRegisterDeployedInternalLabApproval({
          serializedApproval: process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON ?? "",
          authority: loadConfiguredInternalLabAuthority(),
          runtimeIdentity,
          deploymentIdentity: loadConfiguredInternalLabDeploymentIdentity(),
          expectedTenantDigest: bindings.tenantDigest,
          expectedChannelDigest: bindings.channelDigest,
          expectedConfigDigest: bindings.configDigest,
          now: new Date(),
        });
        return {
          configDigest: bindings.configDigest,
          expectedConfigDigest:
            process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST?.trim() ?? null,
          decision: approval.claims.decision,
          registered: true,
        };
      } catch {
        return {
          configDigest: null,
          expectedConfigDigest:
            process.env.CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST?.trim() ?? null,
          decision: null,
          registered: false,
        };
      }
    },
    write: (line) => process.stdout.write(`${line}\n`),
  }).then((readiness) => {
    if (readiness === null) process.exitCode = 1;
  });
}
