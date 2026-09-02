# V2 Proactive Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every existing proactive producer behind one V2-only creation and delivery authority, with sender-owned canonical history and one trace identity.

**Architecture:** Preserve the existing follow-up, reminder, campaign, recovery and operational producers. Add a narrow V2 policy factory, close their payload envelope, strengthen the existing atomic outbox statement and final sender preflight, and let the sender persist canonical history only after authorization. No new engine, schema, worker, polling or V1 path.

**Tech Stack:** TypeScript, Zod, Vitest, Drizzle ORM, embedded PostgreSQL, Next.js runtime.

**Spec:** `docs/superpowers/specs/2026-09-02-v2-proactive-automation-design.md`

## Global constraints

- V1 is historical only; never import, execute or configure it.
- Every proactive live send requires authority version 2 at creation and delivery.
- Preserve producer-specific business/content ownership; do not centralize editorial rules.
- Human manual and system outbounds remain valid and outside this proactive policy.
- No migration, polling, heartbeat, worker or idle database activity.
- Run RED → GREEN → refactor and commit every task independently.

---

### Task 1: Close the proactive payload and trace contract

**Files:**
- Modify: `src/application/jobs/conversation-outbound-payload.ts`
- Create: `src/application/automation/proactive-outbound.ts`
- Modify: `src/core/conversation/automation-response-trace.ts`
- Test: `src/__tests__/AutomationOutboundPayload.test.ts`
- Test: `src/__tests__/AutomationResponseTrace.test.ts`

**Interfaces:**
- Produces: closed proactive kinds/categories, stable `turnId`, and `agentMessagePersistence: "sender"`.
- Preserves: compatibility parsing for already queued historical payloads.

- [ ] Add RED tests for all five kinds, wrong category, missing new-producer fields, stable trace identity and sanitized metadata.
- [ ] Run the two tests and require failure only on the missing envelope contract.
- [ ] Implement the minimal helper/schema additions and reuse one closed kind registry.
- [ ] Run GREEN, typecheck and file-scoped ESLint; remove duplicate kind sets.
- [ ] Commit: `feat(v2): close proactive outbound envelopes`

### Task 2: Reuse one V2 producer policy

**Files:**
- Create: `src/infrastructure/automation/create-v2-automation-policy.ts`
- Modify: the five cron routes under `src/app/api/cron/`
- Modify: `src/application/reactivation/dispatch-campaign.ts`
- Modify: `src/application/conversations/enqueue-no-show-recovery.ts`
- Modify: `src/app/(clinic)/app/inbox/recovery-actions.ts`
- Test: `src/__tests__/V2ProactiveProducerPolicy.test.ts`
- Test: existing follow-up/reminder/recovery/campaign tests.

**Interfaces:**
- Consumes: `V2OnlyAutomationPolicy` and existing Drizzle readers.
- Produces: one fail-closed producer guard before composition or persistence.

- [ ] Add RED tests proving authority<2, inactive, disabled, shadow/demo and global kill switch stop every producer without side effects.
- [ ] Implement the narrow policy factory and replace legacy three-flag checks.
- [ ] Keep tenant-specific rule/content selection after the guard; do not instantiate OpenAI/runtime to evaluate policy.
- [ ] Run GREEN, typecheck and ESLint.
- [ ] Commit: `feat(v2): gate proactive producers with v2 authority`

### Task 3: Strengthen atomic outbox creation

**Files:**
- Modify: `src/infrastructure/repositories/drizzle-outbound-message-store.ts`
- Modify: `src/application/ports/outbound-message-store.ts` if type narrowing is required.
- Test: `src/__tests__/V2ProactiveOutboundAuthorizationDatabase.test.ts`
- Modify: `package.json`
- Modify: `src/__tests__/DatabaseTestCommandIsolation.test.ts`

**Interfaces:**
- Consumes: persisted envelope, clinic, authority, global control, lead and conversation.
- Produces: all-or-nothing outbox + send job or a closed denial reason.

- [ ] Add RED PostgreSQL cases for all five kinds, each policy gate, category mismatch and cross-tenant bindings.
- [ ] Extend the existing bounded SQL transaction; share-lock global control for live reply and proactive creation.
- [ ] Require current authority>=2 and exact lead/conversation ownership before insert.
- [ ] Register the suite in `test:db:authority`, ordinary-test exclusions and exact no-skip contract.
- [ ] Run direct DB GREEN and the authority suite with zero skips.
- [ ] Commit: `feat(v2): authorize proactive outboxes atomically`

### Task 4: Move canonical history behind sender authorization

