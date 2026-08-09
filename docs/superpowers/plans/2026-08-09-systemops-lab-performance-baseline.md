# SystemOps Lab Safety and Performance Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed, auditable transfer/readiness path for the SystemOps Lab Z-API instance and collect a privacy-safe performance baseline for the current application before any UX or realtime rewrite.

**Architecture:** A pure application policy validates every Lab invariant before an atomic Drizzle repository reassigns the channel. The command is dry-run by default, accepts only rotated credentials through environment variables, and never sends a WhatsApp message. Performance telemetry uses bounded, sanitized structured logs through the existing logger; server reads and client soft navigations share a versioned contract, and an offline summarizer produces p50/p75/p95 without adding a database table or analytics dependency.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.8, Drizzle ORM 0.45 with Neon HTTP, Vitest 3, Zod 3, existing structured logger/Sentry scrubbing.

## Global Constraints

- `main` is production and `develop` is integration; implementation starts from updated `develop` in an isolated worktree and targets `develop` by PR.
- Never operate, message, configure, or activate Ximendes; the only allowed change is detaching the obsolete Z-API routing metadata during an explicitly confirmed Lab transfer.
- Never use or print the credential exposed in the screenshot. An apply run requires a rotated token supplied as `SYSTEMOPS_LAB_ZAPI_TOKEN`.
- The target must remain `isTest=true`, `operationalStatus="test"`, `autoReplyEnabled=false`, `shadowModeEnabled=false`, and `isDemo=false` throughout this plan.
- This plan sends no WhatsApp message and does not activate Lab automation.
- No schema change or migration is needed in this plan.
- Performance telemetry never records message body, name, phone, e-mail, photo, URL query, price, payment, treatment, appointment content, raw pathname IDs, cookies, headers, or credentials.
- `PERFORMANCE_TELEMETRY_ENABLED` defaults to off. The Lab/preview baseline explicitly enables it; production remains off until a separate rollout approval.
- This plan measures current behavior; it does not add Ably, WebSocket, read models, pagination, optimistic mutations, or orchestration changes.
- Every behavior change is test-first. Run `npm run verify` before push or PR.

---

## File Map

### Lab safety

- Create `src/application/labs/systemops-lab-channel-transfer.ts`: pure invariants, application port, transfer orchestration, and postcondition.
- Create `src/infrastructure/repositories/drizzle-systemops-lab-channel-transfer-repository.ts`: reads the transfer context and performs the guarded single-statement reassignment.
- Create `scripts/transfer-systemops-lab-channel.ts`: dry-run/apply command driven only by explicit environment variables.
- Create `src/application/labs/systemops-lab-readiness.ts`: pure readiness report for controlled inbound.
- Create `scripts/verify-systemops-lab.ts`: read-only local/remote status report with no secret output.
- Create `docs/operations/systemops-lab-runbook.md`: rotation, dry-run, apply, verification, rollback, and stop conditions.
- Test in `src/__tests__/SystemOpsLabChannelTransfer.test.ts`, `src/__tests__/SystemOpsLabTransferCommand.test.ts`, and `src/__tests__/SystemOpsLabReadiness.test.ts`.

### Performance baseline

- Create `src/application/observability/performance-telemetry.ts`: schemas, route normalization, event types, and client cap constants.
- Create `src/infrastructure/observability/performance-logger.ts`: sampling/config and timed server operation helper.
- Create `src/components/performance/navigation-performance-reporter.tsx`: bounded client reporting for soft navigation.
- Create `src/app/api/telemetry/performance/route.ts`: authenticated, size-bounded log ingestion.
- Modify `src/components/sidebar-nav.tsx`: record start of main navigation without changing navigation behavior.
- Modify `src/app/(clinic)/app/inbox/InboxClient.tsx`: record navigation start on each conversation-card link.
- Modify `src/app/(clinic)/layout.tsx`: mount the client completion reporter and time shell context load.
- Modify `src/app/(clinic)/app/inbox/page.tsx`: time base list, enrichment, and total data preparation.
- Modify `src/app/(clinic)/app/inbox/[conversationId]/page.tsx`: time conversation data preparation.
- Modify `src/app/(clinic)/app/agenda/page.tsx`: time agenda bootstrap data.
- Modify `src/app/(clinic)/app/dashboard/page.tsx`: time dashboard data preparation.
- Create `src/application/observability/performance-summary.ts`: percentile aggregation of sanitized JSONL samples.
- Create `scripts/summarize-performance-logs.ts`: offline JSONL report generator.
- Modify `package.json`: add `performance:summary` command.
- Create `docs/operations/performance-baseline.md`: collection protocol and acceptance table.
- Test in `src/__tests__/PerformanceTelemetry.test.ts`, `src/__tests__/PerformanceLogger.test.ts`, `src/__tests__/PerformanceTelemetryRoute.test.ts`, `src/__tests__/NavigationPerformance.test.ts`, and `src/__tests__/PerformanceSummary.test.ts`.

---

### Task 1: Fail-Closed Lab Transfer Policy

**Files:**
- Create: `src/application/labs/systemops-lab-channel-transfer.ts`
- Test: `src/__tests__/SystemOpsLabChannelTransfer.test.ts`

