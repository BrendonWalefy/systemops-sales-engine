import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";

import type { ConversationRuntimeControl } from "@/application/ports/conversation-runtime-control-store";
import { db } from "@/infrastructure/db/client";
import {
  inboundEvents,
  jobs,
  outboundMessages,
} from "@/infrastructure/db/schema";
import { DrizzleConversationRuntimeControlStore } from "@/infrastructure/repositories/drizzle-conversation-runtime-control-store";
import {
  assertUuid,
  validateWhatsAppStreamAuthority,
  type AuthorityValidationReport,
} from "./validate-whatsapp-stream-authority";

export type RolloutOperationalStatus =
  | "prospect"
  | "test"
  | "active"
  | "paused"
  | "cancelled";

export type V2OnlyRolloutTarget = Readonly<{
  clinicId: string;
  operationalStatus: RolloutOperationalStatus;
  isTest: boolean;
  isDemo: boolean;
  autoReplyEnabled: boolean;
  liveAutomationEnabled: boolean;
  shadowModeEnabled: boolean;
  authorityVersion: number;
}>;

export type V2OnlyLiveTenant = Readonly<{
  clinicId: string;
  operationalStatus: "active";
  authorityVersion: number;
}>;

type CountMap = Readonly<Record<string, number>>;

export type V2OnlyRolloutAuditDependencies = Readonly<{
  readTarget(clinicId: string): Promise<V2OnlyRolloutTarget | null>;
  readLiveTenants(): Promise<readonly V2OnlyLiveTenant[]>;
  readQueueCounts(clinicId: string): Promise<CountMap>;
  readOutboundCounts(clinicId: string): Promise<CountMap>;
  readAuthorityValidation(clinicId: string): Promise<AuthorityValidationReport>;
  readRuntimeControl(): Promise<ConversationRuntimeControl>;
  readOtherTenantDigest(clinicId: string): Promise<string>;
  deploymentSha(): string | null;
}>;

export type V2OnlyRolloutAuditResult = Readonly<{
  clinicId: string;
  deploymentSha: string | null;
  target: Omit<V2OnlyRolloutTarget, "clinicId">;
  liveTenants: readonly V2OnlyLiveTenant[];
  queues: CountMap;
  outbounds: CountMap;
  runtimeControl: ConversationRuntimeControl;
  authority: Readonly<{
    clean: boolean;
    metrics: AuthorityValidationReport["metrics"];
  }>;
  otherTenantDigest: string;
}>;

export async function auditV2OnlyRollout(
  input: Readonly<{
    clinicId: string;
    expectedLiveTenantIds: readonly string[];
  }>,
  dependencies: V2OnlyRolloutAuditDependencies = defaultAuditDependencies,
): Promise<V2OnlyRolloutAuditResult> {
  assertUuid(input.clinicId, "clinic id");
  const expectedLiveTenantIds = [...new Set(input.expectedLiveTenantIds)].sort();
  if (expectedLiveTenantIds.length !== input.expectedLiveTenantIds.length) {
    throw new Error("expected live tenant set contains duplicates");
  }
  expectedLiveTenantIds.forEach((clinicId) => assertUuid(clinicId, "expected live tenant id"));

  const [
    target,
    liveTenants,
    queues,
    outbounds,
    authority,
    runtimeControl,
    otherTenantDigest,
  ] = await Promise.all([
    dependencies.readTarget(input.clinicId),
    dependencies.readLiveTenants(),
    dependencies.readQueueCounts(input.clinicId),
    dependencies.readOutboundCounts(input.clinicId),
    dependencies.readAuthorityValidation(input.clinicId),
    dependencies.readRuntimeControl(),
    dependencies.readOtherTenantDigest(input.clinicId),
  ]);
  if (!target || target.clinicId !== input.clinicId) {
    throw new Error("V2-only rollout target was not found by exact tenant id");
  }
  if (target.authorityVersion < 2) {
    throw new Error("V2-only rollout target requires authority V2");
  }
  if (!target.isTest || target.isDemo) {
    throw new Error("V2-only rollout target must remain the reviewed non-demo test tenant");
  }
  if (!target.autoReplyEnabled || target.shadowModeEnabled) {
    throw new Error("V2-only rollout target automation configuration is not live-ready");
  }
  if (!authority.clean) {
    throw new Error("V2-only rollout authority validation has blocking metrics");
  }
  if (
    (queues.pending ?? 0) > 0
    || (queues.processing ?? 0) > 0
    || (queues.failed ?? 0) > 0
    || (queues.locked ?? 0) > 0
  ) throw new Error("V2-only rollout has active jobs");
  if (
    (outbounds.pending ?? 0) > 0
    || (outbounds.processing ?? 0) > 0
    || (outbounds.failed ?? 0) > 0
  ) throw new Error("V2-only rollout has active outbounds");
  const orderedLiveTenants = [...liveTenants].sort((a, b) =>
    a.clinicId.localeCompare(b.clinicId));
  const actualLiveTenantIds = orderedLiveTenants.map((tenant) => tenant.clinicId);
  if (JSON.stringify(actualLiveTenantIds) !== JSON.stringify(expectedLiveTenantIds)) {
    throw new Error("V2-only rollout live tenant set differs from the reviewed set");
  }

  const targetState = {
    operationalStatus: target.operationalStatus,
    isTest: target.isTest,
    isDemo: target.isDemo,
    autoReplyEnabled: target.autoReplyEnabled,
    liveAutomationEnabled: target.liveAutomationEnabled,
    shadowModeEnabled: target.shadowModeEnabled,
    authorityVersion: target.authorityVersion,
  };
  return Object.freeze({
    clinicId: input.clinicId,
    deploymentSha: dependencies.deploymentSha(),
    target: Object.freeze(targetState),
    liveTenants: Object.freeze(orderedLiveTenants),
    queues: Object.freeze({ ...queues }),
    outbounds: Object.freeze({ ...outbounds }),
    runtimeControl: Object.freeze({ ...runtimeControl }),
    authority: Object.freeze({
      clean: authority.clean,
      metrics: authority.metrics,
    }),
    otherTenantDigest,
  });
}

