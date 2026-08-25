# Conversation Runtime V2-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Conversation Intelligence V2 the only executable live conversation runtime, with authority-v2 admission, a durable global kill switch, sender-time revalidation, bounded retries, and a tenant-scoped first rollout.

**Architecture:** Durable ingress, stream generation, claim, outbox, and sender remain the irreversible boundaries. A new singleton runtime-control row and the existing tenant authority join the clinic policy at claim time; the same state is checked again in atomic outbox creation and immediately before provider delivery. The composition root constructs only `V2LiveConversationHandler`; V1 remains unreachable reference code and never becomes rollback.

**Tech Stack:** TypeScript 5.8, Next.js 16, Drizzle ORM, PostgreSQL/Neon HTTP, embedded PostgreSQL/node-postgres for integration tests, Vitest, ESLint, Vercel, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-25-v2-only-runtime-design.md`

## Global Constraints

- Every live turn requires `conversation_authority.version >= 2`; missing or unreadable authority fails closed.
- No production path imports, constructs, or falls back to `ConversationOrchestrator`, `TenantEngineRouter`, or V1.
- Missing, unreadable, or closed global runtime control blocks creation and delivery of `live_stream_reply`.
- Sender revalidates exact stream/inbound/claim authority, active status, auto reply, observe/shadow, takeover, consent/opt-out, safety gates, and global control immediately before delivery.
- Internal Lab approval and build binding are removed only from live runtime authorization; replay and synthetic-test authorization remain isolated.
- `message.process` has at most 3 claims; `message.send` retains at most 10 claims and 15-minute maximum backoff.
- One provider event creates at most one process job; one settled generation creates at most one live reply and one send job for its lifetime.
- No polling, heartbeat, continuously running worker, production data access, V1 fallback, force-push, or hand-authored migration SQL.
- Paused, disabled, test-only-not-active, demo, prospect, cancelled, or authority-below-v2 tenants remain unchanged and inactive.
- Every task is RED -> GREEN -> refactor and ends with an independently reviewable commit.

---

## File map

### New focused units

- `src/application/ports/conversation-runtime-control-store.ts`: typed singleton read/CAS contract.
- `src/infrastructure/repositories/drizzle-conversation-runtime-control-store.ts`: durable global switch implementation.
- `src/application/automation/v2-only-automation-policy.ts`: combines clinic policy, tenant authority, and global switch into a closed reasoned decision.
- `src/application/ports/live-outbound-preflight.ts`: sender-facing reasoned preflight result.
- `src/infrastructure/repositories/drizzle-live-outbound-preflight.ts`: one bounded SQL read for live reply authorization and current safety state.
- `src/application/conversation-v2/v2-terminal-failure-policy.ts`: retry-budget and terminal safe-response/handoff decision.
- `src/infrastructure/repositories/drizzle-v2-terminal-handoff-store.ts`: tenant-scoped durable `needs_attention`/`ai_paused` transition after retry exhaustion.
- `src/application/conversation-v2/v2-runtime-performance.ts`: sanitized metric schema and candidate-vs-baseline gate.
- `scripts/measure-v2-only-runtime.ts`: deterministic two-arm benchmark, no production/provider access.
- `scripts/audit-v2-only-rollout.ts`: read-only tenant/queue/runtime audit.
- `scripts/control-v2-only-rollout.ts`: dry-run-default, exact-tenant CAS pause/reactivate and global-switch CAS.
- `src/__tests__/V2OnlyRuntimeArchitecture.test.ts`: transitive production import and no-fallback contract.
- `src/__tests__/V2OnlyAutomationPolicy.test.ts`: reasoned policy unit contract.
- `src/__tests__/V2OnlyRuntimeDatabase.test.ts`: singleton/CAS, outbox, sender, tenant isolation, retry terminal integration.
- `src/__tests__/V2OnlyRuntimePerformance.test.ts`: metric schema and threshold contract.
- `docs/operations/v2-only-runtime-rollout.md`: first-cut and later activation runbook.
- `docs/architecture/v2-capability-parity.md`: behavior-by-behavior V1 reference to V2 capability/shared-service/safe-handoff classification.
- `evals/v2-only/runtime-baseline.json`: sanitized frozen baseline from the unchanged legacy and V2 arms.

### Existing units changed

- `src/infrastructure/db/schema.ts` and generated `drizzle/0102_*.sql`/metadata: additive runtime-control table only.
- `src/application/ports/clinic-automation-policy-reader.ts`: reasoned decision while retaining `getAutomationMode()` compatibility for non-runtime readers.
- `src/infrastructure/repositories/drizzle-clinic-automation-policy-reader.ts`: clinic facts include demo/status/shadow.
- `src/application/jobs/process-message-job.ts`: consumes reasoned V2-only policy; removes V1 observation/shadow dispatch.
- `src/application/jobs/drain-message-process-queue.ts`: terminal handoff on the third failed claim.
- `src/infrastructure/repositories/drizzle-inbound-event-store.ts` and `drizzle-whatsapp-stream-authority.ts`: process jobs persist `max_attempts=3`.
- `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`: direct V2 composition for the current tenant, no Lab UUID restriction.
- `src/application/conversation-v2/v2-live-conversation-handler.ts`: no `internalLabBinding`; failure outcomes remain idempotent.
- `src/application/conversation-v2/internal-lab-live-turn-configuration.ts`: split reusable live configuration from obsolete Lab approval binding, then retire the live wrapper.
- `src/infrastructure/repositories/drizzle-outbound-message-store.ts`: creation-time global/tenant authority fence and sender authority validation.
- `src/application/jobs/send-message-job.ts`: typed live preflight immediately before provider; no Internal Lab live guard.
- `src/infrastructure/repositories/drizzle-outbound-safety-context-reader.ts`: preserve non-conversation category safety; remove duplicate live-reply reads after consolidated preflight.
- `src/app/api/cron/message-worker/route.ts`, `src/app/api/cron/sender-worker/route.ts`, and runtime wiring call sites: V2-only dependencies.
- `package.json` and `.github/workflows/ci.yml`: deterministic benchmark and embedded database commands.
- `README.md`, `docs/architecture/current.md`, `docs/architecture/sources-of-truth.md`, and `docs/operations/change-control.md`: V2-only canonical state and rollout boundary.

---

### Task 1: Freeze the current V1/V2 performance baseline

**Files:**
- Create: `src/application/conversation-v2/v2-runtime-performance.ts`
- Create: `scripts/measure-v2-only-runtime.ts`
- Create: `src/__tests__/V2OnlyRuntimePerformance.test.ts`
- Create: `evals/v2-only/runtime-baseline.json`
- Modify: `package.json`
- Test: `src/__tests__/V2OnlyRuntimePerformance.test.ts`

**Interfaces:**
- Produces: `RuntimeArmMetrics`, `RuntimePerformanceReport`, `evaluateRuntimePerformance(candidate, baseline)` and command `npm run measure:v2-only-runtime`.
- Metric population: the 17 committed Cycle-I cases repeated 6 times per arm, 102 turns per arm, fixed clocks and deterministic model doubles.

- [ ] **Step 1: Write the metric-schema and threshold tests**

```ts
expect(evaluateRuntimePerformance(candidate, baseline)).toEqual({ passed: true, violations: [] });
expect(() => parseRuntimePerformanceReport({ ...report, modelCalls: null })).toThrow();
```

Assert these exact gates:

```text
p50 turn latency: candidate <= baseline * 1.10 AND delta <= 100 ms
p95 turn latency: candidate <= baseline * 1.10 AND delta <= 250 ms
mean model calls/turn: candidate <= baseline
p95 model calls/turn: candidate <= baseline
mean total tokens/turn: candidate <= baseline * 1.10
p95 total tokens/turn: candidate <= baseline * 1.15
p95 SQL statements/turn: candidate <= baseline * 1.10
p95 sequential DB round trips/turn: candidate <= baseline + 2
p95 stream-lock hold: candidate <= baseline * 1.10 AND delta <= 5 ms
process jobs/provider event: exactly 1
live replies/settled generation: 0 or 1; exactly 1 only when the fixture expects a reply
send jobs/live reply: exactly 1
duplicate provider fixture: 1 event, 1 process job, 1 reply, 1 send job
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/__tests__/V2OnlyRuntimePerformance.test.ts`

Expected: FAIL because the metric parser/evaluator and baseline artifact do not exist.

- [ ] **Step 3: Implement the deterministic two-arm recorder**

Use explicit metric records; no content, phone, payload, prompt, or response text enters the JSON:

```ts
export type RuntimeArmMetrics = Readonly<{
  arm: "v1_current" | "v2_only";
  turns: number;
  latencyMs: Readonly<{ p50: number; p95: number }>;
  modelCalls: Readonly<{ mean: number; p95: number }>;
  tokens: Readonly<{ mean: number; p95: number }>;
  database: Readonly<{ statementsP95: number; roundTripsP95: number; lockHoldP95Ms: number }>;
  cardinality: Readonly<{ events: number; processJobs: number; liveReplies: number; sendJobs: number }>;
}>;
```

The model double returns deterministic usage derived from fixed fixture IDs and records actual invocation count. The DB adapter records SQL dispatch boundaries and lock intervals in embedded PostgreSQL. The script refuses `.env.local`, external hosts, credentials, a dirty tree, fewer than 102 turns per arm, null metrics, or a population mismatch.

- [ ] **Step 4: Run GREEN and freeze baseline**

Run:

```bash
npx vitest run src/__tests__/V2OnlyRuntimePerformance.test.ts
npm run measure:v2-only-runtime -- --write-baseline evals/v2-only/runtime-baseline.json
npm run measure:v2-only-runtime -- --baseline evals/v2-only/runtime-baseline.json
```

Expected: 102 turns per arm; all fields numeric; current comparison reported without claiming production latency.

- [ ] **Step 5: Verify and commit**

```bash
npx eslint src/application/conversation-v2/v2-runtime-performance.ts scripts/measure-v2-only-runtime.ts src/__tests__/V2OnlyRuntimePerformance.test.ts
npm run typecheck
git diff --check
git add src/application/conversation-v2/v2-runtime-performance.ts scripts/measure-v2-only-runtime.ts src/__tests__/V2OnlyRuntimePerformance.test.ts evals/v2-only/runtime-baseline.json package.json
git commit -m "test(v2): freeze v1 and v2 runtime performance baseline"
```

---

### Task 2: Add the durable fail-closed global runtime control

**Files:**
- Create: `src/application/ports/conversation-runtime-control-store.ts`
- Create: `src/infrastructure/repositories/drizzle-conversation-runtime-control-store.ts`
- Modify: `src/infrastructure/db/schema.ts`
- Generate: `drizzle/0102_*.sql`, `drizzle/meta/0102_snapshot.json`, `drizzle/meta/_journal.json`
- Modify: `src/__tests__/WhatsAppStreamSchema.test.ts`
- Modify: `src/__tests__/V2OnlyRuntimeDatabase.test.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`, `src/__tests__/DatabaseTestCommandIsolation.test.ts`

**Interfaces:**
- Produces:

```ts
export type ConversationRuntimeControl = Readonly<{
  liveOutboundEnabled: boolean;
  version: number;
}>;
export interface ConversationRuntimeControlStore {
  getGlobal(): Promise<ConversationRuntimeControl>;
  compareAndSetGlobal(input: Readonly<{
    expectedVersion: number;
    liveOutboundEnabled: boolean;
    actor: string;
    now: Date;
  }>): Promise<boolean>;
}
```

Missing row maps to `{ liveOutboundEnabled: false, version: 0 }`; read error propagates and callers close.

- [ ] **Step 1: Write RED schema/database tests**

Cover singleton key enforcement, default closed, monotonic CAS, stale CAS rejection, no lost concurrent update, absent-row fail-closed, and no tenant row mutation.

- [ ] **Step 2: Run RED**

Run:

```bash
npx vitest run src/__tests__/WhatsAppStreamSchema.test.ts
npx vitest run src/__tests__/V2OnlyRuntimeDatabase.test.ts --maxWorkers=1
```

Expected: schema/table/store missing, not setup/import/credential failure.

- [ ] **Step 3: Add schema and generate migration**

Add a text primary key constrained to `global`, `live_outbound_enabled not null default false`, `version bigint not null default 1`, actor/timestamp, and `version >= 1` check. Run only:

```bash
npm run db:generate
```

Inspect generated SQL for additive create/check/index statements only. If it drops/retypes existing data, stop at the destructive-migration boundary.

- [ ] **Step 4: Implement store and GREEN**

`compareAndSetGlobal` inserts only for `expectedVersion=0`, otherwise updates `where key='global' and version=expectedVersion`, always setting `version=expectedVersion+1`. It never downgrades or skips a version.

Run:

```bash
npm run db:check
npx vitest run src/__tests__/WhatsAppStreamSchema.test.ts
npm run test:db:authority
```

Expected: every embedded database test executes with zero skips.

- [ ] **Step 5: Commit**

```bash
npx eslint src/application/ports/conversation-runtime-control-store.ts src/infrastructure/repositories/drizzle-conversation-runtime-control-store.ts src/__tests__/WhatsAppStreamSchema.test.ts src/__tests__/V2OnlyRuntimeDatabase.test.ts
npm run typecheck
git diff --check
git add src/infrastructure/db/schema.ts src/application/ports/conversation-runtime-control-store.ts src/infrastructure/repositories/drizzle-conversation-runtime-control-store.ts src/__tests__/WhatsAppStreamSchema.test.ts src/__tests__/V2OnlyRuntimeDatabase.test.ts drizzle package.json .github/workflows/ci.yml src/__tests__/DatabaseTestCommandIsolation.test.ts
git commit -m "feat(v2): add durable global live outbound control"
```

---

### Task 3: Enforce V2 authority at the claim-time automation boundary

**Files:**
- Create: `src/application/automation/v2-only-automation-policy.ts`
- Create: `src/__tests__/V2OnlyAutomationPolicy.test.ts`
- Modify: `src/application/ports/clinic-automation-policy-reader.ts`
- Modify: `src/infrastructure/repositories/drizzle-clinic-automation-policy-reader.ts`
- Modify: `src/application/jobs/process-message-job.ts`
- Modify: `src/__tests__/ProcessMessageJob.test.ts`, `src/__tests__/MessageWorkerV2Composition.test.ts`, `src/__tests__/ClinicAutomationPolicy.test.ts`

**Interfaces:**
- Consumes: `ConversationAuthorityStore`, `ConversationRuntimeControlStore`, clinic facts.
- Produces:

```ts
export type V2AutomationDecision = Readonly<{
  clinicId: string;
  mode: "live" | "observe" | "disabled";
  reason: "live_v2" | "clinic_missing" | "operational_status" | "auto_reply_disabled"
    | "shadow_observe" | "demo" | "authority_below_v2" | "global_kill_switch";
  authorityVersion: 0 | 1 | 2 | 3;
  runtimeControlVersion: number;
}>;
```

- [ ] **Step 1: Write RED policy tests**

Prove active+auto+authority2+switch-open => `live_v2`; every missing/error/lower version => disabled; shadow => observe; demo/prospect/test/paused/cancelled => disabled; no call to a V1 handler; only exact clinic ID is queried.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/__tests__/V2OnlyAutomationPolicy.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/MessageWorkerV2Composition.test.ts`

