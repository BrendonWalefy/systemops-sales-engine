import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";

import type {
  ConversationRuntimeControl,
  ConversationRuntimeControlStore,
} from "@/application/ports/conversation-runtime-control-store";
import {
  neonHttpAtomicDatabaseBatch,
  type AtomicDatabaseBatch,
} from "@/infrastructure/db/atomic-database-batch";
import { db } from "@/infrastructure/db/client";
import {
  conversationAuthority,
  conversationRuntimeControl,
  inboundEvents,
  jobs,
  organizations,
  outboundMessages,
  whatsappStreamAliases,
  whatsappStreams,
} from "@/infrastructure/db/schema";
import { DrizzleConversationRuntimeControlStore } from "@/infrastructure/repositories/drizzle-conversation-runtime-control-store";
import {
  AUTHORITY_BLOCKING_VALIDATION_METRICS,
  assertUuid,
  buildWhatsAppStreamAuthorityValidationStatement,
  validateWhatsAppStreamAuthority,
} from "./validate-whatsapp-stream-authority";
import {
  readOtherTenantRolloutDigest,
  readDatabaseErrorCode,
  readV2OnlyRolloutRuntimeControl,
  readV2OnlyRolloutTarget,
  readV2OnlyLiveTenants,
  readV2OnlyRolloutOutboundCounts,
  readV2OnlyRolloutQueueCounts,
  type V2OnlyRolloutTarget,
} from "./audit-v2-only-rollout";

export const SYSTEMOPS_LAB_V2_ROLLOUT_CLINIC_ID =
  "92fe7ecf-f383-4ddc-8c4e-53271af8e3a0";

type TenantStatusAction = Readonly<{
  kind: "tenant_status";
  expectedStatus: "test" | "active" | "paused";
  nextStatus: "active" | "paused";
}>;

type GlobalControlAction = Readonly<{
  kind: "global_control";
  expectedVersion: number;
  liveOutboundEnabled: boolean;
}>;

export type V2OnlyRolloutControlInput = Readonly<{
  clinicId: string;
  actor: string;
  apply?: boolean;
  action: TenantStatusAction | GlobalControlAction;
}>;

export type V2OnlyRolloutControlDependencies = Readonly<{
  readTarget(clinicId: string): Promise<V2OnlyRolloutTarget | null>;
  readRuntimeControl(): Promise<ConversationRuntimeControl>;
  readOtherTenantDigest(clinicId: string): Promise<string>;
  readActivationGate(clinicId: string): Promise<Readonly<{
    authorityClean: boolean;
    activeJobs: number;
    activeOutbounds: number;
    liveTenantIds: readonly string[];
  }>>;
  compareAndSetTenantStatus(input: Readonly<{
    clinicId: string;
    expectedStatus: "test" | "active" | "paused";
    nextStatus: "active" | "paused";
    actor: string;
    now: Date;
  }>): Promise<boolean>;
  compareAndSetGlobal(input: Readonly<{
    clinicId: string;
    expectedVersion: number;
    liveOutboundEnabled: boolean;
    actor: string;
    now: Date;
  }>): Promise<boolean>;
}>;

export type V2OnlyRolloutControlResult = Readonly<{
  mode: "dry-run" | "apply";
  actor: string;
  applied: boolean;
  affectedRows: 0 | 1;
  action: V2OnlyRolloutControlInput["action"];
  target: Omit<V2OnlyRolloutTarget, "clinicId">;
  runtimeControl: ConversationRuntimeControl;
  otherTenantChanges: 0;
}>;

