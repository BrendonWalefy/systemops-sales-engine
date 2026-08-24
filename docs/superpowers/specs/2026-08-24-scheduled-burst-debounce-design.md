# PR #306 — Durable Stream Authority Design

**Date:** 2026-08-24
**Status:** architecture approved; specification revision only; production implementation not started
**Scope:** durable WhatsApp authority for identity convergence, burst settlement, ordered history, retry, outbox creation, and delivery

## 1. Objective and invariants

PostgreSQL is the authority for each WhatsApp stream. `jobs.run_at` schedules work but does not establish latest-turn authority, and conversation-message visibility does not decide whether a reply is permitted.

The release invariants are:

1. Every provider delivery has one physical `inbound_events` insertion path and is registered at most once.
2. A new delivery receives one stream and one database-assigned generation, or is terminally recorded as `identity_conflict` without a job.
3. The newest unclaimed generation after its clinic quiet window may claim. A newer generation registered before claim makes the older generation history-only.
4. Claim is the settlement boundary. A newer generation registered after claim cannot revoke the settled claim.
5. The exact `(streamId, streamGeneration, inboundEventId, jobId)` tuple and claim token are checked at claim and atomic outbox creation.
6. Retry reuses the token and job binding. Orphan repair is a separate guarded operation.
7. Canonical history uses database authority order, never provider timestamps.
8. One settled generation creates at most one live conversation-reply outbox row over its entire lifetime, including terminal states.
9. Duplicate provider delivery, crash/retry, and concurrent ingress do not lose history or duplicate a reply.
10. Streams are tenant-scoped and independent; a stable stream keeps its generation counter when aliases are added, removed, or changed.

## 2. Application representation

All PostgreSQL generation columns use `bigint(..., { mode: "number" })` and all TypeScript/API contracts use `number`. Generation values are integers in the inclusive range `0..Number.MAX_SAFE_INTEGER` (`9007199254740991`), enforced by PostgreSQL checks on stream counters and non-null generation references. No JavaScript `bigint` enters JSON payloads.

Registration fails closed before incrementing beyond the safe range. A stream cannot practically approach that limit, but the check makes serialization correctness explicit.

## 3. Durable schema

The expand schema is authored in `src/infrastructure/db/schema.ts` and generated with `npm run db:generate`. Generated SQL is reviewed but not hand-edited.

### 3.1 Enums

Add:

- `whatsapp_stream_state`: `provisional`, `active`, `retired`;
- `whatsapp_stream_retirement_reason`: `alias_convergence`, `conversation_convergence`, `manual`;
- `whatsapp_stream_alias_kind`: `phone`, `whatsapp_lid`, `provider_thread`;
- `outbound_authorization_kind`: `live_stream_reply`, `follow_up`, `reminder`, `campaign`, `human_manual`, `operational`, `system`, `recovery`, `legacy`.

Extend `inbound_event_processing_status` with `identity_conflict` and `history_only`.

### 3.2 `whatsapp_streams`

Fields:

- `id uuid primary key defaultRandom()`;
- `organization_id uuid not null` referencing `organizations.id` with `ON DELETE CASCADE`;
- `conversation_id uuid null`;
- `state whatsapp_stream_state not null default 'provisional'`;
- `current_generation bigint number not null default 0`;
- `latest_inbound_event_id uuid null`;
- `quiet_until timestamptz null`;
- `conversation_stream_order bigint number null`;
- `bound_at timestamptz null`;
- `retired_at timestamptz null`;
- `retirement_reason whatsapp_stream_retirement_reason null`;
- `created_at` and `updated_at timestamptz not null default now()`.

Constraints and indexes:

- `whatsapp_streams_id_org_unique` on `(id, organization_id)` supports tenant-safe composite references.
- Add `conversations_id_org_unique` on `(conversations.id, conversations.organization_id)`.
- Composite FK `whatsapp_streams_conversation_org_fk` from `(conversation_id, organization_id)` to `(conversations.id, organization_id)` prevents cross-tenant binding.
- Check `current_generation BETWEEN 0 AND 9007199254740991`.
- Check `conversation_id`, `conversation_stream_order`, and `bound_at` are either all null or all non-null.
- Check `conversation_stream_order BETWEEN 1 AND 9007199254740991` when non-null.
- Check retired rows have both `retired_at` and `retirement_reason`; active/provisional rows have neither.
- Partial unique index `whatsapp_streams_active_conversation_unique` on `(conversation_id)` where `state = 'active' AND conversation_id IS NOT NULL` enforces one active WhatsApp stream per canonical conversation.
- Partial unique index `whatsapp_streams_conversation_order_unique` on `(conversation_id, conversation_stream_order)` where both are non-null preserves retained-stream order.
- Index `whatsapp_streams_org_state_updated_idx` on `(organization_id, state, updated_at)`.
- Index `whatsapp_streams_conversation_history_idx` on `(conversation_id, conversation_stream_order, id)`.
- Index `whatsapp_streams_org_quiet_generation_idx` on `(organization_id, quiet_until, current_generation)`.