Expected: missing policy and stale V1 observation expectations.

- [ ] **Step 3: Implement minimal policy and trace**

Read all three sources with `Promise.all` because they are independent read-only lookups. Catching any source error returns `disabled/global_kill_switch` only after emitting a sanitized policy-read failure; never return live on an exception. `ProcessMessageJobHandler` records `automationMode`, reason, authority version, and control version, then invokes the handler only for `live`.

- [ ] **Step 4: GREEN/refactor**

Run:

```bash
npx vitest run src/__tests__/V2OnlyAutomationPolicy.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/ClinicAutomationPolicy.test.ts
npx eslint src/application/automation/v2-only-automation-policy.ts src/application/ports/clinic-automation-policy-reader.ts src/infrastructure/repositories/drizzle-clinic-automation-policy-reader.ts src/application/jobs/process-message-job.ts src/__tests__/V2OnlyAutomationPolicy.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git diff --check
git add src/application/automation/v2-only-automation-policy.ts src/application/ports/clinic-automation-policy-reader.ts src/infrastructure/repositories/drizzle-clinic-automation-policy-reader.ts src/application/jobs/process-message-job.ts src/__tests__/V2OnlyAutomationPolicy.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/ClinicAutomationPolicy.test.ts
git commit -m "feat(v2): require authority v2 for live automation"
```