export async function runV2OnlyRolloutAuditCommand(
  input: Parameters<typeof auditV2OnlyRollout>[0],
  dependencies: V2OnlyRolloutAuditDependencies,
  write: (line: string) => void,
): Promise<V2OnlyRolloutAuditResult | null> {
  try {
    const result = await auditV2OnlyRollout(input, dependencies);
    write(JSON.stringify(result));
    return result;
  } catch {
    write(JSON.stringify({ stage: "audit", reasonCodes: ["command_failed"] }));
    return null;
  }
}

export async function readV2OnlyRolloutRuntimeControl(
  read: () => Promise<ConversationRuntimeControl> = () => runtimeControlStore.getGlobal(),
): Promise<ConversationRuntimeControl> {
  try {
    return await read();
  } catch (error) {
    if (readDatabaseErrorCode(error) === "42P01") {
      return { liveOutboundEnabled: false, version: 0 };
    }
    throw error;
  }
}

export function readDatabaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

export async function readV2OnlyRolloutTarget(
  clinicId: string,
): Promise<V2OnlyRolloutTarget | null> {
  const result = await db.execute<{
    clinic_id: string;
    operational_status: RolloutOperationalStatus;
    is_test: boolean;
    is_demo: boolean;
    auto_reply_enabled: boolean;
    live_automation_enabled: boolean;
    shadow_mode_enabled: boolean;
    authority_version: number;
  }>(sql`
    select
      organization.id::text as clinic_id,
      organization.operational_status,
      organization.is_test,
      organization.is_demo,
      organization.auto_reply_enabled,
      coalesce(
        (to_jsonb(organization)->>'live_automation_enabled')::boolean,
        false
      ) as live_automation_enabled,
      organization.shadow_mode_enabled,
      coalesce(authority.version, 0)::integer as authority_version
    from organizations organization
    left join conversation_authority authority
      on authority.organization_id = organization.id
    where organization.id = ${clinicId}::uuid
    limit 2
  `);
  const row = result.rows.length === 1 ? result.rows[0] : null;
  return row ? {
    clinicId: row.clinic_id,
    operationalStatus: row.operational_status,
    isTest: row.is_test,
    isDemo: row.is_demo,
    autoReplyEnabled: row.auto_reply_enabled,
    liveAutomationEnabled: row.live_automation_enabled,
    shadowModeEnabled: row.shadow_mode_enabled,
    authorityVersion: Number(row.authority_version),
  } : null;
}

export async function readOtherTenantRolloutDigest(clinicId: string): Promise<string> {
  const result = await db.execute<{
    organization: Record<string, unknown>;
    authority: Record<string, unknown> | null;
  }>(sql`
    select
      to_jsonb(organization) || jsonb_build_object(
        'live_automation_enabled',
        coalesce(
          (to_jsonb(organization)->>'live_automation_enabled')::boolean,
          false
        )
      ) as organization,
      to_jsonb(authority) as authority
    from organizations organization
    left join conversation_authority authority
      on authority.organization_id = organization.id
    where organization.id <> ${clinicId}::uuid
    order by organization.id
  `);
  return `sha256:${createHash("sha256").update(JSON.stringify(result.rows)).digest("hex")}`;
}