`latest_inbound_event_id` is a denormalized pointer to the latest assigned event. The generated migration adds its nullable FK to `inbound_events.id` with `ON DELETE SET NULL` after both tables exist; the inbound event remains authoritative if the pointer is null during expand/backfill.

### 3.3 Stream-to-conversation binding

A stream is initially unbound. `RegisterIncomingMessage.execute` resolves or creates the canonical conversation using the existing unique lead/conversation rules. Immediately after that result and before LLM, scheduling, reservation, notification, or outbound effects, `bindStreamToConversation` runs one database statement:

1. Lock the canonical `conversations` row, validating the same `organization_id`.
2. Lock the current stream and any active stream already bound to the conversation in ascending stream-id order.
3. If no active stream is bound, bind the current stream, set it active, allocate `conversation_stream_order = COALESCE(MAX(existing order), 0) + 1` under the conversation lock, and set `bound_at` from the database clock.
4. If the current stream is already the active bound stream, return it idempotently.
5. If another active stream is bound, it is the winner. Move active aliases to the winner, retire the current stream with reason `conversation_convergence`, bind the retired stream to the same conversation with the next `conversation_stream_order`, and leave every existing event on its original stream and generation.
6. Claimed events on a retired loser retain settled authority. Unclaimed events on it become `history_only`. Future ingress resolves through aliases on the active winner.

The conversation-row lock serializes simultaneous first bindings; the partial active-conversation unique index is the final database guard. A retained retired stream remains auditable. Canonical history orders by `conversation_stream_order ASC, stream_generation ASC, inbound_event_id ASC`. Alias changes mutate alias ownership only; they never replace the active stream or reset `current_generation`.

### 3.4 `whatsapp_stream_aliases`

Fields are `id`, `organization_id`, `kind`, non-null `provider_scope`, `normalized_value`, `stream_id`, `created_at`, and nullable `retired_at`.

Normalization is exact:

- phone and WhatsApp LID aliases use `provider_scope = '__provider_independent__'`;
- Meta thread aliases use `meta_cloud_api:<meta_phone_number_id>`;
- Z-API thread aliases use `z_api:<zapi_instance_id>`;
- the provider enum prefix is lower-case; the instance-id component is trimmed and otherwise preserved byte-for-byte because provider instance ids are opaque; missing provider instance identity fails closed for `provider_thread`.

Constraints and indexes:

- tenant-safe composite FK `(stream_id, organization_id)` to `whatsapp_streams(id, organization_id)` with `ON DELETE CASCADE`;
- active unique index `whatsapp_stream_aliases_active_identity_unique` on `(organization_id, kind, provider_scope, normalized_value)` where `retired_at IS NULL`;
- index `whatsapp_stream_aliases_stream_retired_idx` on `(stream_id, retired_at)`.

### 3.5 `inbound_events`

Expand adds nullable `stream_id`, `stream_generation` (`bigint` number mode), `registered_at`, `claim_token`, `claim_token_digest`, `claim_job_id`, and `claimed_at`.

The final provider-delivery identity is `(organization_id, provider, provider_message_id)`. Replace `inbound_events_provider_message_unique` with `inbound_events_org_provider_message_unique` on those columns. Existing rows remain valid because the current global `(provider, provider_message_id)` uniqueness is stricter. After the replacement, the same provider message id may exist in different organizations but remains duplicate within one organization/provider. The current organization schema supports one Z-API instance and one Meta phone-number id per organization; adding multiple instances of the same provider to one organization requires a future `provider_delivery_scope` migration before that product capability is enabled.

Other expand indexes and constraints:

- tenant-safe composite FK `(stream_id, organization_id)` to `whatsapp_streams(id, organization_id)` with `ON DELETE RESTRICT`;
- partial unique `inbound_events_stream_generation_unique` on `(stream_id, stream_generation)` where both are non-null;
- unique `inbound_events_authority_tuple_unique` on `(id, stream_id, stream_generation)` for composite references;
- index `inbound_events_stream_generation_id_idx` on `(stream_id, stream_generation, id)`;
- index `inbound_events_claim_job_idx` on `(claim_job_id)`;
- check that stream id and generation are both null or both non-null;
- check non-null generation is between 1 and `9007199254740991`;
- check claim token, digest, and claimed-at are either all null or all non-null;
- check non-null token and digest each match `^[A-Za-z0-9_-]{43}$`;
- nullable FK `claim_job_id` to `jobs.id` with `ON DELETE SET NULL`; a non-null job id requires the token triple, while a retained token triple may temporarily have a null job id only for guarded orphan repair.

`identity_conflict` rows have null stream/generation and no job. Historical rows may retain null authority during expand and compatibility; contract checks requiring authority for new eligible rows are deferred to the later contract migration.

### 3.6 `jobs`

The real discriminator is `jobs.queue`. Preserve the existing unconditional unique index `jobs_queue_dedupe_key_idx` on `(queue, dedupe_key)`; terminalization never permits a second job with the same dedupe key.

Expand adds nullable `inbound_event_id` referencing `inbound_events.id` with `ON DELETE SET NULL`, plus:

- unconditional unique index `jobs_inbound_event_unique` on `(inbound_event_id)`; PostgreSQL permits multiple nulls but at most one job row may reference an event;
- claim index `jobs_queue_status_run_at_inbound_idx` on `(queue, status, run_at, inbound_event_id)`.

For `message.process`, the dedupe key remains `inbound-event:<event-id>`. Other queues keep null `inbound_event_id`. The later contract migration adds the conditional consistency check for `queue = 'message.process'` only after backfill.

### 3.7 Canonical `messages`

Expand adds nullable `inbound_event_id`, `stream_id`, and `stream_generation` (`bigint` number mode). Add:

- unique `messages_inbound_event_unique` on `(inbound_event_id)`;
- composite FK `(inbound_event_id, stream_id, stream_generation)` to `inbound_events(id, stream_id, stream_generation)` with `ON DELETE RESTRICT`;
- index `messages_conversation_stream_generation_idx` on `(conversation_id, stream_id, stream_generation, inbound_event_id)`.

Canonical WhatsApp inbound history joins `whatsapp_streams` and orders by `conversation_stream_order ASC, stream_generation ASC, inbound_event_id ASC`. `messages.sent_at` remains display/provider metadata and is not an authority-order field. Equal, delayed, or reversed provider timestamps cannot reorder A and B within a stream.

### 3.8 `outbound_messages`

Expand adds nullable `authorization_kind`, `authorization_stream_id`, `authorization_generation` (`bigint` number mode), `authorization_inbound_event_id`, `authorization_claim_job_id`, `authorization_claim_token_digest`, and `authorization_version`.

Add:

- unconditional unique index `outbound_messages_live_stream_authority_unique` on `(authorization_stream_id, authorization_generation, authorization_inbound_event_id)` with no status predicate;
- index `outbound_messages_authority_status_idx` on `(organization_id, authorization_kind, status, created_at)`;
- tenant-safe composite FK `(authorization_stream_id, organization_id)` to `whatsapp_streams(id, organization_id)` with `ON DELETE RESTRICT`;
- composite FK `(authorization_inbound_event_id, authorization_stream_id, authorization_generation)` to `inbound_events(id, stream_id, stream_generation)` with `ON DELETE RESTRICT`;
- FK `authorization_claim_job_id` to `jobs.id` with `ON DELETE RESTRICT`;
- check non-null `authorization_claim_token_digest` matches `^[A-Za-z0-9_-]{43}$` and non-null generation is within the safe-number range.

All `live_stream_reply` rows have the complete tuple after contract validation. Non-live kinds keep stream fields null. Because PostgreSQL unique indexes permit multiple nulls, non-live rows are unaffected while every fully populated live tuple remains unique after `sent`, `failed`, `dead`, or `cancelled`.

Retries return and reuse the existing outbound row. A terminal delivery failure remains terminal and auditable; automated retry may reset/requeue that same outbound row and its existing `message.send` job under existing retry policy. Creating another outbound for the same settled tuple is forbidden. A deliberate new message requires a different authorized generation/category, not a duplicate live reply.