**Files:**
- Modify: `src/application/jobs/send-message-job.ts`
- Modify: proactive producers from Task 2.
- Test: `src/__tests__/SendMessageJob.test.ts`
- Test: producer outbox tests.

**Interfaces:**
- Consumes: `agentMessagePersistence: "sender"` and stable `turnId`.
- Produces: exactly one canonical agent message after final preflight.

- [ ] Add RED tests proving denial leaves no message, success creates one exact message, and crash/retry reuses it.
- [ ] Implement sender-owned creation using the same idempotent placeholder rules as live replies.
- [ ] Remove preauthorization agent-message inserts from every new proactive producer.
- [ ] Preserve the historical payload branch only for draining old queued jobs.
- [ ] Run GREEN, typecheck and ESLint.
- [ ] Commit: `feat(v2): persist proactive history after authorization`

### Task 5: Revalidate all controls at provider delivery

**Files:**
- Modify: `src/infrastructure/repositories/drizzle-live-outbound-preflight.ts`
- Modify: `src/infrastructure/repositories/drizzle-outbound-safety-context-reader.ts`
- Modify: `src/application/channel-safety/outbound-safety-gate.ts`
- Test: `src/__tests__/V2ProactiveOutboundAuthorizationDatabase.test.ts`
- Test: `src/__tests__/SendMessageJob.test.ts`

**Interfaces:**
- Produces: final fail-closed decision for authority, exact bindings, tenant state, global switch, consent, takeover and safety.

- [ ] Add RED cases where each state changes after enqueue and before provider call.
- [ ] Block explicit opt-out for every proactive category; keep reminder exemption only for quiet hours/caps.
- [ ] Keep engagement-specific takeover/obsolescence rules explicit; freeze and kill switch block all proactive kinds.
- [ ] Implement one bounded indexed preflight with no provider call on denial.
- [ ] Run GREEN, direct database suite, typecheck and ESLint.
- [ ] Commit: `feat(v2): revalidate proactive delivery safely`

### Task 6: Complete producer trace and exactly-once behavior

**Files:**
- Modify: every proactive producer listed in Task 2.
- Modify: `src/application/jobs/send-message-job.ts`
- Modify: `src/core/conversation/automation-response-trace.ts`
- Test: `src/__tests__/V2ProactiveTraceMatrix.test.ts`
- Test: existing producer and sender suites.

**Interfaces:**
- Produces: one stable trace from eligibility through terminal send/denial for every category.

- [ ] Add RED matrix assertions for plan, validation, outbox, preflight and terminal delivery sharing one `turnId`.
- [ ] Record only IDs, reason codes, category, counts and timestamps; reject phone/content/provider payload in trace metadata.
- [ ] Prove duplicate producer execution and sender retry do not duplicate message, outbox, job or send.
- [ ] Run GREEN, privacy trace tests, typecheck and ESLint.
- [ ] Commit: `feat(v2): trace proactive delivery end to end`

### Task 7: Close PostgreSQL, parity and performance contracts

**Files:**
- Modify: `docs/architecture/v2-capability-parity.md`
- Modify: `src/__tests__/ConversationV2JourneyMatrix.test.ts`
- Modify: `src/__tests__/V2RuntimePerformanceRegression.test.ts`
- Modify: `src/__tests__/WhatsAppStreamPerformance.test.ts`
- Test: `src/__tests__/V2ProactiveOutboundAuthorizationDatabase.test.ts`

- [ ] Add RED matrix/performance expectations for all categories, no table scan, bounded query count, lock p95<=20 ms and no idle activity.
- [ ] Repeat concurrent creation/preflight tests and prove exact tenant isolation and lifetime dedupe.
- [ ] Mark proactive parity green only after all producers use the closed envelope and gates.
- [ ] Run GREEN and `npm run measure:v2-only-runtime -- --baseline evals/v2-only/runtime-baseline.json`; require `violations: []`.
- [ ] Commit: `test(v2): close proactive automation parity`

### Task 8: Final verification and delivery

- [ ] Run all producer, sender, safety, authority, trace and schema tests.
- [ ] Run `npm run test:db:authority` with every test executed and zero skipped.
- [ ] Obtain a clean tree and run exact `npm run verify`, `npm run test:db:schema` and `git diff --check`.
- [ ] Build exact HEAD in a disposable clean clone with local `node_modules`; confirm tracked cleanliness and remove only the validated temporary directory.
- [ ] Push normally, open a focused PR to `develop`, wait for all checks and merge normally.
- [ ] Open the standard `develop` to `main` release PR, wait for all checks, merge normally and require Vercel READY at exact SHA.
- [ ] Confirm unchanged migrations, no tenant activation, no synthetic send and no idle worker. Preserve the worktree for review corrections.