export async function readV2OnlyLiveTenants(): Promise<readonly V2OnlyLiveTenant[]> {
  const result = await db.execute<{
    clinic_id: string;
    operational_status: "active";
    authority_version: number;
  }>(sql`
    select
      organization.id::text as clinic_id,
      organization.operational_status,
      coalesce(authority.version, 0)::integer as authority_version
    from organizations organization
    left join conversation_authority authority
      on authority.organization_id = organization.id
    where organization.operational_status = 'active'
    order by organization.id
  `);
  return result.rows.map((row) => ({
    clinicId: row.clinic_id,
    operationalStatus: row.operational_status,
    authorityVersion: Number(row.authority_version),
  }));
}

export async function readV2OnlyRolloutQueueCounts(clinicId: string): Promise<CountMap> {
  const result = await db.execute<{
    pending: string;
    processing: string;
    failed: string;
    locked: string;
  }>(sql`
    select
      count(*) filter (where job.status = 'pending')::text as pending,
      count(*) filter (where job.status = 'processing')::text as processing,
      count(*) filter (where job.status = 'failed')::text as failed,
      count(*) filter (where job.locked_at is not null)::text as locked
    from ${jobs} job
    where exists (
      select 1
      from ${inboundEvents} event
      where event.id = job.inbound_event_id
        and event.organization_id = ${clinicId}::uuid
    ) or exists (
      select 1
      from ${outboundMessages} outbound
      where outbound.id::text = job.payload->>'outboundMessageId'
        and outbound.organization_id = ${clinicId}::uuid
    ) or job.payload->>'clinicId' = ${clinicId}
  `);
  const row = result.rows[0];
  return {
    pending: Number(row?.pending ?? 0),
    processing: Number(row?.processing ?? 0),
    failed: Number(row?.failed ?? 0),
    locked: Number(row?.locked ?? 0),
  };
}

export async function readV2OnlyRolloutOutboundCounts(clinicId: string): Promise<CountMap> {
  const result = await db.execute<{
    pending: string;
    processing: string;
    failed: string;
  }>(sql`
    select
      count(*) filter (where status = 'pending')::text as pending,
      count(*) filter (where status = 'processing')::text as processing,
      count(*) filter (where status = 'failed')::text as failed
    from ${outboundMessages}
    where organization_id = ${clinicId}::uuid
  `);
  const row = result.rows[0];
  return {
    pending: Number(row?.pending ?? 0),
    processing: Number(row?.processing ?? 0),
    failed: Number(row?.failed ?? 0),
  };
}

const runtimeControlStore = new DrizzleConversationRuntimeControlStore();
const defaultAuditDependencies: V2OnlyRolloutAuditDependencies = {
  readTarget: readV2OnlyRolloutTarget,
  readLiveTenants: readV2OnlyLiveTenants,
  readQueueCounts: readV2OnlyRolloutQueueCounts,
  readOutboundCounts: readV2OnlyRolloutOutboundCounts,
  readAuthorityValidation: validateWhatsAppStreamAuthority,
  readRuntimeControl: readV2OnlyRolloutRuntimeControl,
  readOtherTenantDigest: readOtherTenantRolloutDigest,
  deploymentSha: () => process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
};

function requiredValue(flag: string, argv: readonly string[]): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const clinicId = requiredValue("--clinic-id", argv);
  const expectNoLiveTenants = argv.includes("--expect-no-live-tenants");
  const explicitlyExpected = argv.flatMap((value, index) =>
    value === "--expected-live-tenant" && argv[index + 1]
      ? [argv[index + 1]!]
      : []);
  if (expectNoLiveTenants && explicitlyExpected.length > 0) {
    throw new Error("choose expected live tenants or --expect-no-live-tenants, not both");
  }
  const result = await runV2OnlyRolloutAuditCommand({
    clinicId,
    expectedLiveTenantIds: expectNoLiveTenants
      ? []
      : explicitlyExpected.length > 0
        ? explicitlyExpected
        : [clinicId],
  }, defaultAuditDependencies, (line) => process.stdout.write(`${line}\n`));
  if (!result) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(`${JSON.stringify({ stage: "audit", reasonCodes: ["command_failed"] })}\n`);
    process.exitCode = 1;
  });
}