### 3.9 `conversation_authority`

Add `conversation_authority` with `organization_id` primary key/FK to `organizations.id` using `ON DELETE CASCADE`, `version integer not null default 0`, nullable `activated_at`, nullable `activated_by`, and `updated_at not null default now()`. Check version is one of `0`, `1`, `2`, or `3`. Version 2 is the activation fence. Repository updates are monotonic compare-and-set operations; rollback never lowers the version to restore legacy sending.

Unless an `ON DELETE` action is stated above, authority/audit references use PostgreSQL `RESTRICT`. Tenant purge therefore deletes dependants in the explicit order in the implementation plan; routine retention cannot silently erase referenced authority.

This PR adds no automatic retention worker. `cleanup-whatsapp-stream-authority.ts` is a manual, dry-run-by-default maintenance command limited to streams retired with reason `alias_convergence`, `retired_at < now - 30 days`, no inbound event, no canonical message, no outbound reference, and no active alias. It deletes at most 500 streams per invocation by keyset. Inbound events, canonical messages, jobs, settled streams, and outbound audit rows are retained; only the existing cancelled-clinic purge or a future separately reviewed retention policy may remove them.

## 4. One-path atomic event registration

`DrizzleInboundEventStore.recordInboundEventAndEnqueue` remains the only durable insertion path. It executes one PostgreSQL statement, which is one transaction under the Neon HTTP driver.

The statement uses the ledger-first algorithm:

1. `INSERT INTO inbound_events (...) ON CONFLICT (organization_id, provider, provider_message_id) DO UPDATE SET provider_message_id = excluded.provider_message_id RETURNING ...`. This is the only physical event insertion.
2. If the returned existing event already has stream authority or `identity_conflict`, return its persisted result and existing job; do not resolve aliases, allocate generation, or create another job.
3. For a new/unresolved row, insert a provisional stream and aliases with `INSERT ... ON CONFLICT`, then retrieve all winning alias stream ids.
4. Partition winners by stream state. Zero active winners activates one provisional winner; one active winner absorbs candidates and retires them with reason `alias_convergence`; more than one active winner updates the ledger row to `identity_conflict` and creates no job.
5. For a resolved winner, lock its stream row, increment `current_generation`, update the one ledger row with stream id/generation/`registered_at`, update stream latest/quiet fields, and insert one `message.process` job with `(queue, dedupe_key) = ('message.process', 'inbound-event:<id>')` and `inbound_event_id = event.id`.

The statement reads `organizations.message_debounce_ms` for the event tenant and computes `quiet_until = received_at + COALESCE(message_debounce_ms, 15000 milliseconds)`; the job's initial `run_at` equals that quiet boundary. The constant is passed from `DEFAULT_MESSAGE_DEBOUNCE_MS`, not duplicated as an unrelated business rule. Every later ingress updates the stream quiet boundary, so longer clinic settings are enforced at claim without an orchestrator sleep.

Concurrent duplicate insertion waits on the scoped provider unique index. After the winner commits, the duplicate returns the winner's completed row/job. If the winner transaction rolls back, its ledger, stream, alias, generation, and job changes all roll back; the waiting transaction may then become the inserter and execute the same one path. No partially registered ledger row commits.

Alias convergence distinguishes active authorities from provisional candidates:

- zero active winners activates the converged candidate;
- one active winner plus candidates attaches all aliases to the active winner and retires candidates;
- more than one active winner records `identity_conflict` and creates no job.

## 5. Claim, retry, supersession, and orphan repair

### Normal claim/retry

`claimInboundWork` locks the candidate job, its inbound event, and stream in stable id order in one statement. Eligibility requires queue `message.process`, pending job, `run_at <= now`, matching event/job references, active stream, `quiet_until <= now`, and event generation equal to the stream latest generation unless the event already has a settled token.

- First claim generates and persists one token/digest and binds `claim_job_id` to the selected job.
- Retry locks the same event and currently bound job, reads the retained token, and returns it unchanged.
- A different event, stream, generation, or job cannot reuse the token.
- B before A's first claim makes A history-only.
- B after A's successful claim does not revoke A; B starts the next burst.

### Token and digest

The application uses Node `node:crypto` only:

- token: `randomBytes(32).toString("base64url")`;
- digest: `createHash("sha256").update(token, "utf8").digest("base64url")`.

