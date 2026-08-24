# Scheduled Burst Debounce — Durable Stream Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace split debounce authority with durable tenant-scoped WhatsApp streams that make ingress, generation, conversation binding, claim/retry, canonical history, outbox authorization, and sender validation idempotent and crash-safe.

**Architecture:** PostgreSQL owns identity and settlement. One statement records a provider delivery, converges aliases, serializes a stream generation, and creates its uniquely deduped job. Claim settles authority; canonical history keeps database order across retained streams; outbox and sender validate a persisted authorization tuple without revoking post-claim work when newer ingress arrives.

**Tech Stack:** TypeScript, Node `crypto`, Drizzle ORM, PostgreSQL/Neon, generated Drizzle migrations, Vitest, embedded/disposable PostgreSQL.

**Spec:** [`docs/superpowers/specs/2026-08-24-scheduled-burst-debounce-design.md`](../specs/2026-08-24-scheduled-burst-debounce-design.md)

## Global Constraints

- Work only in `/Users/brendonwalefy/Dev/Projetos/_systemops-eval/debounce` and preserve the existing PR #306 branch/worktree history.
- Preserve the existing red files `src/__tests__/ScheduledBurstDebounceE2E.test.ts` and `src/__tests__/ScheduledBurstDebounceDatabase.test.ts`; extend coverage in focused files unless an accepted test must be wired to a production interface.
- Do not use `.env.local` for verification or database tests. Authority tests use embedded loopback PostgreSQL. The optional calendar database suite alone may use an authorized disposable `.env.test.local` host after proving it differs from production.
- Do not write production data, change Neon production, modify Harness evidence, push, merge, deploy, or promote `develop` without new human authorization.
- Author schema in `src/infrastructure/db/schema.ts`, run `npm run db:generate`, inspect generated SQL, and never hand-author migration SQL.
- PostgreSQL `bigint` generations map to TypeScript `number`; enforce integer range `0..9007199254740991`; never put JavaScript `bigint` in JSON.
- Every phase follows RED → GREEN → refactor and ends with the exact independently reviewable commit listed below.
- The schema migration in this PR is expand-only for historical tables. Contract nullability/check changes are a later separately approved migration.

---

## Exact file map

| Responsibility | Files |
|---|---|
| Schema and generated metadata | `src/infrastructure/db/schema.ts`, generated `drizzle/*.sql`, generated `drizzle/meta/*` |
| Provider/test command | `package.json` |
| Alias normalization | `src/core/whatsapp/WhatsAppContactIdentity.ts` |
| Token generation/digest | `src/application/jobs/inbound-claim-token.ts` (new) |
| Event registration port | `src/application/ports/inbound-event-store.ts` |
| Atomic ingress | `src/infrastructure/repositories/drizzle-inbound-event-store.ts`, `src/application/whatsapp/persist-inbound-event.ts` |
| Stream binding/repair port | `src/application/ports/whatsapp-stream-authority.ts` (new) |
| Stream binding/repair repository | `src/infrastructure/repositories/drizzle-whatsapp-stream-authority.ts` (new) |
| Job claim port/repository | `src/application/ports/job-queue.ts`, `src/infrastructure/repositories/drizzle-job-queue.ts` |
| Worker flow | `src/application/jobs/drain-message-process-queue.ts`, `src/application/jobs/process-message-job.ts` |
| Orphan reconciliation | `src/application/jobs/reconcile-message-job-orphans.ts`, `src/application/ports/message-job-orphan-reader.ts`, `src/infrastructure/repositories/drizzle-message-job-orphan-reader.ts`, `src/app/api/cron/message-worker/route.ts` |
| Canonical message registration/order | `src/application/use-cases/leads/register-incoming-message.ts`, `src/application/conversation/register-inbound-history.ts` (new), `src/infrastructure/repositories/drizzle-conversation-repository.ts`, `src/application/inbox/list-messages.ts` |
| Live lifecycle | `src/application/conversation/live-turn-lifecycle.ts`, `src/core/pipeline/ConversationOrchestrator.ts`, `src/application/conversation-v2/v2-live-conversation-handler.ts` |
| Outbox | `src/application/ports/outbound-message-store.ts`, `src/application/jobs/enqueue-outbound-message.ts`, `src/infrastructure/repositories/drizzle-outbound-message-store.ts` |
| Sender | `src/application/jobs/send-message-job.ts`, `src/app/api/cron/sender-worker/route.ts` |
| Explicit outbound callers | `src/app/api/conversations/[conversationId]/send/route.ts`, `src/app/api/conversations/[conversationId]/pipeline-actions/route.ts`, `src/application/conversations/confirm-deposit-decision.ts`, `src/app/api/cron/appointment-reminder/route.ts`, `src/app/api/cron/deposit-expiry-sweep/route.ts`, `src/app/api/cron/follow-up-dispatcher/route.ts`, `src/app/api/cron/post-appointment-followup/route.ts`, `src/application/reactivation/dispatch-campaign.ts`, `src/app/api/cron/recovery-campaign/route.ts`, `src/app/(clinic)/app/inbox/recovery-actions.ts`, `src/application/conversations/enqueue-no-show-recovery.ts` |
| Authority activation | `src/application/ports/conversation-authority-store.ts` (new), `src/infrastructure/repositories/drizzle-conversation-authority-store.ts` (new) |
| Operations | `scripts/backfill-whatsapp-stream-authority.ts` (new), `scripts/validate-whatsapp-stream-authority.ts` (new), `scripts/cleanup-whatsapp-stream-authority.ts` (new), `scripts/activate-whatsapp-stream-authority.ts` (new), `docs/operations/whatsapp-stream-authority-rollout.md` (new) |
| Purge | `src/app/api/owner/clinics/[clinicId]/purge/route.ts`, `scripts/check-purge-coverage.ts` |
| Existing red gate | `src/__tests__/ScheduledBurstDebounceE2E.test.ts`, `src/__tests__/ScheduledBurstDebounceDatabase.test.ts` |
| Focused tests | `src/__tests__/WhatsAppStreamSchema.test.ts`, `src/__tests__/WhatsAppStreamIngress.test.ts`, `src/__tests__/WhatsAppStreamClaim.test.ts`, `src/__tests__/WhatsAppStreamHistory.test.ts`, `src/__tests__/WhatsAppOutboundAuthorization.test.ts`, `src/__tests__/WhatsAppAuthorityActivation.test.ts`, `src/__tests__/WhatsAppStreamPerformance.test.ts` (all new) |