**Interfaces:**
- Consumes: no infrastructure; all state enters through `SystemOpsLabChannelTransferRepository`.
- Produces: `SYSTEMOPS_LAB_TRANSFER_CONFIRMATION`, `SystemOpsLabTransferContext`, `SystemOpsLabChannelTransferRepository`, `validateSystemOpsLabTransfer()`, and `transferSystemOpsLabChannel()` for Tasks 2 and 3.

- [ ] **Step 1: Write the failing policy tests**

Create table-driven tests for every invariant and one successful transfer:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
  transferSystemOpsLabChannel,
  validateSystemOpsLabTransfer,
  type SystemOpsLabTransferContext,
  type SystemOpsLabChannelTransferRepository,
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

describe("SystemOps Lab channel transfer policy", () => {
  it.each([
    ["target must be test", { target: { ...safeContext.target, isTest: false } }],
    ["target status must be test", { target: { ...safeContext.target, operationalStatus: "active" as const } }],
    ["automation must be disabled", { target: { ...safeContext.target, autoReplyEnabled: true } }],
    ["shadow must be disabled", { target: { ...safeContext.target, shadowModeEnabled: true } }],
    ["demo is not a lab", { target: { ...safeContext.target, isDemo: true } }],
  ])("rejects when %s", (_label, patch) => {
    expect(() => validateSystemOpsLabTransfer({
      context: { ...safeContext, ...patch },
      targetClinicId: "lab-id",
      instanceId: "instance-1",
      rotatedToken: "new-token",
      clientToken: null,
      expectedSourceClinicId: "old-id",
      confirmation: SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
    })).toThrow();
  });

  it("rejects the current token instead of accepting an unrotated credential", () => {
    expect(() => validateSystemOpsLabTransfer({
      context: safeContext,
      targetClinicId: "lab-id",
      instanceId: "instance-1",
      rotatedToken: "old-token",
      clientToken: null,
      expectedSourceClinicId: "old-id",
      confirmation: SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
    })).toThrow("rotated");
  });

  it("transfers once and verifies tenant resolution", async () => {
    const repository: SystemOpsLabChannelTransferRepository = {
      readContext: vi.fn().mockResolvedValue(safeContext),
      transfer: vi.fn().mockResolvedValue(undefined),
      resolveClinicIdByInstance: vi.fn().mockResolvedValue("lab-id"),
    };
    const result = await transferSystemOpsLabChannel({
      targetClinicId: "lab-id",
      instanceId: "instance-1",
      rotatedToken: "new-token",
      clientToken: "client-token",
      expectedSourceClinicId: "old-id",
      confirmation: SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
    }, repository);
    expect(result).toEqual({ targetClinicId: "lab-id", instanceId: "instance-1", detachedClinicId: "old-id" });
    expect(repository.transfer).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run:

```bash
npm test -- src/__tests__/SystemOpsLabChannelTransfer.test.ts
```

Expected: FAIL because `@/application/labs/systemops-lab-channel-transfer` does not exist.

- [ ] **Step 3: Implement the pure contract and orchestration**

Export these exact shapes and keep error messages free of secret values:

```ts
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
} & SystemOpsLabTransferInput): void;

export async function transferSystemOpsLabChannel(
  input: SystemOpsLabTransferInput,
  repository: SystemOpsLabChannelTransferRepository,
): Promise<{ targetClinicId: string; instanceId: string; detachedClinicId: string | null }>;
```

Validation must reject: missing/blank IDs or token; wrong confirmation; missing target; target ID mismatch; non-test/demo target; status other than `test`; auto reply or shadow enabled; target already bound to a different instance; existing source without the exact expected source ID; expected source supplied when the actual source differs; and a rotated token equal to the decrypted current token. After `repository.transfer`, require `resolveClinicIdByInstance(instanceId) === targetClinicId`; otherwise throw `Lab transfer postcondition failed`.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm test -- src/__tests__/SystemOpsLabChannelTransfer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the application policy**

```bash
git add src/application/labs/systemops-lab-channel-transfer.ts src/__tests__/SystemOpsLabChannelTransfer.test.ts
git commit -m "feat(lab): guard SystemOps channel transfer"
```

---

### Task 2: Atomic Repository and Dry-Run Transfer Command

**Files:**
- Create: `src/infrastructure/repositories/drizzle-systemops-lab-channel-transfer-repository.ts`
- Create: `scripts/transfer-systemops-lab-channel.ts`
- Test: `src/__tests__/SystemOpsLabTransferCommand.test.ts`

**Interfaces:**
- Consumes: all Task 1 types and `encryptCredentialNullable()` / `decryptCredentialNullable()`.
- Produces: `DrizzleSystemOpsLabChannelTransferRepository` and `runSystemOpsLabTransferCommand()`.

- [ ] **Step 1: Write failing tests for dry-run, apply, and secret redaction**

```ts
import { describe, expect, it, vi } from "vitest";
import { runSystemOpsLabTransferCommand } from "../../scripts/transfer-systemops-lab-channel";

const safeEnv = {
  SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
  SYSTEMOPS_LAB_ZAPI_INSTANCE_ID: "instance-1",
  SYSTEMOPS_LAB_EXPECTED_SOURCE_CLINIC_ID: "old-id",
};

describe("SystemOps Lab transfer command", () => {
  it("is dry-run by default and never transfers", async () => {
    const transfer = vi.fn();
    const lines: string[] = [];
    const result = await runSystemOpsLabTransferCommand(safeEnv, {
      inspect: vi.fn().mockResolvedValue({ safe: true, sourceClinicId: "old-id" }),
      transfer,
      write: (line) => lines.push(line),
    });
    expect(result.mode).toBe("dry-run");
    expect(transfer).not.toHaveBeenCalled();
    expect(lines.join("\n")).not.toContain("rotated-token");
  });

  it("requires both apply and the exact confirmation", async () => {
    await expect(runSystemOpsLabTransferCommand({
      ...safeEnv,
      SYSTEMOPS_LAB_ZAPI_TOKEN: "rotated-token",
      SYSTEMOPS_LAB_APPLY: "true",
    }, {
      inspect: vi.fn().mockResolvedValue({ safe: true, sourceClinicId: "old-id" }),
      transfer: vi.fn(),
      write: vi.fn(),
    })).rejects.toThrow("SYSTEMOPS_LAB_TRANSFER_CONFIRMATION");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- src/__tests__/SystemOpsLabTransferCommand.test.ts
```

Expected: FAIL because the script module does not exist.

- [ ] **Step 3: Implement the Drizzle repository**

`readContext()` selects the target and the current instance owner, decrypting the current token only in memory. `transfer()` encrypts the rotated credentials and executes one guarded SQL statement. The target CTE must encode all safety predicates and the source mismatch predicate before any update:

```ts
const result = await db.execute(sql`
  with eligible_target as (
    select id
    from organizations
    where id = ${input.targetClinicId}
      and is_test = true
      and is_demo = false
      and operational_status = 'test'
      and auto_reply_enabled = false
      and shadow_mode_enabled = false
      and (zapi_instance_id is null or zapi_instance_id = ${input.instanceId})
      and not exists (
        select 1 from organizations owner
        where owner.zapi_instance_id = ${input.instanceId}
          and owner.id <> ${input.targetClinicId}
          and (${input.expectedSourceClinicId}::uuid is null or owner.id <> ${input.expectedSourceClinicId}::uuid)
      )
  ), detached as (
    update organizations
    set channel_provider = null,
        zapi_instance_id = null,
        zapi_token = null,
        zapi_client_token = null,
        updated_at = now()
    where zapi_instance_id = ${input.instanceId}
      and id <> ${input.targetClinicId}
      and exists (select 1 from eligible_target)
    returning id
  )
  update organizations
  set channel_provider = 'z_api',
      zapi_instance_id = ${input.instanceId},
      zapi_token = ${encryptedToken},
      zapi_client_token = ${encryptedClientToken},
      channel_paired_at = coalesce(channel_paired_at, now()),
      updated_at = now()
  where id in (select id from eligible_target)
  returning id
`);
```

Normalize `expectedSourceClinicId` before the query. If no row returns, throw `Atomic Lab transfer rejected by database guard`. Never include credentials in exceptions or logs.

- [ ] **Step 4: Implement the dry-run-first command**

Export a testable function and execute it only when the file is the process entrypoint:

```ts
export type SystemOpsLabTransferCommandEnv = Record<string, string | undefined>;

export async function runSystemOpsLabTransferCommand(
  env: SystemOpsLabTransferCommandEnv,
  deps: {
    inspect(input: { targetClinicId: string; instanceId: string; expectedSourceClinicId: string | null }): Promise<{ safe: boolean; sourceClinicId: string | null; reasons?: string[] }>;
    transfer(input: SystemOpsLabTransferInput): Promise<unknown>;
    write(line: string): void;
  },
): Promise<{ mode: "dry-run" | "apply"; applied: boolean }>;
```

Required environment variables:

```text
SYSTEMOPS_LAB_CLINIC_ID
SYSTEMOPS_LAB_ZAPI_INSTANCE_ID
SYSTEMOPS_LAB_ZAPI_TOKEN (required only for apply)
SYSTEMOPS_LAB_EXPECTED_SOURCE_CLINIC_ID (required only when an owner exists)
SYSTEMOPS_LAB_ZAPI_CLIENT_TOKEN (optional)
SYSTEMOPS_LAB_APPLY=true (otherwise dry-run)
SYSTEMOPS_LAB_TRANSFER_CONFIRMATION=TRANSFER_ROTATED_CREDENTIAL_TO_SYSTEMOPS_LAB (apply only)
```

Print IDs, mode, invariant booleans, and reason codes only. Print neither plaintext nor encrypted credentials.

- [ ] **Step 5: Run both focused test files**

```bash
npm test -- src/__tests__/SystemOpsLabChannelTransfer.test.ts src/__tests__/SystemOpsLabTransferCommand.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the repository and command**

```bash
git add src/infrastructure/repositories/drizzle-systemops-lab-channel-transfer-repository.ts scripts/transfer-systemops-lab-channel.ts src/__tests__/SystemOpsLabTransferCommand.test.ts
git commit -m "feat(lab): add atomic channel transfer command"
```

---

### Task 3: Read-Only Lab Readiness and Operational Runbook

**Files:**
- Create: `src/application/labs/systemops-lab-readiness.ts`
- Create: `scripts/verify-systemops-lab.ts`
- Create: `docs/operations/systemops-lab-runbook.md`
- Test: `src/__tests__/SystemOpsLabReadiness.test.ts`

**Interfaces:**
- Consumes: organization snapshot, `resolveClinicByZapiInstance()`, `resolveChannelConfig()`, and optional `getZApiInstanceStatus()`.
- Produces: `evaluateSystemOpsLabReadiness()` and a read-only verifier used before and after the transfer.

- [ ] **Step 1: Write the failing readiness tests**

```ts
import { describe, expect, it } from "vitest";
import { evaluateSystemOpsLabReadiness } from "@/application/labs/systemops-lab-readiness";

describe("SystemOps Lab readiness", () => {
  it("is ready for controlled inbound but not automation", () => {
    const report = evaluateSystemOpsLabReadiness({
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: false,
      shadowModeEnabled: false,
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "lab-id",
      webhookSecretConfigured: true,
      remoteConnected: true,
    });
    expect(report.readyForControlledInbound).toBe(true);
    expect(report.readyForAutomation).toBe(false);
    expect(report.blockers).toEqual([]);
  });

  it("blocks tenant mismatch and enabled automation", () => {
    const report = evaluateSystemOpsLabReadiness({
      clinicId: "lab-id",
      isTest: true,
      isDemo: false,
      operationalStatus: "test",
      autoReplyEnabled: true,
      shadowModeEnabled: false,
      channelProvider: "z_api",
      zapiInstanceId: "instance-1",
      hasEncryptedToken: true,
      resolvedClinicId: "other-id",
      webhookSecretConfigured: true,
      remoteConnected: true,
    });
    expect(report.readyForControlledInbound).toBe(false);
    expect(report.blockers).toContain("tenant_resolution_mismatch");
    expect(report.blockers).toContain("automation_must_remain_disabled");
  });
});
```

- [ ] **Step 2: Run and confirm the missing module failure**

```bash
npm test -- src/__tests__/SystemOpsLabReadiness.test.ts
```

Expected: FAIL because the readiness module does not exist.

- [ ] **Step 3: Implement the pure report and read-only verifier**

Use these exact outputs:

```ts
export type SystemOpsLabReadinessReport = {
  readyForControlledInbound: boolean;
  readyForAutomation: false;
  blockers: Array<
    | "target_not_test"
    | "target_is_demo"
    | "status_not_test"
    | "automation_must_remain_disabled"
    | "shadow_must_remain_disabled"
    | "provider_not_zapi"
    | "instance_missing"
    | "credential_missing"
    | "tenant_resolution_mismatch"
    | "webhook_secret_missing"
    | "remote_not_connected"
  >;
};
```

`scripts/verify-systemops-lab.ts` requires only `SYSTEMOPS_LAB_CLINIC_ID`. It reads local configuration and tenant resolution. It checks remote Z-API status only when `SYSTEMOPS_LAB_CHECK_REMOTE=true`; otherwise `remoteConnected` is `null` and `remote_not_connected` is reported as a warning, not a local blocker. Output is JSON with booleans and reason codes; secret fields are represented only as `configured: true|false`.

- [ ] **Step 4: Write the operational runbook**

The runbook must contain these exact sections and commands:

```markdown
## Stop conditions
## 1. Rotate the exposed token in Z-API
## 2. Create or verify SystemOps Lab with automation off
## 3. Export rotated credentials locally without pasting them in chat or git
## 4. Run the dry-run
## 5. Review the expected source and target IDs
## 6. Apply the transfer
## 7. Run local and remote readiness verification
## 8. Send no message until the Phase 2 activation gate
## Rollback to a safe detached state
## Incident report fields
```

Commands:

```bash
npx dotenv -e .env.local -- npx tsx scripts/transfer-systemops-lab-channel.ts
SYSTEMOPS_LAB_APPLY=true SYSTEMOPS_LAB_TRANSFER_CONFIRMATION=TRANSFER_ROTATED_CREDENTIAL_TO_SYSTEMOPS_LAB npx dotenv -e .env.local -- npx tsx scripts/transfer-systemops-lab-channel.ts
npx dotenv -e .env.local -- npx tsx scripts/verify-systemops-lab.ts
SYSTEMOPS_LAB_CHECK_REMOTE=true npx dotenv -e .env.local -- npx tsx scripts/verify-systemops-lab.ts
```

Rollback is detach-only: clear the Lab channel mapping and credentials, keep all clinics with automation disabled, and do not reattach to Ximendes.

The setup section must also require an internal synthetic calendar, controlled SystemOps contact numbers, `isTest=true`, and a visual Lab label. Real client contacts, calendars, media, or conversation bodies must not be copied into this environment.

- [ ] **Step 5: Run tests and a no-secret source scan**

```bash
npm test -- src/__tests__/SystemOpsLabChannelTransfer.test.ts src/__tests__/SystemOpsLabTransferCommand.test.ts src/__tests__/SystemOpsLabReadiness.test.ts
rg -n "SYSTEMOPS_LAB_ZAPI_TOKEN=.*[^<]" docs scripts src || true
```

Expected: tests PASS; the scan shows no committed token value.

- [ ] **Step 6: Commit readiness and runbook**

```bash
git add src/application/labs/systemops-lab-readiness.ts scripts/verify-systemops-lab.ts docs/operations/systemops-lab-runbook.md src/__tests__/SystemOpsLabReadiness.test.ts
git commit -m "docs(lab): add safe readiness runbook"
```

---

### Task 4: Versioned, Privacy-Safe Performance Contract

**Files:**
- Create: `src/application/observability/performance-telemetry.ts`
- Test: `src/__tests__/PerformanceTelemetry.test.ts`

**Interfaces:**
- Consumes: raw client pathname and numeric durations.
- Produces: `PERFORMANCE_SCHEMA_VERSION`, `PerformanceSurface`, `PerformanceSample`, `parsePerformanceSample()`, `normalizePerformanceRoute()`, and `MAX_CLIENT_SAMPLES_PER_SESSION`.

- [ ] **Step 1: Write failing schema and normalization tests**

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_SAMPLES_PER_SESSION,
  normalizePerformanceRoute,
  parsePerformanceSample,
} from "@/application/observability/performance-telemetry";

describe("performance telemetry contract", () => {
  it.each([
    ["/app/inbox", "inbox_list"],
    ["/app/inbox/2e7162e4-0b75-49e5-8d53-a5b6337492bb", "conversation"],
    ["/app/agenda?new=1", "agenda"],
    ["/app/dashboard", "dashboard"],
  ])("normalizes %s without keeping IDs or queries", (raw, expected) => {
    expect(normalizePerformanceRoute(raw)).toBe(expected);
  });

  it("rejects an unknown route and non-finite duration", () => {
    expect(normalizePerformanceRoute("/owner/secret")).toBeNull();
    expect(() => parsePerformanceSample({
      schemaVersion: 1,
      source: "client",
      surface: "inbox_list",
      operation: "soft_navigation",
      durationMs: Number.POSITIVE_INFINITY,
    })).toThrow();
  });

  it("caps one browser session", () => {
    expect(MAX_CLIENT_SAMPLES_PER_SESSION).toBe(30);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- src/__tests__/PerformanceTelemetry.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact enums and Zod validation**

```ts
export const PERFORMANCE_SCHEMA_VERSION = 1 as const;
export const MAX_CLIENT_SAMPLES_PER_SESSION = 30;

export const PERFORMANCE_SURFACES = [
  "clinic_shell", "inbox_list", "conversation", "agenda", "dashboard",
] as const;

export const PERFORMANCE_OPERATIONS = [
  "shell_context",
  "inbox_base_query",
  "inbox_enrichment_query",
  "inbox_total",
  "conversation_total",
  "agenda_bootstrap",
  "dashboard_total",
  "soft_navigation",
] as const;

export type PerformanceSample = {
  schemaVersion: 1;
  source: "client" | "server";
  surface: typeof PERFORMANCE_SURFACES[number];
  operation: typeof PERFORMANCE_OPERATIONS[number];
  durationMs: number;
  cacheState?: "cold" | "warm" | "unknown";
  outcome: "ok" | "error";
};

export type PerformanceSurface = typeof PERFORMANCE_SURFACES[number];
export type PerformanceOperation = typeof PERFORMANCE_OPERATIONS[number];
```

Zod must require `0 <= durationMs <= 120_000`, require `outcome`, reject unknown keys with `.strict()`, and accept no arbitrary metadata. `normalizePerformanceRoute()` strips query/hash via `new URL(raw, "https://systemops.invalid")` and returns only a `PerformanceSurface`, never a pathname.

- [ ] **Step 4: Run focused tests**

```bash
npm test -- src/__tests__/PerformanceTelemetry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add src/application/observability/performance-telemetry.ts src/__tests__/PerformanceTelemetry.test.ts
git commit -m "feat(observability): define performance telemetry contract"
```

---

### Task 5: Server Timing Helper and Current Read-Path Instrumentation

**Files:**
- Create: `src/infrastructure/observability/performance-logger.ts`
- Modify: `src/app/(clinic)/layout.tsx`
- Modify: `src/app/(clinic)/app/inbox/page.tsx`
- Modify: `src/app/(clinic)/app/inbox/[conversationId]/page.tsx`
- Modify: `src/app/(clinic)/app/agenda/page.tsx`
- Modify: `src/app/(clinic)/app/dashboard/page.tsx`
- Test: `src/__tests__/PerformanceLogger.test.ts`

**Interfaces:**
- Consumes: `PerformanceSample` from Task 4 and existing `createLogger()`.
- Produces: `measureServerOperation()` and `recordServerPerformance()`.

- [ ] **Step 1: Write failing helper tests with an injected clock/sink**

```ts
import { describe, expect, it, vi } from "vitest";
import { measureServerOperation } from "@/infrastructure/observability/performance-logger";

describe("performance logger", () => {
  it("returns the work result and emits only sanitized fields", async () => {
    const emit = vi.fn();
    const ticks = [100, 137];
    const result = await measureServerOperation({
      clinicId: "clinic-id",
      surface: "inbox_list",
      operation: "inbox_base_query",
      enabled: true,
    }, async () => "rows", {
      now: () => ticks.shift()!,
      emit,
    });
    expect(result).toBe("rows");
    expect(emit).toHaveBeenCalledWith({
      schemaVersion: 1,
      source: "server",
      surface: "inbox_list",
      operation: "inbox_base_query",
      durationMs: 37,
      outcome: "ok",
      clinicId: "clinic-id",
    });
  });

  it("does not emit when disabled", async () => {
    const emit = vi.fn();
    await measureServerOperation({
      clinicId: "clinic-id",
      surface: "agenda",
      operation: "agenda_bootstrap",
      enabled: false,
    }, async () => undefined, { now: () => 0, emit });
    expect(emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- src/__tests__/PerformanceLogger.test.ts
```

Expected: FAIL because the logger module does not exist.

- [ ] **Step 3: Implement the helper without Sentry traces or database writes**

```ts
type ServerTimingInput = {
  clinicId: string;
  surface: PerformanceSurface;
  operation: PerformanceOperation;
  enabled?: boolean;
};

export async function measureServerOperation<T>(
  input: ServerTimingInput,
  work: () => Promise<T>,
  deps: {
    now(): number;
    emit(sample: PerformanceSample & { clinicId: string }): void;
  } = defaultPerformanceLoggerDeps,
): Promise<T>;

export function recordServerPerformance(
  sample: PerformanceSample & { clinicId: string },
): void;
```

Default enablement is `process.env.PERFORMANCE_TELEMETRY_ENABLED === "1"`. The default sink calls:

```ts
createLogger({ scope: "PerformanceTelemetry", clinicId: sample.clinicId })
  .info("performance.sample", sampleWithoutClinicId);
```

The helper must emit in `finally`, using `outcome: "ok" | "error"`, then rethrow the original error.

- [ ] **Step 4: Instrument current surfaces without changing their query semantics**

Use operation labels exactly once around these blocks:

- `ClinicLayout`: existing `Promise.all` for member, badge, and organization → `shell_context`.
- `InboxPage`: first `Promise.all` → `inbox_base_query`; five enrichment queries → `inbox_enrichment_query`; page body from tenant resolution to prepared props → `inbox_total`.
- `ConversationPage`: all current data preparation → `conversation_total`.
- `AgendaPage`: existing bootstrap `Promise.all` → `agenda_bootstrap`.
- `DashboardPage`: full data preparation before JSX → `dashboard_total`.

Do not reorder queries, add caches, or change returned props in this task.

- [ ] **Step 5: Run helper tests, typecheck, and the existing inbox snapshot tests**

```bash
npm test -- src/__tests__/PerformanceTelemetry.test.ts src/__tests__/PerformanceLogger.test.ts src/__tests__/InboxSnapshot.test.ts src/__tests__/AgendaSnapshot.test.ts
npm run typecheck
```

Expected: all requested tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit server instrumentation**

```bash
git add src/infrastructure/observability/performance-logger.ts src/application/observability/performance-telemetry.ts src/app/'(clinic)'/layout.tsx src/app/'(clinic)'/app/inbox/page.tsx src/app/'(clinic)'/app/inbox/'[conversationId]'/page.tsx src/app/'(clinic)'/app/agenda/page.tsx src/app/'(clinic)'/app/dashboard/page.tsx src/__tests__/PerformanceLogger.test.ts src/__tests__/PerformanceTelemetry.test.ts
git commit -m "feat(observability): measure clinic read paths"
```

---

### Task 6: Bounded Client Soft-Navigation Telemetry

**Files:**
- Create: `src/application/observability/navigation-timing.ts`
- Create: `src/components/performance/navigation-performance-reporter.tsx`
- Create: `src/app/api/telemetry/performance/route.ts`
- Modify: `src/components/sidebar-nav.tsx`
- Modify: `src/app/(clinic)/app/inbox/InboxClient.tsx`
- Modify: `src/app/(clinic)/layout.tsx`
- Test: `src/__tests__/NavigationPerformance.test.ts`
- Test: `src/__tests__/PerformanceTelemetryRoute.test.ts`

**Interfaces:**
- Consumes: Task 4 contract and authenticated `getSessionClinicId()`.
- Produces: `markNavigationStart()`, `completeNavigation()`, `NavigationPerformanceReporter`, and `POST /api/telemetry/performance`.

- [ ] **Step 1: Write the failing pure state-machine test**

```ts
import { describe, expect, it } from "vitest";
import { completeNavigation, markNavigationStart } from "@/application/observability/navigation-timing";

describe("soft navigation timing", () => {
  it("matches the intended normalized surface and consumes the pending mark", () => {
    const pending = markNavigationStart(null, "/app/inbox", 100);
    const completed = completeNavigation(pending, "/app/inbox", 245);
    expect(completed).toEqual({
      nextPending: null,
      sample: {
        schemaVersion: 1,
        source: "client",
        surface: "inbox_list",
        operation: "soft_navigation",
        durationMs: 145,
        cacheState: "unknown",
        outcome: "ok",
      },
    });
  });

  it("drops mismatched, unknown, stale, or negative marks", () => {
    const pending = markNavigationStart(null, "/app/agenda", 100);
    expect(completeNavigation(pending, "/app/inbox", 200).sample).toBeNull();
    expect(completeNavigation(pending, "/app/agenda", 121_000).sample).toBeNull();
  });
});
```

- [ ] **Step 2: Write failing authenticated route tests**

Mock `getSessionClinicId` and `createLogger`. Assert:

```ts
it("rejects unauthenticated requests", async () => {
  mocks.getSessionClinicId.mockResolvedValue(null);
  expect((await POST(validRequest())).status).toBe(401);
});

it("rejects payloads over 4096 bytes or outside the strict schema", async () => {
  expect((await POST(oversizedRequest())).status).toBe(413);
  expect((await POST(requestWithUnknownField())).status).toBe(400);
});

it("logs the server-resolved clinic id and no raw route", async () => {
  const response = await POST(validRequest());
  expect(response.status).toBe(204);
  expect(mocks.logInfo).toHaveBeenCalledWith("performance.sample", expect.not.objectContaining({ pathname: expect.anything() }));
});
```

- [ ] **Step 3: Run both tests and confirm failure**

```bash
npm test -- src/__tests__/NavigationPerformance.test.ts src/__tests__/PerformanceTelemetryRoute.test.ts
```

Expected: FAIL because the modules and route do not exist.

- [ ] **Step 4: Implement pure timing and client reporter**

`markNavigationStart()` and `completeNavigation()` remain pure. The client component stores one pending mark and a session count in `sessionStorage` under:

```ts
const NAVIGATION_MARK_KEY = "systemops.performance.pending-navigation.v1";
const NAVIGATION_COUNT_KEY = "systemops.performance.sample-count.v1";
```

On pathname change, send at most 30 samples per browser session with:

```ts
navigator.sendBeacon(
  "/api/telemetry/performance",
  new Blob([JSON.stringify(sample)], { type: "application/json" }),
);
```

If `sendBeacon` is unavailable or returns false, use one `fetch` with `keepalive: true`. Do not retry client telemetry. Telemetry failure must never affect navigation.

Mount `<NavigationPerformanceReporter />` once in `ClinicLayout`. In `SidebarNav`, call `markNavigationStartInSession(href)` immediately before the existing haptic callback; unknown/administrative routes normalize to null and create no mark. In `InboxClient`, add the same call to all three conversation-card `<Link href={\`/app/inbox/${row.convId}\`}>` render paths so the conversation baseline is measured without exposing the ID in the event.

- [ ] **Step 5: Implement the endpoint**

Rules:

- If `PERFORMANCE_TELEMETRY_ENABLED !== "1"`, return 204 without reading the body.
- Require a resolved session clinic; otherwise 401.
- Reject `Content-Length > 4096` with 413.
- Parse at most 4096 bytes and validate with `parsePerformanceSample()`.
- Require `source === "client"` and `operation === "soft_navigation"`.
- Log through `createLogger({ scope: "PerformanceTelemetry", clinicId })` as `performance.sample`.
- Return 204; never echo input.

- [ ] **Step 6: Run tests and typecheck**

```bash
npm test -- src/__tests__/PerformanceTelemetry.test.ts src/__tests__/NavigationPerformance.test.ts src/__tests__/PerformanceTelemetryRoute.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit client and route telemetry**

```bash
git add src/application/observability/navigation-timing.ts src/components/performance/navigation-performance-reporter.tsx src/app/api/telemetry/performance/route.ts src/components/sidebar-nav.tsx src/app/'(clinic)'/app/inbox/InboxClient.tsx src/app/'(clinic)'/layout.tsx src/__tests__/NavigationPerformance.test.ts src/__tests__/PerformanceTelemetryRoute.test.ts
git commit -m "feat(observability): measure soft navigation"
```

---

### Task 7: Offline Percentile Report and Baseline Protocol

**Files:**
- Create: `src/application/observability/performance-summary.ts`
- Create: `scripts/summarize-performance-logs.ts`
- Create: `docs/operations/performance-baseline.md`
- Modify: `package.json`
- Test: `src/__tests__/PerformanceSummary.test.ts`

**Interfaces:**
- Consumes: JSONL structured log entries whose `msg` is `performance.sample` and `schemaVersion` is 1.
- Produces: `summarizePerformanceSamples()` and `npm run performance:summary -- <file>`.

- [ ] **Step 1: Write the failing percentile test**

```ts
import { describe, expect, it } from "vitest";
import { summarizePerformanceSamples } from "@/application/observability/performance-summary";

describe("performance summary", () => {
  it("groups by source, surface, operation, and outcome", () => {
    const durations = [100, 200, 300, 400, 500, 600, 700, 800];
    const summary = summarizePerformanceSamples(durations.map((durationMs) => ({
      schemaVersion: 1 as const,
      source: "client" as const,
      surface: "inbox_list" as const,
      operation: "soft_navigation" as const,
      durationMs,
      cacheState: "unknown" as const,
      outcome: "ok" as const,
    })));
    expect(summary).toEqual([expect.objectContaining({
      key: "client|inbox_list|soft_navigation|ok",
      count: 8,
      p50Ms: 400,
      p75Ms: 600,
      p95Ms: 800,
      maxMs: 800,
    })]);
  });
});
```

Use nearest-rank percentile: `ceil(p * n) - 1`, clamped to the sorted array.

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- src/__tests__/PerformanceSummary.test.ts
```

Expected: FAIL because the summary module does not exist.

- [ ] **Step 3: Implement pure aggregation and the JSONL CLI**

```ts
export type PerformanceSummaryRow = {
  key: string;
  count: number;
  p50Ms: number;
  p75Ms: number;
  p95Ms: number;
  maxMs: number;
};

export function summarizePerformanceSamples(
  samples: PerformanceSample[],
): PerformanceSummaryRow[];
```

The CLI:

1. reads the path from `process.argv[2]`;
2. rejects a missing path with exit code 2 and usage text;
3. parses JSONL line by line;
4. keeps only `msg === "performance.sample"`, projects only the six `PerformanceSample` fields from the log object, and validates the projected schema v1;
5. prints a Markdown table sorted by key;
6. prints `insufficient` when a group has fewer than 30 samples;
7. prints no raw log line, clinic ID, or extra field.

Add:

```json
"performance:summary": "tsx scripts/summarize-performance-logs.ts"
```

- [ ] **Step 4: Write the baseline collection protocol**

`docs/operations/performance-baseline.md` must prescribe:

- preview/Lab only;
- `PERFORMANCE_TELEMETRY_ENABLED=1`;
- automation still off;
- 30 cold and 30 warm navigations for Inbox, Conversation, Agenda, and Dashboard;
- desktop and mobile recorded separately by running two sessions and separate log exports;
- no patient data; only synthetic Lab rows;
- export Vercel JSONL logs filtered by `scope=PerformanceTelemetry` and `msg=performance.sample`;
- run `npm run performance:summary -- ./performance-lab.jsonl`;
- record current p50/p75/p95, query count observations, payload size observations, and whether each design target is already met;
- disable telemetry after collection;
- do not claim an optimization from this baseline.

Include the approved comparison table:

```markdown
| Metric | Design target |
| --- | --- |
| Visual feedback after tap | < 100 ms |
| Previously visited screen | p75 < 300 ms |
| First application open | p75 < 1.5 s |
| Open conversation | p75 < 800 ms |
| New message visible | <= 1 s (measured only after Phase 3 realtime work) |
```

- [ ] **Step 5: Run summary tests and a synthetic CLI smoke test**

```bash
npm test -- src/__tests__/PerformanceSummary.test.ts
tmp_perf_file="$(mktemp)"
printf '%s\n' '{"msg":"performance.sample","schemaVersion":1,"source":"client","surface":"inbox_list","operation":"soft_navigation","durationMs":120,"cacheState":"unknown","outcome":"ok"}' > "$tmp_perf_file"
npm run performance:summary -- "$tmp_perf_file"
```

Expected: test PASS; CLI prints one `insufficient` row and no raw JSON.

- [ ] **Step 6: Commit summary and protocol**

```bash
git add src/application/observability/performance-summary.ts scripts/summarize-performance-logs.ts docs/operations/performance-baseline.md package.json src/__tests__/PerformanceSummary.test.ts
git commit -m "feat(observability): add performance baseline report"
```

---

### Task 8: Phase 0–1 Verification and Handoff Gate

**Files:**
- Verify only; do not modify application behavior to make a failing command pass.

**Interfaces:**
- Consumes: deliverables from Tasks 1–7.
- Produces: evidence for PR review and an explicit operational blocker if the token has not been rotated.

- [ ] **Step 1: Run the complete focused suite**

```bash
npm test -- \
  src/__tests__/SystemOpsLabChannelTransfer.test.ts \
  src/__tests__/SystemOpsLabTransferCommand.test.ts \
  src/__tests__/SystemOpsLabReadiness.test.ts \
  src/__tests__/PerformanceTelemetry.test.ts \
  src/__tests__/PerformanceLogger.test.ts \
  src/__tests__/NavigationPerformance.test.ts \
  src/__tests__/PerformanceTelemetryRoute.test.ts \
  src/__tests__/PerformanceSummary.test.ts \
  src/__tests__/ZApiWebhookRoute.test.ts \
  src/__tests__/ClinicOperationalStatus.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

```bash
npm run verify
```

Expected: exit 0. If it fails, stop and report branch, commit, command, failure summary, environment, and safest rollback; do not stack unrelated fixes.

- [ ] **Step 3: Verify the branch contains no credential or production mutation**

```bash
git diff origin/develop...HEAD -- . ':!package-lock.json' | rg -n "(zapi[_-]?token|client[_-]?token).*(=|:).*[A-Za-z0-9]{12}" || true
git diff --check origin/develop...HEAD
git status --short
```

Expected: no token-like value, no whitespace errors, clean worktree.

- [ ] **Step 4: Run Lab dry-run only**

```bash
npx dotenv -e .env.local -- npx tsx scripts/transfer-systemops-lab-channel.ts
npx dotenv -e .env.local -- npx tsx scripts/verify-systemops-lab.ts
```

Expected: dry-run prints target/source IDs and reason codes without credentials; verifier reports automation disabled. If the new token is not present or not confirmed rotated, stop here. This is a legitimate external-state blocker, not a code failure.

- [ ] **Step 5: Prepare PR notes**

Include:

```markdown
## What changed
- Added a dry-run-first, fail-closed SystemOps Lab channel transfer path.
- Added read-only Lab readiness verification and runbook.
- Added privacy-safe server/client performance telemetry and offline percentile reporting.

## Safety
- No WhatsApp message is sent.
- Lab automation remains disabled.
- No Ximendes operation is performed.
- No credential is committed or logged.
- Telemetry is disabled by default and stores no patient content.

## Tests
- npm run verify
- focused Lab and performance suites

## Migration
- None.

## Rollback
- Revert the focused commits. If the channel transfer was applied, detach the instance from Lab and keep it detached; never reattach it to Ximendes automatically.
```

- [ ] **Step 6: Stop at the operational gate**

Do not apply the transfer, enable Lab automation, collect a production baseline, or deploy until:

1. the user confirms the token was rotated outside the repository/chat;
2. the PR is approved and CI is green;
3. the preview dry-run identifies the expected source and target;
4. the runbook stop conditions are all false.