export async function controlV2OnlyRollout(
  input: V2OnlyRolloutControlInput,
  dependencies: V2OnlyRolloutControlDependencies = defaultControlDependencies,
): Promise<V2OnlyRolloutControlResult> {
  assertUuid(input.clinicId, "clinic id");
  if (input.clinicId !== SYSTEMOPS_LAB_V2_ROLLOUT_CLINIC_ID) {
    throw new Error("the first V2-only rollout control is restricted to SystemOps Lab");
  }
  if (!input.actor.trim()) throw new Error("rollout actor is required");
  if (
    input.action.kind === "tenant_status"
    && input.action.expectedStatus === input.action.nextStatus
  ) throw new Error("tenant status transition must change status");
  if (
    input.action.kind === "tenant_status"
    && !(
      input.action.nextStatus === "paused"
        ? input.action.expectedStatus === "test" || input.action.expectedStatus === "active"
        : input.action.expectedStatus === "paused"
    )
  ) throw new Error("tenant status transition is not part of the reviewed rollout");
  if (
    input.action.kind === "global_control"
    && (!Number.isSafeInteger(input.action.expectedVersion) || input.action.expectedVersion < 0)
  ) throw new Error("expected control version must be a non-negative integer");

  const [targetBefore, controlBefore, otherTenantDigestBefore, activationGate] = await Promise.all([
    dependencies.readTarget(input.clinicId),
    dependencies.readRuntimeControl(),
    dependencies.readOtherTenantDigest(input.clinicId),
    dependencies.readActivationGate(input.clinicId),
  ]);
  if (!targetBefore || targetBefore.clinicId !== input.clinicId) {
    throw new Error("SystemOps Lab target was not found by exact tenant id");
  }
  assertActionPreconditions(input.action, targetBefore, controlBefore, activationGate);

  if (input.apply !== true) {
    return buildResult({
      input,
      applied: false,
      target: targetBefore,
      runtimeControl: controlBefore,
    });
  }

  const now = new Date();
  const applied = input.action.kind === "tenant_status"
    ? await dependencies.compareAndSetTenantStatus({
        clinicId: input.clinicId,
        expectedStatus: input.action.expectedStatus,
        nextStatus: input.action.nextStatus,
        actor: input.actor.trim(),
        now,
      })
    : await dependencies.compareAndSetGlobal({
        clinicId: input.clinicId,
        expectedVersion: input.action.expectedVersion,
        liveOutboundEnabled: input.action.liveOutboundEnabled,
        actor: input.actor.trim(),
        now,
      });
  if (!applied) throw new Error("V2-only rollout compare-and-set failed");

  const [targetAfter, controlAfter, otherTenantDigestAfter] = await Promise.all([
    dependencies.readTarget(input.clinicId),
    dependencies.readRuntimeControl(),
    dependencies.readOtherTenantDigest(input.clinicId),
  ]);
  if (!targetAfter || targetAfter.clinicId !== input.clinicId) {
    throw new Error("SystemOps Lab target disappeared after compare-and-set");
  }
  if (otherTenantDigestAfter !== otherTenantDigestBefore) {
    throw new Error("cross-tenant state changed during V2-only rollout control");
  }
  assertActionApplied(input.action, targetAfter, controlAfter);
  return buildResult({
    input,
    applied: true,
    target: targetAfter,
    runtimeControl: controlAfter,
  });
}

export async function runV2OnlyRolloutControlCommand(
  input: V2OnlyRolloutControlInput,
  dependencies: V2OnlyRolloutControlDependencies,
  write: (line: string) => void,
): Promise<V2OnlyRolloutControlResult | null> {
  try {
    const result = await controlV2OnlyRollout(input, dependencies);
    write(JSON.stringify(result));
    return result;
  } catch {
    write(JSON.stringify({ stage: "control", reasonCodes: ["command_failed"] }));
    return null;
  }
}