## Exact interfaces

Define these names once and use them throughout. `clinicId` remains the application name for database `organization_id`.

```ts
export type StreamGeneration = number;

export type StreamAliasInput = Readonly<{
  kind: "phone" | "whatsapp_lid" | "provider_thread";
  providerScope: string;
  normalizedValue: string;
}>;

export type InboundAuthorityTuple = Readonly<{
  streamId: string;
  streamGeneration: StreamGeneration;
  inboundEventId: string;
}>;

export type RegisterInboundAuthorityInput = Readonly<{
  clinicId: string;
  provider: "meta_cloud_api" | "z_api";
  providerMessageId: string;
  conversationKey: string;
  aliases: readonly StreamAliasInput[];
  payload: unknown;
  normalizedText: string | null;
  mediaType: string | null;
  dedupeKey: string;
  receivedAt: Date;
}>;

export type InboundRegistrationResult =
  | (InboundAuthorityTuple & Readonly<{
      outcome: "registered";
      jobId: string;
      eventWasNew: boolean;
      jobWasNew: boolean;
    }>)
  | Readonly<{
      outcome: "identity_conflict";
      inboundEventId: string;
      jobId: null;
      eventWasNew: boolean;
      jobWasNew: false;
    }>;

export type ClaimedInboundWork = InboundAuthorityTuple & Readonly<{
  outcome: "claimed";
  job: JobRecord;
  claimToken: string;
}>;

export type HistoryOnlyInboundWork = InboundAuthorityTuple & Readonly<{
  outcome: "history_only";
  job: JobRecord;
}>;

export type ClaimInboundWorkResult = ClaimedInboundWork | HistoryOnlyInboundWork | null;

export interface InboundEventStore {
  recordInboundEventAndEnqueue(
    input: RegisterInboundAuthorityInput,
  ): Promise<InboundRegistrationResult>;
  findInboundEvent(id: string): Promise<InboundEvent | null>;
  markInboundEventProcessing(id: string): Promise<void>;
  markInboundEventPending(id: string): Promise<void>;
  markInboundEventProcessed(id: string, processedAt?: Date): Promise<void>;
  markInboundEventFailed(id: string): Promise<void>;
  markInboundEventIgnored(id: string, processedAt?: Date): Promise<void>;
}

// Added to the existing JobQueue interface; its other methods remain unchanged.
export interface InboundJobClaim {
  claimNextInboundWork(input: {
    workerId: string;
    now?: Date;
  }): Promise<ClaimInboundWorkResult>;
}

export type BindStreamToConversationInput = InboundAuthorityTuple & Readonly<{
  clinicId: string;
  conversationId: string;
  now: Date;
}>;

export type BindStreamToConversationResult = Readonly<{
  authoritativeStreamId: string;
  retainedEventStreamId: string;
  retiredCurrentStream: boolean;
  conversationStreamOrder: StreamGeneration;
}>;

export type RepairInboundAuthorityJobInput = Readonly<{
  inboundEventId: string;
  now: Date;
  olderThan: Date;
}>;

export type RepairInboundAuthorityJobResult = Readonly<{
  outcome: "created" | "rebound" | "ineligible";
  jobId: string | null;
}>;

export interface WhatsAppStreamAuthority {
  bindStreamToConversation(
    input: BindStreamToConversationInput,
  ): Promise<BindStreamToConversationResult>;
  repairInboundAuthorityJob(
    input: RepairInboundAuthorityJobInput,
  ): Promise<RepairInboundAuthorityJobResult>;
}

export type InboundHistoryInput = InboundAuthorityTuple & Readonly<{
  clinicId: string;
  phone: string;
  whatsappLid: string | null;
  senderName: string | null;
  senderPhoto: string | null;
  externalThreadId: string;
  body: string;
  mediaUrl: string | null;
  mediaType: "image" | "video" | "audio" | "document" | null;
  receivedAt: Date;
  externalId: string;
}>;

export type PreparedInboundHistory = Readonly<{
  messageInserted: boolean;
  lead: Lead;
  conversation: Conversation;
  message: Message;
}>;

export type ConversationAuthorityVersion = 0 | 1 | 2 | 3;

export interface ConversationAuthorityStore {
  getVersion(clinicId: string): Promise<ConversationAuthorityVersion>;
  compareAndSetVersion(input: Readonly<{
    clinicId: string;
    expectedVersion: ConversationAuthorityVersion;
    nextVersion: ConversationAuthorityVersion;
    actor: string;
    now: Date;
  }>): Promise<boolean>;
}
```

