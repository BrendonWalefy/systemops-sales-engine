# WhatsApp Stream Authority Rollout

This runbook governs the durable burst-debounce authority introduced by PR #306. It does not authorize a production change. Every production organization activation requires a separate human decision and an identified operator.

## Safety boundary

- Version `0`: historical compatibility; legacy conversation replies can still send.
- Version `1`: compatibility build and explicit outbound classifications are present while backfill and validation run.
- Version `2`: durable activation fence. Missing, unknown, or `legacy` conversation authorization fails closed at sender preflight. A pre-activation row that is already terminal `sent` may retain `legacy` only as audited history; it is never sendable work.
- Version `3`: reserved for a separately reviewed future contract migration.

Authority versions are monotonic. There is no downgrade command. After version 2, rollback means deploying a compatibility-safe build that still enforces the version-2 sender fence, or disabling live conversation automation for the organization.

## Rollout sequence

1. **Expand.** Deploy the generated expand migration and the compatibility build. Confirm the schema metadata check and migration smoke tests pass.
2. **Compatibility / dual-write.** Classify every new outbound, register all new inbound events through stream authority, and advance only the approved organization from version 0 to version 1. Historical `unresolved_events` are expected migration debt during this transition and the activation command reports their count. Every other structured validation metric remains blocking.
3. **Disposable verification.** Apply migrations from empty and from a disposable copy of the prior schema. Run the embedded authority suite with zero skips.
4. **Backfill.** Run `scripts/backfill-whatsapp-stream-authority.ts` without `--apply` first. Use `--batch-size 500` or less and continue with the returned `nextAfterId`. The command resolves canonical evidence by the exact tenant-scoped provider message ID and resolves fallback identity only through the normalized phone, WhatsApp LID, and provider-thread aliases used by live ingress. Canonical and alias evidence must identify the same active stream when both exist. Review `backfillableEventIds` and `terminalLegacyEventIds` separately. Apply is allowed only when `unresolved=0` and `conflicts=0`; terminal-legacy-eligible rows do not block authority assignment and are not changed by this command. The command reports ambiguity but does not persist `identity_conflict` or guess an authority.
5. **Settle explicitly authorized terminal legacy history.** This is optional and requires a separate human decision for the exact organization and reviewed event IDs. A candidate must be pre-version-1, already `processed` or `ignored`, have zero canonical/alias authorities, and have no stream tuple, claim, job, or nonterminal outbound dependency. Genuine conflicts and ordinary unresolved events remain blocking. Run the bounded command without `--apply`, preserve its JSON audit output, then pass the exact returned IDs and digest back on apply:

   ```bash
   npx tsx scripts/settle-whatsapp-terminal-legacy-history.ts \
     --clinic-id <uuid> --actor <actor> --batch-size 500

   npx tsx scripts/settle-whatsapp-terminal-legacy-history.ts \
     --clinic-id <uuid> --actor <actor> --apply \
     --reviewed-event-ids <comma-separated-reviewed-ids> \
     --review-digest <review-digest>
   ```

   Dry-run writes nothing. Apply revalidates the evidence and terminal predicates and updates only the reviewed IDs to no-stream `history_only`. The audit result records mode, organization, actor, version-1 cutoff, counts, event IDs, and SHA-256 review digest without payload or message content. Settled rows cannot be claimed, repaired, re-enqueued, or used to authorize an outbound reply.
6. **Settle explicitly authorized terminal legacy outbounds.** This recovery operation is only for an organization already at version 2 and requires a separate human decision for the exact reviewed outbound IDs. A candidate must have null authorization, status exactly `sent`, a non-null `sent_at`, creation and send timestamps before the durable version-2 activation cutoff, category `reply` or `reminder`, no authority tuple, and no pending, processing, failed, or locked sender job. It does not resend, recreate, delete, or change delivery evidence. Run dry first, preserve the JSON result, then apply the exact IDs and digest:

   ```bash
   npx tsx scripts/settle-whatsapp-terminal-legacy-outbounds.ts \
     --clinic-id <uuid> --actor <actor> --batch-size 500

   npx tsx scripts/settle-whatsapp-terminal-legacy-outbounds.ts \
     --clinic-id <uuid> --actor <actor> --apply \
     --reviewed-outbound-ids <comma-separated-reviewed-ids> \
     --review-digest <review-digest>
   ```

   Apply sets only `authorization_kind='legacy'` and `authorization_version=1`. Status, category, payload, provider ID, sequence, timestamps, and all stream/event/job/token authority references remain unchanged. The command is tenant-scoped, keyset-bounded to at most 500 rows, dry-run by default, and fails closed if reviewed IDs cross tenants or eligibility changes.