function assertActionPreconditions(
  action: V2OnlyRolloutControlInput["action"],
  target: V2OnlyRolloutTarget,
  control: ConversationRuntimeControl,
  gate: Readonly<{
    authorityClean: boolean;
    activeJobs: number;
    activeOutbounds: number;
    liveTenantIds: readonly string[];
  }>,
): void {
  if (action.kind === "tenant_status") {
    if (target.operationalStatus !== action.expectedStatus) {
      throw new Error("SystemOps Lab does not match the expected status");
    }
    if (action.nextStatus === "active") {
      if (target.authorityVersion < 2) throw new Error("SystemOps Lab requires authority V2");
      if (!target.isTest) throw new Error("SystemOps Lab activation requires a test tenant");
      if (target.isDemo) throw new Error("SystemOps Lab demo tenant cannot be activated");
      if (target.liveAutomationEnabled) {
        throw new Error("SystemOps Lab live permit must be closed before activation");
      }
      if (!target.autoReplyEnabled || target.shadowModeEnabled) {
        throw new Error("SystemOps Lab automation configuration is not live-ready");
      }
      if (!control.liveOutboundEnabled) {
        throw new Error("global live outbound control must be open before tenant activation");
      }
      assertClosedActivationGate(gate);
    }
    return;
  }
  if (control.version !== action.expectedVersion) {
    throw new Error("global control version does not match expected control version");
  }
  if (action.liveOutboundEnabled) {
    if (target.operationalStatus !== "paused") {
      throw new Error("SystemOps Lab must be paused before opening global live outbound");
    }
    if (target.authorityVersion < 2) throw new Error("SystemOps Lab requires authority V2");
    if (!target.isTest || target.isDemo) {
      throw new Error("global live outbound activation requires the reviewed test tenant");
    }
    if (target.liveAutomationEnabled) {
      throw new Error("SystemOps Lab live permit must remain closed while opening global control");
    }
    assertClosedActivationGate(gate);
  }
}

function assertClosedActivationGate(gate: Readonly<{
  authorityClean: boolean;
  activeJobs: number;
  activeOutbounds: number;
  liveTenantIds: readonly string[];
}>): void {
  if (!gate.authorityClean) throw new Error("authority validation is not clean");
  if (gate.activeJobs > 0) throw new Error("V2-only rollout has active jobs");
  if (gate.activeOutbounds > 0) throw new Error("V2-only rollout has active outbounds");
  if (gate.liveTenantIds.length > 0) {
    throw new Error("V2-only rollout live tenant set must be empty while opening");
  }
}

function assertActionApplied(
  action: V2OnlyRolloutControlInput["action"],
  target: V2OnlyRolloutTarget,
  control: ConversationRuntimeControl,
): void {
  if (action.kind === "tenant_status") {
    if (
      target.operationalStatus !== action.nextStatus
      || target.liveAutomationEnabled !== (action.nextStatus === "active")
    ) {
      throw new Error("tenant status compare-and-set did not persist the requested state");
    }
    return;
  }
  if (
    control.version !== action.expectedVersion + 1
    || control.liveOutboundEnabled !== action.liveOutboundEnabled
  ) throw new Error("global control compare-and-set did not persist the requested state");
}

function buildResult(input: Readonly<{
  input: V2OnlyRolloutControlInput;
  applied: boolean;
  target: V2OnlyRolloutTarget;
  runtimeControl: ConversationRuntimeControl;
}>): V2OnlyRolloutControlResult {
  const target = {
    operationalStatus: input.target.operationalStatus,
    isTest: input.target.isTest,
    isDemo: input.target.isDemo,
    autoReplyEnabled: input.target.autoReplyEnabled,
    liveAutomationEnabled: input.target.liveAutomationEnabled,
    shadowModeEnabled: input.target.shadowModeEnabled,
    authorityVersion: input.target.authorityVersion,
  };
  return Object.freeze({
    mode: input.input.apply === true ? "apply" : "dry-run",
    actor: input.input.actor.trim(),
    applied: input.applied,
    affectedRows: input.applied ? 1 : 0,
    action: input.input.action,
    target: Object.freeze(target),
    runtimeControl: Object.freeze({ ...input.runtimeControl }),
    otherTenantChanges: 0,
  });
}

const runtimeControlStore: ConversationRuntimeControlStore =
  new DrizzleConversationRuntimeControlStore();

async function readActivationGate(clinicId: string): Promise<Readonly<{
  authorityClean: boolean;
  activeJobs: number;
  activeOutbounds: number;
  liveTenantIds: readonly string[];
}>> {
  const [authority, queueCounts, outboundCounts, liveTenants] = await Promise.all([
    validateWhatsAppStreamAuthority(clinicId),
    readV2OnlyRolloutQueueCounts(clinicId),
    readV2OnlyRolloutOutboundCounts(clinicId),
    readV2OnlyLiveTenants(),
  ]);
  return Object.freeze({
    authorityClean: authority.clean,
    activeJobs: (queueCounts.pending ?? 0)
      + (queueCounts.processing ?? 0)
      + (queueCounts.failed ?? 0)
      + (queueCounts.locked ?? 0),
    activeOutbounds: (outboundCounts.pending ?? 0)
      + (outboundCounts.processing ?? 0)
      + (outboundCounts.failed ?? 0),
    liveTenantIds: Object.freeze(liveTenants.map((tenant) => tenant.clinicId)),
  });
}