`ConversationAuthorityStore.getVersion` returns `0` when no row exists. `compareAndSetVersion` inserts version 1 when `expectedVersion` is 0 and otherwise performs an update guarded by the expected version; it rejects downgrades before SQL execution.

The outbox input is discriminated so a live reply cannot compile without the raw in-memory claim token, while persisted rows expose only a digest:

```ts
export type NonLiveAuthorizationKind =
  | "follow_up"
  | "reminder"
  | "campaign"
  | "human_manual"
  | "operational"
  | "system"
  | "recovery"
  | "legacy";

export type OutboundAuthorizationInput =
  | Readonly<{
      kind: "live_stream_reply";
      streamId: string;
      streamGeneration: StreamGeneration;
      sourceInboundEventId: string;
      claimJobId: string;
      claimToken: string;
    }>
  | Readonly<{
      kind: NonLiveAuthorizationKind;
    }>;

export type PersistedOutboundAuthorization = Readonly<{
  kind: "live_stream_reply" | NonLiveAuthorizationKind;
  streamId: string | null;
  streamGeneration: StreamGeneration | null;
  sourceInboundEventId: string | null;
  claimJobId: string | null;
  claimTokenDigest: string | null;
  authorityVersion: number | null;
}>;
```

`src/application/jobs/inbound-claim-token.ts` exports exactly:

```ts
export type GeneratedInboundClaimToken = Readonly<{ token: string; digest: string }>;
export function generateInboundClaimToken(): GeneratedInboundClaimToken;
export function digestInboundClaimToken(token: string): string;
```

Implementation uses `randomBytes(32).toString("base64url")` and SHA-256 base64url from `node:crypto`.

## Phase 1 — Preserve and wire the RED gate

**Files:** modify `package.json`, `.github/workflows/ci.yml`, and the embedded-database lifecycle in `src/__tests__/ScheduledBurstDebounceDatabase.test.ts`; preserve both scheduled-burst regression suites; add `src/__tests__/DatabaseTestCommandIsolation.test.ts`; create no production authority behavior.

- [ ] **RED:** Run `npm test -- src/__tests__/ScheduledBurstDebounceE2E.test.ts`. Preserve all eleven cases: t0/t5/t16, post-quiet B reply, B after A claim, concurrent generations, unknown-alias convergence, multiple-active conflict, provider duplicate, reversed timestamps, retry token, independent streams, and five-message burst. Record the accepted authority failures and the passing semantic-model test.
- [ ] **RED:** Run the existing authority suite against its authorized disposable database without printing credentials. Require zero skips and failures only for missing stream/claim authority. Add a command-isolation contract test that fails on the shared process/lifecycle.
- [ ] **GREEN:** Split the adapters into exact commands:

```json
"test": "vitest run --exclude src/__tests__/ScheduledBurstDebounceDatabase.test.ts",
"test:db": "npm run test:db:authority",
"test:db:calendar": "dotenv -e .env.test.local -- vitest run src/__tests__/calendar-import.test.ts",
"test:db:authority": "vitest run src/__tests__/ScheduledBurstDebounceDatabase.test.ts"
```