---

### Task 4: Make the production composition root V2-only and tenant-generic

**Files:**
- Create: `src/__tests__/V2OnlyRuntimeArchitecture.test.ts`
- Create: `src/application/conversation-v2/resolve-v2-live-turn-configuration.ts`
- Create: `docs/architecture/v2-capability-parity.md`
- Modify: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/application/jobs/process-message-job.ts`
- Modify: `src/app/api/cron/message-worker/route.ts`
- Modify: `src/__tests__/MessageWorkerV2Composition.test.ts`, `src/__tests__/ConversationV2LiveTurnConfiguration.test.ts`, `src/__tests__/ConversationV2LiveIsolation.test.ts`, `src/__tests__/V2LiveConversationHandler.test.ts`
- Modify: `src/__tests__/ConversationV2JourneyMatrix.test.ts`

**Interfaces:**
- Produces `ConversationV2Runtime` with only `conversationHandler: ConversationHandler`, `automationPolicy`, and `decisionTraceSink` required by the worker.
- Produces `resolveV2LiveTurnConfiguration(input, deps)` scoped by `input.clinicId`; no expected Lab UUID and no delivery binding.

- [ ] **Step 1: Write RED transitive-import and composition tests**

The architecture test starts at webhook/worker/runtime/sender roots, resolves static local imports, and fails if reachable files import `ConversationOrchestrator`, `TenantEngineRouter`, engine-policy readers, Internal Lab live approval/binding readers, or V1 observation/shadow selection. Also prove missing OpenAI configuration throws a V2 provider error without constructing V1.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/__tests__/V2OnlyRuntimeArchitecture.test.ts src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/ConversationV2LiveTurnConfiguration.test.ts src/__tests__/ConversationV2LiveIsolation.test.ts`