7. **Validate.** Run `scripts/validate-whatsapp-stream-authority.ts --clinic-id <uuid>`. Resolve every non-zero blocking metric. Validation checks ordinary unresolved events, tuple consistency, alias/generation conflicts, active orphans, process-job orphans, outbound authorization, and active conversation ownership. `terminal_legacy_events` and `terminal_legacy_outbounds` remain visible as non-blocking audited metrics. A terminal legacy outbound is informational only when its immutable delivery evidence satisfies the exact pre-activation terminal policy; missing authorization and malformed, retryable, active, or post-activation legacy rows remain blocking.
8. **Drain old workers.** Stop new invocations of the previous build and wait for its maximum invocation duration plus queue visibility. Confirm no processing job remains locked by that build. A worker started before activation must reach the current sender preflight before provider delivery.
9. **Activate version 2.** Run `scripts/activate-whatsapp-stream-authority.ts` first as dry-run, then with `--apply`, exact organization ID, expected version 1, next version 2, and the named actor. Dry-run and apply validate against the projected `nextVersion` and proposed activation timestamp before the durable compare-and-set, so missing historical authorization cannot be hidden by the current version-1 policy. Version 1 to 2 requires every blocking metric, including ordinary `unresolved_events` and malformed outbound authorization, to be zero. The informational terminal-legacy counts do not block activation.
10. **Monitor.** Observe sender authorization rejections, identity conflicts, orphan counts, queue age, provider error rate, lock wait, transaction duration, CPU, rows scanned, and compute-active time. Do not reinterpret an authorization rejection as a retryable provider failure.
11. **Contract later.** A separate approved PR may add row-kind nullability/check constraints only after all intended organizations are version 2 or disabled and the observation window has no legacy creation.

## Bounded maintenance

- Backfill, terminal settlement, and cleanup are dry-run by default, keyset-paginated by UUID, and capped at 500 rows per invocation.
- Backfill dry-run and apply use the same structured evidence decision. Apply revalidates the exact event and reviewed stream immediately before serialized generation assignment. Historical backfill creates no processing or sender job. Terminal settlement is a separate dry-run-default command and never assigns a stream or creates a job, canonical message, or outbound record.
- Cleanup has a fixed minimum age of 30 days. It deletes only `alias_convergence` provisional remnants with no inbound event, canonical message, outbound reference, or active alias.
- No command adds polling, a heartbeat, a continuous worker, or an automatic retention schedule.
- Commands read `DATABASE_URL` from the invoking environment and never auto-load `.env.local`.

## Rollback and incident response

Before version 2, stop rollout, leave expand columns/tables in place, and keep token-bearing rows on their durable retry/repair path. Never mint replacement claim tokens.

After version 2, do not lower the database version and do not restore legacy replies. Disable live automation if a compatible sender cannot be kept online. Preserve inbound events, canonical messages, jobs, streams, and outbound audit rows for investigation.

Record for each rollout: organization ID, build SHA, migration SHA, actor, validation output, old-worker drain timestamps, activation timestamp, rejection counts, queue latency, lock wait, transaction p95, CPU, rows scanned, and compute-active time when the database provider exposes it.

## Embedded representative baseline

The 2026-08-24 Phase 8 gate uses isolated PostgreSQL with 10,000 inbound events/jobs, 10,000 aliases, 100 active streams, 10,000 cleanup candidates, 600 backfill candidates, and 1,000 outbound rows. Point lookups inspect at most two authority rows. Representative observed execution times were 0.01–0.02 ms for provider dedupe, alias, generation, claim, bind, outbox authorization, and orphan lookups; bounded backfill was 0.19 ms and cleanup 0.23 ms. The complete plan suite took 4.99 ms wall time and 1.66 ms process CPU in that run.

With stream A locked, a transaction updating stream B completed in 0.88 ms. A competing update to stream A reached the configured lock timeout in 255.25 ms, proving per-stream isolation and same-stream serialization. Backfill and cleanup each returned no more than 500 rows; their indexed scans inspected at most 1,000 relation rows per scan under the representative fixture. `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` records planned/actual rows and shared buffer blocks on every run.

Embedded PostgreSQL does not expose Neon compute-active time, so that field is `unavailable_embedded`. During an authorized disposable-Neon rollout rehearsal, record compute-active time beside the same query, lock, CPU, transaction-duration, row, and buffer measurements. Absence of that provider-only metric does not authorize use of production Neon for testing.