- [ ] **GREEN:** Make the authority suite provision and terminate embedded PostgreSQL on a collision-safe loopback port, validate that host through `resolveTestDatabaseAccess`, apply current migrations, clean up through `finally`, print no credentials/URLs, and use no skip gate. Add `npm run test:db:authority` as a separate CI step with loopback-only `DATABASE_URL`/`TEST_DATABASE_HOST` and an explicitly different `PRODUCTION_DATABASE_HOST`. Do not weaken the calendar guard.
- [ ] **GREEN:** Run the command-isolation and database-policy tests, calendar unit tests without external database access, then `npm run test:db:authority`; confirm all three authority database cases execute with zero skips and only the accepted missing-authority failures. `npm run test:db:calendar` remains optional/manual and requires an authorized disposable Neon branch; never fall back to `.env.local` or production.
- [ ] **REFACTOR:** Run `npx eslint src/__tests__/DatabaseTestCommandIsolation.test.ts src/__tests__/ScheduledBurstDebounceE2E.test.ts src/__tests__/ScheduledBurstDebounceDatabase.test.ts` and `npm run typecheck`; do not weaken assertions or add skips.
- [ ] **COMMIT:** Stage only the approved documents, test command/CI wiring, embedded lifecycle, and accepted regression files.

**Commit:** `test(pr306): wire durable authority red gate`

## Phase 2 — Durable expand schema

**Files:** modify `src/infrastructure/db/schema.ts`; create generated `drizzle/*.sql` and `drizzle/meta/*`; create `src/__tests__/WhatsAppStreamSchema.test.ts`.

- [ ] **RED:** Add schema-contract assertions for every field, enum, FK, check, and named index in Spec §3. Assert `jobs.queue`, the preserved `jobs_queue_dedupe_key_idx`, unconditional outbound authority uniqueness, nullable historical authority fields, and no JavaScript-bigint mapping.
- [ ] **RED:** Run `npm test -- src/__tests__/WhatsAppStreamSchema.test.ts`; expect missing schema declarations.
- [ ] **GREEN:** Add `check` and `foreignKey` to the `drizzle-orm/pg-core` imports, then add enums, `whatsapp_streams`, `whatsapp_stream_aliases`, `conversation_authority`, nullable historical columns, composite conversation/tenant binding, safe-number checks, delete actions, and all exact indexes from Spec §3 to `schema.ts`.
- [ ] **GREEN:** Transition provider uniqueness with two generated migrations: first add `inbound_events_org_provider_message_unique` while retaining the old global index; then remove `inbound_events_provider_message_unique` from `schema.ts` and generate the second migration. This guarantees the scoped unique exists before the global one is dropped without hand-editing SQL.
- [ ] **GREEN:** Keep all authority references added to existing tables nullable. Do not generate historical `NOT NULL` or row-kind consistency checks in this PR.
- [ ] **GREEN:** Run `npm run db:generate` for each schema snapshot, inspect dependency order, and ensure generated SQL creates referenced tables/unique keys before FKs. Circular nullable FKs (`streams.latest_inbound_event_id`, `events.claim_job_id`, `jobs.inbound_event_id`) must appear as generated `ALTER TABLE` operations after both sides exist.
- [ ] **GREEN:** Apply all current migrations to a fresh disposable database via the existing migration setup in `ScheduledBurstDebounceDatabase.test.ts`, then query `pg_constraint` and `pg_indexes` in `WhatsAppStreamSchema.test.ts`.
- [ ] **REFACTOR:** Run `npm run db:check`, the schema test, `npm run test:db:authority`, ESLint, and typecheck. Review generated SQL for table rewrites, accidental non-null changes, destructive data operations, and missing indexes.

**Commit:** `feat(pr306): add durable stream authority expand schema`

**Rollback boundary:** Before compatibility code, revert both generated expand migrations and schema declarations only on databases where they have not been activated. Do not contract historical data.

## Phase 3 — Atomic ingress and conversation binding

**Files:** modify `src/core/whatsapp/WhatsAppContactIdentity.ts`, `src/application/ports/inbound-event-store.ts`, `src/infrastructure/repositories/drizzle-inbound-event-store.ts`, `src/application/whatsapp/persist-inbound-event.ts`, `src/application/use-cases/leads/register-incoming-message.ts`, `src/application/conversation/live-turn-lifecycle.ts`; create `src/application/ports/whatsapp-stream-authority.ts`, `src/infrastructure/repositories/drizzle-whatsapp-stream-authority.ts`, `src/__tests__/WhatsAppStreamIngress.test.ts`.