Expected: direct imports and Lab-only calendar/config restrictions are reported.

- [ ] **Step 3: Build direct V2 composition**

Delete live-runtime properties for shadow evaluator, V1 collector, selector, policy reader, approval identity, and delivery guard. Resolve calendar and editorial configuration by the immutable `clinicId` from the claimed event. Keep replay/shadow modules as disconnected tooling, not runtime imports.

- [ ] **Step 4: Prove tenant isolation and safe unsupported behavior**

Tests cover two active authority-v2 tenants with different catalog/calendar adapters; cross-tenant adapter return rejects before effects. Unsupported/deferred requests produce the existing deterministic safe reply or persisted handoff, never V1. The parity document classifies opening/reception, catalog, authorized price, objections, multi-turn pipeline, media, qualification, scheduling/revalidation, reservation, deposit, cancel/reschedule, opt-out, handoff, takeover, turn-related follow-up, and voice as `v2_capability`, `shared_service`, `obsolete`, or `safe_handoff`; the journey-matrix test rejects an unclassified behavior or a `v1` resolution.

- [ ] **Step 5: GREEN and commit**

```bash
npx vitest run src/__tests__/V2OnlyRuntimeArchitecture.test.ts src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/ConversationV2LiveTurnConfiguration.test.ts src/__tests__/ConversationV2LiveIsolation.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/ConversationV2JourneyMatrix.test.ts
npx eslint src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts src/application/conversation-v2/resolve-v2-live-turn-configuration.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/application/jobs/process-message-job.ts src/__tests__/V2OnlyRuntimeArchitecture.test.ts
npm run typecheck
git diff --check
git add src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts src/application/conversation-v2/resolve-v2-live-turn-configuration.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/application/jobs/process-message-job.ts src/app/api/cron/message-worker/route.ts docs/architecture/v2-capability-parity.md src/__tests__/V2OnlyRuntimeArchitecture.test.ts src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/ConversationV2LiveTurnConfiguration.test.ts src/__tests__/ConversationV2LiveIsolation.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/ConversationV2JourneyMatrix.test.ts
git commit -m "feat(v2): make v2 the sole conversation runtime"
```

---

### Task 5: Fence live outbox creation and revalidate at sender delivery

**Files:**
- Create: `src/application/ports/live-outbound-preflight.ts`
- Create: `src/infrastructure/repositories/drizzle-live-outbound-preflight.ts`
- Modify: `src/infrastructure/repositories/drizzle-outbound-message-store.ts`
- Modify: `src/application/jobs/send-message-job.ts`
- Modify: `src/infrastructure/repositories/drizzle-outbound-safety-context-reader.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/__tests__/WhatsAppOutboundAuthorization.test.ts`, `src/__tests__/SendMessageJob.test.ts`, `src/__tests__/V2LiveConversationHandler.test.ts`, `src/__tests__/AutomationResponseTrace.test.ts`, `src/__tests__/V2OnlyRuntimeDatabase.test.ts`