export async function compareAndSetTenantStatus(input: Readonly<{
  clinicId: string;
  expectedStatus: "test" | "active" | "paused";
  nextStatus: "active" | "paused";
  now: Date;
}>, batch: AtomicDatabaseBatch = neonHttpAtomicDatabaseBatch): Promise<boolean> {
  if (input.nextStatus !== "active") {
    try {
      const updated = await db.update(organizations)
        .set({
          operationalStatus: input.nextStatus,
          liveAutomationEnabled: false,
          updatedAt: input.now,
        })
        .where(and(
          eq(organizations.id, input.clinicId),
          eq(organizations.operationalStatus, input.expectedStatus),
        ))
        .returning({ id: organizations.id });
      return updated.length === 1;
    } catch (error) {
      if (readDatabaseErrorCode(error) !== "42703") throw error;
      const preExpand = await db.execute<{ id: string }>(sql`
        update ${organizations}
        set operational_status = ${input.nextStatus},
            updated_at = ${input.now}
        where id = ${input.clinicId}::uuid
          and operational_status = ${input.expectedStatus}
        returning id
      `);
      return preExpand.rows.length === 1;
    }
  }
  const readinessFence = input.nextStatus === "active"
    ? sql`and ${openingFence(input.clinicId)}
        and exists (
          select 1 from ${conversationRuntimeControl} control
          where control.key = 'global'
            and control.live_outbound_enabled = true
        )`
    : sql``;
  const results = await batch.execute([
    { name: "lock_rollout_authority", statement: rolloutWriteLockStatement() },
    {
      name: "activate_exact_tenant",
      statement: sql`
        update ${organizations}
        set operational_status = ${input.nextStatus},
            live_automation_enabled = true,
            updated_at = ${input.now}
        where id = ${input.clinicId}::uuid
          and operational_status = ${input.expectedStatus}
          and true ${readinessFence}
        returning id
      `,
    },
  ]);
  return results[1]?.rows.length === 1;
}

export async function compareAndSetGlobal(input: Readonly<{
  clinicId: string;
  expectedVersion: number;
  liveOutboundEnabled: boolean;
  actor: string;
  now: Date;
}>, batch: AtomicDatabaseBatch = neonHttpAtomicDatabaseBatch): Promise<boolean> {
  if (!input.liveOutboundEnabled) {
    return runtimeControlStore.compareAndSetGlobal(input);
  }
  if (input.expectedVersion === 0) {
    const results = await batch.execute([
      { name: "lock_rollout_authority", statement: rolloutWriteLockStatement() },
      {
        name: "open_global_control",
        statement: sql`
          insert into ${conversationRuntimeControl} (
            key, live_outbound_enabled, version, updated_at, updated_by
          )
          select 'global', true, 1, ${input.now}, ${input.actor}
          where ${openingFence(input.clinicId)}
          on conflict do nothing
          returning key
        `,
      },
    ]);
    return results[1]?.rows.length === 1;
  }
  const results = await batch.execute([
    { name: "lock_rollout_authority", statement: rolloutWriteLockStatement() },
    {
      name: "open_global_control",
      statement: sql`
        update ${conversationRuntimeControl} control
           set live_outbound_enabled = true,
               version = ${input.expectedVersion + 1},
               updated_at = ${input.now},
               updated_by = ${input.actor}
         where control.key = 'global'
           and control.version = ${input.expectedVersion}
           and ${openingFence(input.clinicId)}
        returning control.key
      `,
    },
  ]);
  return results[1]?.rows.length === 1;
}

function rolloutWriteLockStatement() {
  return sql`
    lock table
      ${organizations},
      ${conversationAuthority},
      ${conversationRuntimeControl},
      ${inboundEvents},
      ${jobs},
      ${outboundMessages},
      ${whatsappStreams},
      ${whatsappStreamAliases}
    in share mode
  `;
}