- [ ] **RED:** Add phone/LID/provider-thread normalization tests, including exact provider scopes and missing-instance rejection.
- [ ] **RED:** Add real PostgreSQL tests for one physical event insertion, scoped provider duplicate detection, cross-organization same message id, concurrent unknown alias, active-plus-provisional convergence, multiple-active `identity_conflict`, transaction rollback, stable generation across alias changes, and simultaneous binding to one conversation.
- [ ] **RED:** Add binding assertions: exactly one active stream per conversation, losing streams retained/retired, aliases moved to the winner, claimed loser events unchanged, unclaimed loser events history-only, and monotonic `conversation_stream_order`.
- [ ] **GREEN:** Extend `RecordInboundEventInput`, `InboundEvent`, and `RecordInboundEventAndEnqueueResult` using the exact registration contracts above. Make `recordInboundEventAndEnqueue` mandatory, remove the non-atomic `recordInboundEvent` production method/fallback, and update in-memory fakes to implement the atomic contract. Use `number` for every generation.
- [ ] **GREEN:** Implement one `db.execute(sql\`...\`)` statement with these CTE stages and no second event insert. Join `organizations` inside the statement and derive the quiet boundary from `message_debounce_ms ?? DEFAULT_MESSAGE_DEBOUNCE_MS`; set the new job's `run_at` to that boundary.

```sql
ledger_event
provisional_stream
inserted_aliases
alias_winners
active_winners
selected_stream
retired_candidates
assigned_generation
authorized_event
persisted_job
conflicted_event
final_result
```

`ledger_event` performs the sole `INSERT ... ON CONFLICT (organization_id, provider, provider_message_id)`. All later CTEs are gated on an unresolved returned ledger row. `conflicted_event` writes `identity_conflict`; `persisted_job` uses queue `message.process`, dedupe `inbound-event:<id>`, and typed `inbound_event_id`.
- [ ] **GREEN:** Implement `bindStreamToConversation` as one statement locking the conversation first, then streams by id, allocating `MAX(conversation_stream_order)+1` under the indexed conversation scope. Preserve loser event tuples and generation counters; move aliases and retire only the losing stream.
- [ ] **GREEN:** Expose `bindStreamToConversation` to the worker/lifecycle dependency graph, but defer flow integration to Phase 5 where canonical preparation is split from business effects. Pass the authority tuple through the worker types without invoking binding after side effects.
- [ ] **REFACTOR:** Repeat the concurrent database tests enough to exercise both transaction winners. Run `EXPLAIN` to confirm alias/provider predicates use their unique indexes at representative volume.

**Commit:** `feat(pr306): register and bind whatsapp streams atomically`

**Rollback boundary:** Compatibility reads may still use legacy event fields while version is below 2. Reverting this phase must leave expand columns/tables intact until dual-written rows are validated or discarded in a separately reviewed cleanup.

## Phase 4 — Claim, retry, supersession, and orphan repair

**Files:** modify `src/application/ports/job-queue.ts`, `src/infrastructure/repositories/drizzle-job-queue.ts`, `src/application/jobs/drain-message-process-queue.ts`, `src/application/jobs/process-message-job.ts`, `src/application/jobs/reconcile-message-job-orphans.ts`, `src/application/ports/message-job-orphan-reader.ts`, `src/infrastructure/repositories/drizzle-message-job-orphan-reader.ts`, `src/app/api/cron/message-worker/route.ts`, `src/__tests__/MessageJobOrphanReconciliation.test.ts`; create `src/application/jobs/inbound-claim-token.ts`, `src/__tests__/WhatsAppStreamClaim.test.ts`.

- [ ] **RED:** Test 32-byte base64url token generation, deterministic SHA-256 base64url digesting, no token in serialized job payloads/log metadata, and retry token equality.
- [ ] **RED:** Against PostgreSQL, test quiet-window eligibility, exact tuple/job binding, competing worker exclusion, B-before-claim history-only, B-after-claim preserving A, failures before/after composition, failure during outbox creation, and retry with the same token.
- [ ] **RED:** Test orphan eligibility separately: absent job creates one replacement; terminally unusable bound job resets the same row; live/processing job, terminal event, authorized outbound, young event, or tuple mismatch is ineligible; two concurrent repairs converge.
- [ ] **GREEN:** Add `claimNextInboundWork(input: { workerId: string; now?: Date }): Promise<ClaimInboundWorkResult>` to `JobQueue`. Keep `claimNextJob` for `message.send` and `followup.dispatch`.
- [ ] **GREEN:** Implement token helpers exactly as declared. In the claim statement lock job/event/stream, validate queue/dedupe/typed refs/quiet/latest rules, create token only when absent, and reuse the retained token only for `claim_job_id`.
- [ ] **GREEN:** Change the process drain to call `claimNextInboundWork`. Route `history_only` directly to canonical-history processing; route `claimed` with its tuple/token to the handler.
- [ ] **GREEN:** Implement `repairInboundAuthorityJob` with the eligibility and row-lock guards in Spec §5. Missing jobs insert the canonical queue/dedupe row and rebind `claim_job_id`; terminally unusable jobs reset the same row. Never create a second `(queue, dedupe_key)` or `inbound_event_id` row.
- [ ] **REFACTOR:** Make the orphan reader list bounded candidate ids only; keep final eligibility in the atomic repair statement. Run claim, orphan, job queue, retry-policy, database, lint, and typecheck suites.