**Interfaces:**
- Produces:

```ts
export type LiveOutboundPreflightResult =
  | Readonly<{ authorized: true }>
  | Readonly<{ authorized: false; reason: "authority_below_v2" | "claim_mismatch"
      | "clinic_not_active" | "auto_reply_disabled" | "shadow_observe"
      | "human_takeover" | "consent_revoked" | "opted_out" | "safety_blocked"
      | "global_kill_switch" | "outbound_not_sendable" }>;
```

`DrizzleLiveOutboundPreflight` owns the single SQL statement. `DrizzleOutboundMessageStore.authorizeOutboundMessageForSend()` delegates to it, so there is one source of send authorization and one database round trip rather than stacked preflights. Creation rejection uses a typed `LiveOutboundCreationRejectedError` with a closed reason code; it never includes bound SQL parameters or the claim token.

- [ ] **Step 1: Write RED creation/sender tests**

Cover each reason independently, switch closing after outbox creation, takeover/opt-out after creation, exact claim mismatch, authority downgrade/missing row, stale/legacy authorization, and concurrent duplicate sender claims. Assert provider call count is zero on rejection and terminal rows are not requeued. The trace test follows one turn from ingress through generation/claim, policy reason, V2 stages, authorized plan, outbox and delivery result using IDs/durations only; it rejects phone, message body, prompt, response and raw payload fields.

- [ ] **Step 2: Run RED**

Run:

```bash
npx vitest run src/__tests__/WhatsAppOutboundAuthorization.test.ts src/__tests__/SendMessageJob.test.ts src/__tests__/V2LiveConversationHandler.test.ts
npx vitest run src/__tests__/V2OnlyRuntimeDatabase.test.ts --maxWorkers=1
```

Expected: current sender authorizes authority tuple without all operational gates and still requires Internal Lab binding.

- [ ] **Step 3: Add atomic creation fence**

In `createOutboundMessageAndEnqueue`, permit `authorization_kind='live_stream_reply'` only when the exact tenant authority is >=2, the persisted claim tuple matches, organization is active/auto-enabled/not shadow/demo, and singleton control is open. Keep insert+send-job in the existing atomic SQL transaction. A rejected create throws `LiveOutboundCreationRejectedError`, handled as a V2 closed failure, and creates neither row.

- [ ] **Step 4: Add consolidated sender preflight**

Use one bounded indexed SQL statement keyed by outbound UUID, joining organization, conversation, lead, authority, inbound, stream, claim job, and singleton control. Preserve current category-specific safety for campaigns/reminders/system/manual; apply the complete live preflight only to `live_stream_reply`. Call it immediately before `delivery()` and remove `internalLabDeliveryGuard`/`internalLabBinding` from real delivery payloads.

- [ ] **Step 5: GREEN and commit**

```bash
npx vitest run src/__tests__/WhatsAppOutboundAuthorization.test.ts src/__tests__/SendMessageJob.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/AutomationResponseTrace.test.ts src/__tests__/OutboundSafetyGate.test.ts src/__tests__/OperatorOutboundDelivery.test.ts
npm run test:db:authority
npx eslint src/application/ports/live-outbound-preflight.ts src/infrastructure/repositories/drizzle-live-outbound-preflight.ts src/infrastructure/repositories/drizzle-outbound-message-store.ts src/application/jobs/send-message-job.ts src/application/conversation-v2/v2-live-conversation-handler.ts
npm run typecheck
git diff --check
git add src/application/ports/live-outbound-preflight.ts src/infrastructure/repositories/drizzle-live-outbound-preflight.ts src/infrastructure/repositories/drizzle-outbound-message-store.ts src/application/jobs/send-message-job.ts src/infrastructure/repositories/drizzle-outbound-safety-context-reader.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/__tests__/WhatsAppOutboundAuthorization.test.ts src/__tests__/SendMessageJob.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/AutomationResponseTrace.test.ts src/__tests__/V2OnlyRuntimeDatabase.test.ts
git commit -m "feat(v2): revalidate live authority at outbox and send"
```

---

### Task 6: Bound V2 retries and terminate in safe reply or handoff

**Files:**
- Create: `src/application/conversation-v2/v2-terminal-failure-policy.ts`
- Create: `src/infrastructure/repositories/drizzle-v2-terminal-handoff-store.ts`
- Modify: `src/application/jobs/drain-message-process-queue.ts`
- Modify: `src/application/jobs/drain-message-send-queue.ts`
- Modify: `src/infrastructure/repositories/drizzle-inbound-event-store.ts`
- Modify: `src/infrastructure/repositories/drizzle-whatsapp-stream-authority.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/__tests__/DrainMessageProcessQueue.test.ts`, `src/__tests__/DrainMessageSendQueue.test.ts`, `src/__tests__/ScheduledBurstDebounceE2E.test.ts`, `src/__tests__/V2OnlyRuntimeDatabase.test.ts`

**Interfaces:**
- Produces `resolveV2TerminalFailure({ attempt, maxAttempts, effectState, safeReplyState })` returning `retry_same_turn`, `complete_safe_reply`, or `handoff_required`.
- Produces `markTerminalHandoff({ clinicId, inboundEventId, reason, now })`, idempotently setting only the matching conversation `ai_paused=true`, `needs_attention=true` and a sanitized reason.