function openingFence(clinicId: string) {
  const blockingMetrics = sql.join(
    AUTHORITY_BLOCKING_VALIDATION_METRICS.map((metric) => sql`${metric}`),
    sql`, `,
  );
  return sql`
    exists (
      select 1
      from ${organizations} target
      join ${conversationAuthority} authority
        on authority.organization_id = target.id
       and authority.version >= 2
      where target.id = ${clinicId}::uuid
        and target.operational_status = 'paused'
        and target.is_test = true
        and target.is_demo = false
        and target.auto_reply_enabled = true
        and target.live_automation_enabled = false
        and target.shadow_mode_enabled = false
    )
    and not exists (
      select 1
      from ${organizations} live
      join ${conversationAuthority} live_authority
        on live_authority.organization_id = live.id
       and live_authority.version >= 2
      where live.operational_status = 'active'
        and live.live_automation_enabled = true
        and live.auto_reply_enabled = true
        and live.shadow_mode_enabled = false
        and live.is_demo = false
    )
    and not exists (
      select 1
      from ${jobs} job
      where (
        job.status in ('pending', 'processing', 'failed')
        or job.locked_at is not null
      ) and (
        exists (
          select 1 from ${inboundEvents} event
          where event.id = job.inbound_event_id
            and event.organization_id = ${clinicId}::uuid
        ) or exists (
          select 1 from ${outboundMessages} outbound
          where outbound.id::text = job.payload->>'outboundMessageId'
            and outbound.organization_id = ${clinicId}::uuid
        ) or job.payload->>'clinicId' = ${clinicId}
      )
    )
    and not exists (
      select 1 from ${outboundMessages} outbound
      where outbound.organization_id = ${clinicId}::uuid
        and outbound.status in ('pending', 'processing', 'failed')
    )
    and not exists (
      select 1
      from (${buildWhatsAppStreamAuthorityValidationStatement(clinicId)}) validation
      where validation.metric in (${blockingMetrics})
        and validation.count::bigint <> 0
    )
  `;
}

const defaultControlDependencies: V2OnlyRolloutControlDependencies = {
  readTarget: readV2OnlyRolloutTarget,
  readRuntimeControl: readV2OnlyRolloutRuntimeControl,
  readOtherTenantDigest: readOtherTenantRolloutDigest,
  readActivationGate,
  compareAndSetTenantStatus,
  compareAndSetGlobal,
};

function requiredValue(flag: string, argv: readonly string[]): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function parseExpectedStatus(value: string): "test" | "active" | "paused" {
  if (value !== "test" && value !== "active" && value !== "paused") {
    throw new Error("expected rollout status must be test, active or paused");
  }
  return value;
}

function parseNextStatus(value: string): "active" | "paused" {
  if (value !== "active" && value !== "paused") {
    throw new Error("next rollout status must be active or paused");
  }
  return value;
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("--live-outbound-enabled must be true or false");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const clinicId = requiredValue("--clinic-id", argv);
  const actor = requiredValue("--actor", argv);
  const actionName = requiredValue("--action", argv);
  const action: TenantStatusAction | GlobalControlAction = actionName === "tenant-status"
    ? {
        kind: "tenant_status",
        expectedStatus: parseExpectedStatus(requiredValue("--expected-status", argv)),
        nextStatus: parseNextStatus(requiredValue("--next-status", argv)),
      }
    : actionName === "global-control"
      ? {
          kind: "global_control",
          expectedVersion: Number(requiredValue("--expected-control-version", argv)),
          liveOutboundEnabled: parseBoolean(requiredValue("--live-outbound-enabled", argv)),
        }
      : (() => { throw new Error("--action must be tenant-status or global-control"); })();
  const result = await runV2OnlyRolloutControlCommand({
    clinicId,
    actor,
    action,
    apply: argv.includes("--apply"),
  }, defaultControlDependencies, (line) => process.stdout.write(`${line}\n`));
  if (!result) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(`${JSON.stringify({ stage: "control", reasonCodes: ["command_failed"] })}\n`);
    process.exitCode = 1;
  });
}