**Commit:** `feat(pr306): settle inbound authority at durable claim`

**Rollback boundary:** Before version 2, compatibility code may fall back only for rows without authority. Rows with tokens must continue through the durable retry/repair path; rollback cannot mint replacement tokens.

## Phase 5 — Canonical history and history-only processing

**Files:** create `src/application/conversation/register-inbound-history.ts`, `src/__tests__/WhatsAppStreamHistory.test.ts`; modify `src/application/use-cases/leads/register-incoming-message.ts`, `src/infrastructure/repositories/drizzle-conversation-repository.ts`, `src/application/inbox/list-messages.ts`, `src/application/jobs/process-message-job.ts`.

- [ ] **RED:** Test canonical tuple persistence and `ON CONFLICT (inbound_event_id)` idempotence. Test equal, delayed, reversed, and tied provider timestamps while A precedes B by stream generation.
- [ ] **RED:** Retain two retired streams plus one active stream on one conversation and assert order `(conversation_stream_order, stream_generation, inbound_event_id)`.
- [ ] **RED:** Spy on LLM, orchestrator, scheduling, reservation, state machine, notification, and outbox dependencies; assert every history-only event calls none of them.
- [ ] **GREEN:** Implement `prepareInboundHistory(input: InboundHistoryInput): Promise<PreparedInboundHistory>` in the new file. Move only durable identity/conversation resolution, canonical message insertion with authority refs, and idempotent inbound accounting into this function.
- [ ] **GREEN:** Refactor `RegisterIncomingMessage` to expose `prepareInboundHistory` and `applyClaimedInboundEffects(prepared: PreparedInboundHistory): Promise<void>`. Move lead-status changes and follow-up cancellation into the latter; do not run them during preparation.
- [ ] **GREEN:** In both paths, call `bindStreamToConversation` immediately after preparation. History-only then terminalizes. Claimed work calls `applyClaimedInboundEffects`, acquires the existing conversation lease, and enters the engine.
- [ ] **GREEN:** Centralize canonical authority ordering in `DrizzleConversationRepository.listMessages`; update inbox pagination to preserve its display contract while authority-dependent pipeline history uses the canonical order.
- [ ] **GREEN:** Make `history_only` prepare/bind history and terminalize without lead-status, follow-up, conversation-lease, or engine effects. Normal claimed work prepares/binds the same history before applying those existing effects.
- [ ] **REFACTOR:** Run history, incoming-message, process-job, inbox, E2E, database, lint, and typecheck tests.

**Commit:** `feat(pr306): preserve canonical stream-ordered history`

**Rollback boundary:** Authority references remain nullable during compatibility. Do not delete canonical history or revert already assigned stream generations.

## Phase 6 — Outbox and sender authorization

**Files:** modify `src/application/ports/outbound-message-store.ts`, `src/application/jobs/enqueue-outbound-message.ts`, `src/infrastructure/repositories/drizzle-outbound-message-store.ts`, `src/application/jobs/send-message-job.ts`, `src/app/api/cron/sender-worker/route.ts`, every explicit outbound caller in the file map; create `src/__tests__/WhatsAppOutboundAuthorization.test.ts`.

- [ ] **RED:** Test the discriminated authorization input and persisted mapping for every kind. Test live tuple/token validation, post-claim later generation, unconditional lifetime dedupe, terminal failure reuse, missing/unknown kind rejection after version 2, and pre-activation worker rejection after activation.
- [ ] **RED:** Test that job/outbox payloads and structured logs contain neither raw token nor digest. Test sender preflight using only persisted digest/tuple/version joins.
- [ ] **GREEN:** Add `authorization: OutboundAuthorizationInput` to `CreateOutboundMessageInput` and persisted authorization fields to `OutboundMessage`. Compute the digest with `digestInboundClaimToken`; read and persist the current organization authority version inside the outbox SQL statement rather than trusting a caller-supplied version.
- [ ] **GREEN:** Extend the atomic outbox CTE to validate raw token and event digest through bound parameters, insert only the digest, use the unconditional authority tuple index, and return the existing outbound/job on conflict for every status.
- [ ] **GREEN:** Add sender preflight: version 2 rejects null/unknown/legacy kinds; live replies join stream/event/job and compare tuple, digest, version, and terminal state without checking current latest generation.
- [ ] **GREEN:** Assign kinds exactly: orchestrator/V2 live handler `live_stream_reply`; manual send and confirmed deposit `human_manual`; pipeline action emissions `system`; cron/application categories map to follow-up, reminder, campaign, recovery, or operational as specified.
- [ ] **GREEN:** Terminal provider failure updates the existing outbound row. Existing authorized retry/dead-letter action requeues that same row/job; no code path inserts a replacement live tuple.
- [ ] **REFACTOR:** Let TypeScript find every unclassified caller, then run outbound, sender, safety, manual-send, reminder, campaign, recovery, full scheduled-burst, database, lint, and typecheck suites.