- [ ] **Step 1: Write RED retry-state tests**

Cover failure before composition, after composition, after persisted ActionResult, during atomic outbox, after provider acceptance/before acknowledgement, third process failure, tenth send failure, stale lease recovery, and duplicate retry. Assert no new claim token, effect, response plan, outbound, or provider call is created on retry.

- [ ] **Step 2: Run RED**

Run:

```bash
npx vitest run src/__tests__/DrainMessageProcessQueue.test.ts src/__tests__/DrainMessageSendQueue.test.ts src/__tests__/ScheduledBurstDebounceE2E.test.ts
npx vitest run src/__tests__/V2OnlyRuntimeDatabase.test.ts --maxWorkers=1
```

Expected: process jobs still default to 10 and terminal failure does not durably hand off.

- [ ] **Step 3: Persist exact budgets and terminal transition**

Both ingress job-insert paths explicitly write `max_attempts=3`; send jobs explicitly retain `10`. On process terminal failure, mark the inbound failed and call `markTerminalHandoff` before leaving the job `dead`. If that handoff write fails, leave the job retryable at the same attempt boundary and alert; do not silently dead-letter without a terminal resolution.

- [ ] **Step 4: Preserve post-effect semantics**

The same settled claim remains authoritative across retry. Persisted ActionResult/receipt and deterministic outbox key are re-read; an existing outbox is returned. Provider-accepted `sent` remains terminal even when job acknowledgement fails.

- [ ] **Step 5: GREEN and commit**

```bash
npx vitest run src/__tests__/DrainMessageProcessQueue.test.ts src/__tests__/DrainMessageSendQueue.test.ts src/__tests__/ScheduledBurstDebounceE2E.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/SendMessageJob.test.ts
npm run test:db:authority
npx eslint src/application/conversation-v2/v2-terminal-failure-policy.ts src/infrastructure/repositories/drizzle-v2-terminal-handoff-store.ts src/application/jobs/drain-message-process-queue.ts src/application/jobs/drain-message-send-queue.ts
npm run typecheck
git diff --check
git add src/application/conversation-v2/v2-terminal-failure-policy.ts src/infrastructure/repositories/drizzle-v2-terminal-handoff-store.ts src/application/jobs/drain-message-process-queue.ts src/application/jobs/drain-message-send-queue.ts src/infrastructure/repositories/drizzle-inbound-event-store.ts src/infrastructure/repositories/drizzle-whatsapp-stream-authority.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/__tests__/DrainMessageProcessQueue.test.ts src/__tests__/DrainMessageSendQueue.test.ts src/__tests__/ScheduledBurstDebounceE2E.test.ts src/__tests__/V2OnlyRuntimeDatabase.test.ts
git commit -m "feat(v2): bound retries and persist terminal handoff"
```

---

### Task 7: Remove live approval/engine-selection reachability and align tools

**Files:**
- Modify: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Modify: `src/application/jobs/send-message-job.ts`
- Modify: `scripts/run-systemops-lab-personas.ts`, `scripts/verify-systemops-lab.ts`, `scripts/render-systemops-lab-evidence.ts`
- Modify: `src/application/labs/systemops-lab-readiness.ts`
- Modify: `src/__tests__/V2OnlyRuntimeArchitecture.test.ts`, `src/__tests__/SystemOpsLabReadiness.test.ts`, `src/__tests__/SystemOpsLabPersonaRunner.test.ts`, `src/__tests__/InternalLabSyntheticDelivery.test.ts`
- Preserve disconnected: approval, comparison, replay, V1 and shadow source files not imported by production roots.

**Interfaces:**
- Runtime tools consume authority >=2, runtime control, tenant config digest, channel readiness, and V2 trace evidence; no build-bound approval.

- [ ] **Step 1: Write RED architecture/tool tests**