Hashing occurs in the claim repository before the claim statement. `inbound_events.claim_token` is the only durable raw-token record; `inbound_events.claim_token_digest` stores its digest. Neither value enters job/outbox JSON or logs. The claim method returns the raw token only in memory.

Atomic outbox creation hashes the in-memory token again, passes token and digest as bound SQL parameters, and validates `claim_token`, `claim_token_digest`, `claim_job_id`, stream, generation, event, and version before insertion. The outbound persists only the digest. Sender preflight joins the event and compares the two persisted digests plus tuple/job/version; it never reads or emits the raw token. No PostgreSQL crypto extension is required.

### Atomic orphan repair

Normal retry never changes `claim_job_id`. `repairInboundAuthorityJob` is a separate repository operation and is eligible only when the event is `pending` or `failed`, has no authorized outbound, is older than the configured orphan age, and either:

1. `claim_job_id IS NULL` and no job exists for its queue/dedupe/inbound-event keys; or
2. the bound job is locked and proven terminally unusable (`failed`, `dead`, or `done`) while the event itself is non-terminal and has no outbound.

The repair statement locks the event, any referenced job, and the stream. For a missing job it inserts exactly one job with the same canonical queue/dedupe and `inbound_event_id`, using `run_at = now` for an already stale generation and `run_at = GREATEST(now, stream.quiet_until)` for the latest generation, then atomically updates `claim_job_id`; a retained token/digest is unchanged. For a terminally unusable existing job it resets that same row to pending with the same run-at rule, clears its lock/error terminal fields, preserves its id/dedupe/inbound reference, and keeps `claim_job_id` unchanged. The unconditional job unique indexes and event lock make concurrent repair converge to one row. A processing/live job, processed/history-only/conflict event, existing authorized outbound, or tuple mismatch fails closed.

## 6. Canonical history-only behavior

`RegisterIncomingMessage` is split into `prepareInboundHistory` and `applyClaimedInboundEffects`. Preparation resolves the durable lead/conversation identity, inserts the canonical inbound message with its authority tuple, and records idempotent inbound accounting; it does not change lead status, cancel follow-ups, acquire the conversation lease, or invoke an engine. `bindStreamToConversation` runs immediately after preparation resolves the canonical conversation.

Superseded unclaimed events execute preparation and binding, then terminate as `history_only` without calling `applyClaimedInboundEffects`, the conversation handler, LLM, scheduling, reservation, state-machine mutation, notification, or outbox. Claimed work prepares/binds first, then applies the existing lead/follow-up effects and enters the existing business pipeline.

The claimed outbox remains authorized even if a later generation arrives or its stream is retired during conversation convergence.

## 7. Persisted outbound authorization

`CreateOutboundMessageInput` requires an authorization object during compatibility dual-write. Exact kind mapping:

- `ConversationOrchestrator` and `v2-live-conversation-handler.ts`: `live_stream_reply` with complete settled tuple;
- `/api/conversations/[conversationId]/send` and staff-confirmed deposit decisions: `human_manual`;
- pipeline action routes that emit deterministic operator actions: `system`;
- follow-up dispatcher/post-appointment follow-up: `follow_up`;
- appointment/deposit reminder routes: `reminder`;
- reactivation dispatch: `campaign`;
- recovery routes/actions: `recovery`;
- internal service messages: `operational`;
- pre-version-2 rows only: `legacy`.

Outbox creation and its `message.send` job remain one statement. Live reply insertion validates the settled tuple/token and uses the unconditional authority unique index. On conflict it returns the existing outbound and existing queue job regardless of outbound status.

At sender preflight, version 2 rejects missing, unknown, `legacy`, or invalid live authorization. Non-live explicit kinds validate organization/conversation/category consistency. A later stream generation does not invalidate a settled live reply.

## 8. Migration, activation, retention, and rollback

### Expand in this PR

This PR's generated migration contains new tables/enums/indexes and nullable authority columns on historical `inbound_events`, `jobs`, `messages`, and `outbound_messages`. It replaces provider-delivery uniqueness as described. It does not make historical authority fields `NOT NULL` and does not add checks that historical rows cannot yet satisfy.