**Commit:** `feat(pr306): persist and enforce outbound authority`

**Rollback boundary:** Once any organization is version 2, rollback may deploy only a sender that still enforces version 2 or disable live replies. Never restore missing/legacy conversation authorization.

## Phase 7 — Backfill, activation, cleanup, and rollout controls

**Files:** create the four exact scripts, authority port/repository, activation test, and rollout document listed in the file map; modify `src/app/api/owner/clinics/[clinicId]/purge/route.ts`; execute but do not rewrite `scripts/check-purge-coverage.ts`.

- [ ] **RED:** Test authority-version monotonic CAS, version-2 sender fence, no downgrade, ambiguous backfill fail-closed, active orphan detection, alias conflict detection, bounded batch continuation, retained claimed/live rows, and purge tenant isolation.
- [ ] **GREEN:** Implement `ConversationAuthorityStore.getVersion(clinicId)` and `compareAndSetVersion({ clinicId, expectedVersion, nextVersion, actor, now })`; reject `nextVersion < expectedVersion`.
- [ ] **GREEN:** Implement `backfill-whatsapp-stream-authority.ts` with dry-run default, `--apply`, `--batch-size` default 500/max 500, and UUID `--after-id` keyset. Populate only unambiguous historical rows; record conflicts instead of guessing.
- [ ] **GREEN:** Implement read-only `validate-whatsapp-stream-authority.ts` for counts, tuple consistency, duplicate aliases/generations, job/orphan state, outbound authorization, and one-active-stream-per-conversation.
- [ ] **GREEN:** Implement `cleanup-whatsapp-stream-authority.ts` with dry-run default, a fixed minimum age of 30 days, max batch 500, UUID keyset continuation, and eligibility restricted to streams whose `retirement_reason = 'alias_convergence'` with no inbound event, canonical message, outbound reference, or active alias. Do not delete events, messages, jobs, settled streams, or outbound audit rows.
- [ ] **GREEN:** Implement `activate-whatsapp-stream-authority.ts` as an explicit organization-id/version CAS command. It has no downgrade flag and refuses activation unless validation is clean.
- [ ] **GREEN:** Update clinic purge to collect tenant conversation and inbound-event ids, then delete in this order: authorized outbound rows; canonical messages; jobs whose `inbound_event_id` belongs to the tenant; inbound events; stream aliases; streams; existing conversation children; conversations; remaining existing organization children; organization. `conversation_authority` cascades from organization. Run `npx dotenv -e .env.test.local -- tsx scripts/check-purge-coverage.ts` against the disposable database.
- [ ] **GREEN:** Write `docs/operations/whatsapp-stream-authority-rollout.md` with exact expand → compatibility/dual-write → disposable migrate → backfill → validate → drain → version 2 → monitor → future contract sequence and compatibility-safe rollback.
- [ ] **REFACTOR:** Run activation, purge coverage, script unit tests, database tests, lint, typecheck, and dry-run scripts against the disposable database. Do not activate any production organization.

**Commit:** `feat(pr306): add authority rollout and repair controls`

**Rollback boundary:** Version is monotonic. After version 2, rollback is compatibility-safe code or disabled live automation. Historical authority fields and expand tables remain until a later contract/cleanup approval.

## Phase 8 — Performance, full verification, and delivery evidence

**Files:** create `src/__tests__/WhatsAppStreamPerformance.test.ts`; update `docs/operations/whatsapp-stream-authority-rollout.md` with measurement fields; do not modify Harness.