Assert production transitive graph has zero engine policy, approval, V1, shadow, or `internalLabBinding` symbols. Assert readiness says live only for active+authority2+switch-open and does not require engine/approval/build digests.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/__tests__/V2OnlyRuntimeArchitecture.test.ts src/__tests__/SystemOpsLabReadiness.test.ts src/__tests__/SystemOpsLabPersonaRunner.test.ts src/__tests__/InternalLabSyntheticDelivery.test.ts`

- [ ] **Step 3: Refactor tools without weakening replay**

Remove obsolete live inputs and environment reads. Keep synthetic delivery authorization scoped to replay adapters and explicit synthetic addresses. Preserve signed corpus/replay artifacts as quality evidence only.

- [ ] **Step 4: GREEN and commit**

```bash
npx vitest run src/__tests__/V2OnlyRuntimeArchitecture.test.ts src/__tests__/SystemOpsLabReadiness.test.ts src/__tests__/SystemOpsLabPersonaRunner.test.ts src/__tests__/InternalLabSyntheticDelivery.test.ts src/__tests__/ConversationV2ApprovedArtifacts.test.ts src/__tests__/ReplayOutboundCapture.test.ts
npx eslint src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts src/application/jobs/send-message-job.ts scripts/run-systemops-lab-personas.ts scripts/verify-systemops-lab.ts scripts/render-systemops-lab-evidence.ts src/application/labs/systemops-lab-readiness.ts
npm run typecheck
git diff --check
git add src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts src/application/jobs/send-message-job.ts scripts/run-systemops-lab-personas.ts scripts/verify-systemops-lab.ts scripts/render-systemops-lab-evidence.ts src/application/labs/systemops-lab-readiness.ts src/__tests__/V2OnlyRuntimeArchitecture.test.ts src/__tests__/SystemOpsLabReadiness.test.ts src/__tests__/SystemOpsLabPersonaRunner.test.ts src/__tests__/InternalLabSyntheticDelivery.test.ts
git commit -m "refactor(v2): disconnect v1 and build approval from live runtime"
```

---

### Task 8: Add auditable rollout controls and canonical documentation

**Files:**
- Create: `scripts/audit-v2-only-rollout.ts`
- Create: `scripts/control-v2-only-rollout.ts`
- Create: `src/__tests__/V2OnlyRolloutCommand.test.ts`
- Create: `docs/operations/v2-only-runtime-rollout.md`
- Modify: `README.md`, `docs/architecture/current.md`, `docs/architecture/sources-of-truth.md`, `docs/operations/change-control.md`, `package.json`

**Interfaces:**
- `audit-v2-only-rollout --clinic-id <uuid>` is read-only and returns sanitized counts/state.
- `control-v2-only-rollout --clinic-id <uuid> --expected-status <status> --next-status <status> --expected-control-version <n> --actor <name> [--apply]` defaults dry-run and changes at most the exact Lab row plus the singleton control row requested by the explicit action.

- [ ] **Step 1: Write RED command tests**

Prove dry-run writes zero rows; wrong UUID/current status/control version fails; cross-tenant snapshots remain byte-equivalent; pause/reactivate each affect exactly one Lab row; switch CAS affects only singleton; output contains counts/digests but no phone/content/payload/URL/credential.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/__tests__/V2OnlyRolloutCommand.test.ts`

- [ ] **Step 3: Implement commands and runbook**

Encode the exact first-cut order from the spec. The audit must report all live tenants; it exits non-zero unless the reviewed set is exactly SystemOpsLab before the first cut. It reports queues/outbounds by status, authority metrics, deployment SHA, control version, and other-tenant change count.

- [ ] **Step 4: GREEN and commit**

```bash
npx vitest run src/__tests__/V2OnlyRolloutCommand.test.ts src/__tests__/SystemOpsLabReadiness.test.ts
npx eslint scripts/audit-v2-only-rollout.ts scripts/control-v2-only-rollout.ts src/__tests__/V2OnlyRolloutCommand.test.ts
npm run typecheck
git diff --check
git add scripts/audit-v2-only-rollout.ts scripts/control-v2-only-rollout.ts src/__tests__/V2OnlyRolloutCommand.test.ts docs/operations/v2-only-runtime-rollout.md README.md docs/architecture/current.md docs/architecture/sources-of-truth.md docs/operations/change-control.md package.json
git commit -m "docs(v2): add v2-only rollout controls and runbook"
```

---

### Task 9: Run full local, database, migration, build, and performance gates

**Files:**
- Modify only if a gate exposes a defect in V2-only scope; create a new focused RED test before correction and commit separately.
- Verify: all files from Tasks 1-8.

**Interfaces:**
- Consumes all prior contracts; produces a clean, reviewable branch and evidence report.

- [ ] **Step 1: Run targeted suites**

```bash
npx vitest run src/__tests__/V2OnlyRuntimeArchitecture.test.ts src/__tests__/V2OnlyAutomationPolicy.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/SendMessageJob.test.ts src/__tests__/ScheduledBurstDebounceE2E.test.ts src/__tests__/V2OnlyRuntimePerformance.test.ts src/__tests__/V2OnlyRolloutCommand.test.ts
npm run test:db:authority
npm run test:db:schema
```

Expected: zero skips in the dedicated embedded authority/config/performance database command.

- [ ] **Step 2: Verify migrations twice**

Apply all migrations to an empty embedded PostgreSQL database, then apply migration 0102 to an isolated database initialized through 0101 with representative runtime-control absence and current authority/outbound rows. Verify row counts/digests unchanged outside the new singleton table. Never use `.env.local` or production/Neon production.

- [ ] **Step 3: Run canonical gates on a clean tree**

Commit any independently proven correction first, then:

```bash
npm run db:check
npm run lint
npm run typecheck
npm test -- --reporter=dot
npm run verify
git diff --check
```

- [ ] **Step 4: Run production build in a disposable clean clone**

Clone the exact HEAD under `/private/tmp/systemops-v2-only-build.XXXXXX`, run `npm ci`, `npm run build`, and `npm run verify`; validate the resolved path prefix before removing only that clone.

- [ ] **Step 5: Run candidate performance and idle gates**

```bash
npm run measure:v2-only-runtime -- --baseline evals/v2-only/runtime-baseline.json
```

For idle Neon, use an authorized disposable branch only: capture 30 minutes after autosuspend eligibility with no requests/jobs, then the same 30-minute window on the candidate. Candidate wake-ups and SQL count must equal baseline; candidate compute-active time may exceed baseline by at most 5 seconds. No production endpoint or credential enters the artifact. Lock contention repeats each stream test 50 times; p95 must meet Task 1.

- [ ] **Step 6: Request review, push, and wait**

Use normal push, open PR to `develop`, wait for Verify, embedded DB, Migration CI, Vercel, and preview comments. Do not merge until all are green and the branch is mergeable. Record migration filename and rollback boundary in the PR.