Generation is split into two reviewed migrations. The first generated migration must order dependencies as: enums → `conversations_id_org_unique` → `whatsapp_streams` without its cyclic latest-event FK → aliases and `conversation_authority` → nullable inbound columns/indexes/FK to streams → nullable job columns/indexes/FK to inbound → generated `ALTER TABLE` FKs for stream latest event and event claim job → nullable message/outbound columns, indexes, and FKs. It also adds `inbound_events_org_provider_message_unique` while retaining the old global index. After that migration is generated, remove only the old global index declaration from `schema.ts` and generate a second migration that drops it. If generated SQL violates dependency order, adjust schema declarations and regenerate; do not edit SQL.

### Contract later

After dual-write, bounded backfill, validation, version-2 activation, and observation, a separate approved contract PR generates checks/non-null rules appropriate to row kind: message-process jobs require inbound refs; live replies require complete authorization; eligible inbound rows require authority; canonical WhatsApp inbound messages require their tuple. Columns that legitimately remain nullable for other queues/message directions/categories stay nullable.

### Exact operational files

- `scripts/backfill-whatsapp-stream-authority.ts`: dry-run by default; `--apply`; bounded `--batch-size` and `--after-id`.
- `scripts/validate-whatsapp-stream-authority.ts`: count, uniqueness, orphan, tuple, and authorization validation; read-only.
- `scripts/cleanup-whatsapp-stream-authority.ts`: dry-run by default; fixed 30-day minimum age; maximum 500 retired provisional streams per keyset batch.
- `scripts/activate-whatsapp-stream-authority.ts`: compare-and-set organization versions; no downgrade command.
- `src/application/ports/conversation-authority-store.ts` and `src/infrastructure/repositories/drizzle-conversation-authority-store.ts`: version reads/CAS.
- `src/application/ports/whatsapp-stream-authority.ts` and `src/infrastructure/repositories/drizzle-whatsapp-stream-authority.ts`: binding and repair.
- `docs/operations/whatsapp-stream-authority-rollout.md`: expand, dual-write, disposable verification, backfill, validation, drain, activation, monitoring, rollback, and future contract.
- `src/app/api/owner/clinics/[clinicId]/purge/route.ts`: tenant purge coverage for new tables.

Rollout order is expand → compatibility/dual-write → disposable migration verification → bounded backfill → validation → drain old workers → activate version 2 → monitor → contract later. Rollback after activation deploys the compatibility-safe build or disables live conversation automation; it never lowers authority version or restores legacy conversation replies.

## 9. Performance safety

No polling, heartbeat, or new worker is introduced. Ingress is one statement; claim, bind, outbox, and repair are each one short statement. Locks are scoped to aliases involved, one conversation during binding, and one stream/event/job during claim.

Performance tests seed representative volumes before inspecting plans: at least 10,000 inbound events/jobs across at least 100 streams, with at least 100 rows in the target stream. Tests assert authority predicates and lock candidates use the named indexes or remain bounded to the target stream/event/job. A sequential scan on a tiny disposable table is not itself a failure. Failure conditions are an unbounded scan at representative volume, missing authority index, cross-stream lock blocking, polling/heartbeat, unbounded backfill/cleanup, or batch queries without keyset limits.

Evidence records `EXPLAIN (ANALYZE, BUFFERS)`, actual/planned rows, lock wait, transaction duration, batch size/progress, process CPU, and Neon compute-active time when the disposable provider exposes it.

## 10. Verification and non-goals

Database adapters must run in separate processes and environments:

```json
"test": "vitest run --exclude src/__tests__/ScheduledBurstDebounceDatabase.test.ts",
"test:db": "npm run test:db:authority",
"test:db:calendar": "dotenv -e .env.test.local -- vitest run src/__tests__/calendar-import.test.ts",
"test:db:authority": "vitest run src/__tests__/ScheduledBurstDebounceDatabase.test.ts"
```

The mandatory `test:db` gate is the embedded authority suite. The calendar database suite is optional/manual and retains `resolveTestDatabaseAccess` plus its authorized disposable-Neon policy; its external database is not a PR #306 prerequisite. The authority suite provisions collision-safe embedded PostgreSQL, applies current migrations, suppresses credentials and connection strings, cleans up through `finally`, and runs with zero skips in its own CI step. CI supplies only loopback test configuration and an explicitly different non-routable production host. Verification includes targeted in-memory tests, database tests with zero skips, ESLint, typecheck, generated migration on a disposable database, build, exact `npm run verify`, CI, preview smoke, rollout observation, and final review.

This specification does not authorize production behavior implementation, migration generation, commits, pushes, merges, deployment, production/Neon writes, `develop` promotion, or Harness changes.