- [ ] **RED:** Seed at least 10,000 inbound events/jobs across at least 100 streams and at least 100 events in the target stream. Capture plans for provider dedupe, alias convergence, generation assignment, claim, bind, outbox authorization, orphan repair, backfill, and cleanup.
- [ ] **RED:** At representative volume fail only when authority predicates perform an unbounded sequential scan of `inbound_events`, `jobs`, `whatsapp_stream_aliases`, `whatsapp_streams`, or `outbound_messages`; accept a sequential scan on a tiny table/CTE when actual rows are bounded.
- [ ] **GREEN:** Assert point/tuple lookups use an index or inspect no more than 50 rows, backfill/cleanup returns no more than 500 rows per batch, and every statement has explicit keyset/limit bounds.
- [ ] **GREEN:** Hold a lock on stream A, set `lock_timeout = '250ms'` in a second connection, and prove ingress/claim for stream B completes without waiting on A. Separately prove same-stream generation assignment serializes.
- [ ] **GREEN:** Record `EXPLAIN (ANALYZE, BUFFERS)`, actual/planned rows, lock wait, transaction duration, process CPU, and Neon compute-active time when exposed by the authorized disposable branch. Confirm no timer/poll/heartbeat/new worker was added by source scan and architecture test.
- [ ] **REFACTOR:** Keep performance fixtures deterministic and disposable. Document observed values and thresholds in the rollout runbook, not Harness evidence.
- [ ] **VERIFY:** Run the exact checkpoints below and capture results for final PR review. Stop before push/deploy unless newly authorized.

**Commit:** `test(pr306): verify stream authority performance and rollout`

## Exact verification checkpoints

1. Targeted in-memory:

```bash
npm test -- src/__tests__/ScheduledBurstDebounceE2E.test.ts src/__tests__/WhatsAppStreamIngress.test.ts src/__tests__/WhatsAppStreamClaim.test.ts src/__tests__/WhatsAppStreamHistory.test.ts src/__tests__/WhatsAppOutboundAuthorization.test.ts src/__tests__/WhatsAppAuthorityActivation.test.ts
```

2. Mandatory authority database suite with zero skips; optional calendar database suite remains separate:

```bash
npm run test:db:authority
vitest run src/__tests__/WhatsAppStreamSchema.test.ts src/__tests__/WhatsAppStreamPerformance.test.ts
# Optional/manual only when an authorized disposable Neon branch exists:
npm run test:db:calendar
```

The calendar command alone loads authorized `.env.test.local`; its absence is not a PR #306 blocker. Authority/schema/performance tests provision isolated embedded PostgreSQL and never load `.env.local`.

3. Migration on a fresh disposable database: run the embedded migration setup exercised by `ScheduledBurstDebounceDatabase.test.ts`, then run schema validation. Never use `npm run db:migrate`, because that script loads `.env.local`.

4. Static and repository gates:

```bash
npm run db:check
npx eslint src/application/ports/inbound-event-store.ts src/application/ports/job-queue.ts src/application/ports/outbound-message-store.ts src/application/ports/whatsapp-stream-authority.ts src/application/ports/conversation-authority-store.ts src/application/jobs/inbound-claim-token.ts src/application/jobs/drain-message-process-queue.ts src/application/jobs/process-message-job.ts src/application/jobs/reconcile-message-job-orphans.ts src/application/jobs/enqueue-outbound-message.ts src/application/jobs/send-message-job.ts src/infrastructure/repositories/drizzle-inbound-event-store.ts src/infrastructure/repositories/drizzle-job-queue.ts src/infrastructure/repositories/drizzle-whatsapp-stream-authority.ts src/infrastructure/repositories/drizzle-conversation-authority-store.ts src/infrastructure/repositories/drizzle-outbound-message-store.ts src/__tests__/ScheduledBurstDebounceE2E.test.ts src/__tests__/ScheduledBurstDebounceDatabase.test.ts src/__tests__/WhatsAppStreamSchema.test.ts src/__tests__/WhatsAppStreamIngress.test.ts src/__tests__/WhatsAppStreamClaim.test.ts src/__tests__/WhatsAppStreamHistory.test.ts src/__tests__/WhatsAppOutboundAuthorization.test.ts src/__tests__/WhatsAppAuthorityActivation.test.ts src/__tests__/WhatsAppStreamPerformance.test.ts
npm run typecheck
npm run build
```

5. Full clean-tree gate after independently reviewable commits:

```bash
npm run verify
```

6. Delivery gates requiring separate authorization: push, CI, preview smoke, worker-drain evidence, version-2 activation, rollout observation, and final merge review. Green CI does not authorize merge or production promotion.

## Exact proposed commit sequence

1. `test(pr306): wire durable authority red gate`
2. `feat(pr306): add durable stream authority expand schema`
3. `feat(pr306): register and bind whatsapp streams atomically`
4. `feat(pr306): settle inbound authority at durable claim`
5. `feat(pr306): preserve canonical stream-ordered history`
6. `feat(pr306): persist and enforce outbound authority`
7. `feat(pr306): add authority rollout and repair controls`
8. `test(pr306): verify stream authority performance and rollout`

## Contract migration intentionally excluded

A future separately approved PR changes only validated row-kind constraints/nullability and removes compatibility reads. It must not be generated or bundled here. Its prerequisite evidence is: all organizations at version 2 or explicitly disabled, backfill validator clean, no legacy outbound creation during the observation window, and rollback build still enforcing the version-2 sender fence.