---

### Task 10: Execute the first V2-only production cutover

**Files:**
- No source changes during rollout.
- Operational evidence: sanitized command output and GitHub/Vercel deployment metadata only.

**Interfaces:**
- Exact tenant: SystemOps Dental Lab, `92fe7ecf-f383-4ddc-8c4e-53271af8e3a0`.
- Expected authority: version 2.
- Actor: `Brendon Walefy`.

- [ ] **Step 1: Merge and promote normally**

Merge focused PR to `develop`, run standard `develop -> main` release PR, wait for all checks, confirm production deployment `READY`, deployed SHA exact, and generated migration applied. Never push directly to main.

- [ ] **Step 2: Audit and pause only the Lab**

Run read-only audit. Require the exact reviewed live-tenant set, authority 2 clean, and zero cross-tenant changes. Dry-run then apply Lab `active -> paused` with expected current state and exactly one affected row. Close global control by expected-version CAS.

- [ ] **Step 3: Drain and prove old runtime isolation**

Drain process/send workers and outbounds. Require zero pending/processing/locked jobs and outbounds for Lab, no pending production jobs globally, production alias on new SHA, old invocations expired, and wake endpoints resolving to the new deployment. Keep switch closed.

- [ ] **Step 4: Validate closed candidate**

Run authority validation, runtime audit, sender preflight rejection sample, and readiness. Require V2 composition, authority 2, zero blocking metrics, no V1 reachability, no provider send, and zero other-tenant writes.

- [ ] **Step 5: Reactivate only the Lab**

Dry-run and apply global control closed->open with expected version; dry-run and apply Lab `paused -> active` with exact UUID and one affected row. Re-audit all other paused/disabled/demo/prospect/no-v2 tenants and require unchanged digests.

- [ ] **Step 6: One real smoke and immediate observation**

Ask the owner to send one WhatsApp message. By metadata only require webhook, one event, correct stream/generation, one claim, `automationMode=live`, one `live_stream_reply`, authorized sender preflight, one `sent`, no duplicates/errors/pending jobs, authority-v2 blocking metrics zero, and latency/performance within the approved gate.

- [ ] **Step 7: Apply first-release rollback if any smoke gate fails**

Close global control by CAS, pause only Lab by CAS, preserve inbox/outbox, handoff, and prepare a forward correction. Do not redeploy V1. A stable V2-only redeploy becomes available only after this release has remained healthy through the observation window.

- [ ] **Step 8: Close the cutover**

Observe 30 minutes for queue age, duplicate sends, authorization rejection, provider errors, handoff rate, lock wait, model calls/tokens, and Neon compute-active time. Report exact SHA, control version, Lab authority/status, smoke latency, and zero other-tenant changes.

---

## Planned commit sequence

1. `test(v2): freeze v1 and v2 runtime performance baseline`
2. `feat(v2): add durable global live outbound control`
3. `feat(v2): require authority v2 for live automation`
4. `feat(v2): make v2 the sole conversation runtime`
5. `feat(v2): revalidate live authority at outbox and send`
6. `feat(v2): bound retries and persist terminal handoff`
7. `refactor(v2): disconnect v1 and build approval from live runtime`
8. `docs(v2): add v2-only rollout controls and runbook`
9. Additional commits are allowed only for a newly reproduced V2-only defect, one RED/GREEN correction per commit; rollout itself creates no commit.

## Self-review against the approved specification

| Requirement | Executable coverage |
| --- | --- |
| V2-only, no V1 fallback or engine config | Tasks 4 and 7 transitive import gate, direct composition, readiness/tool cleanup |
| authority version >=2 and tenant-scoped future CAS | Tasks 3, 5, 8 and 10 |
| global fail-closed creation/delivery kill switch | Tasks 2, 3, 5, 8 and 10 |
| sender-time exact authority and operational revalidation | Task 5 unit + embedded PostgreSQL concurrency tests |
| first rollout ordering and no old worker/build | Tasks 8 and 10 |
| retry budgets, terminal safe reply/handoff, no recomposed effects | Task 6 |
| V1/V2 latency, model, token, SQL, lock, cardinality and idle-Neon gates | Tasks 1 and 9 |
| paused/disabled/demo/prospect/no-v2 tenants unchanged | Tasks 3, 8 and 10 cross-tenant snapshots |
| capability parity without copying V1 conditionals | Task 4 parity matrix and journey test |
| traceability without sensitive content | Tasks 3 and 5 trace tests |
| generated migration only and non-destructive first cut | Task 2 generation/inspection and Task 9 empty/current-schema migration tests |
| first-cut rollback is switch/handoff/forward fix | Task 10, with stable V2-only redeploy enabled only after healthy observation |

Self-review result: every normative section of the specification maps to at least one RED/GREEN task and one final gate. Placeholder scan is empty. Shared type names are defined once in Tasks 1, 2, 3, 5 and 6 and consumed with the same names later. The only schema expansion is `conversation_runtime_control`; no V1 field is dropped during this cut.

## Stop boundaries

Stop execution only for destructive generated SQL, real cross-tenant mutation risk/evidence, a real duplicate provider send, irreversible data loss, inability to preserve post-effect idempotence, or a product decision outside this specification. Ordinary stale tests, lint, type errors, CI environment issues, preview failures, and scoped implementation defects are diagnosed and corrected with a new RED test without abandoning the plan.
