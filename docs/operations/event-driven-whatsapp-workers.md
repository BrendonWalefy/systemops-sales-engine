# Event-driven WhatsApp workers and Neon autosuspend

This runbook covers the `message.process` and `message.send` queues. The durable
PostgreSQL rows remain the source of truth; event-driven wakes only reduce the
time until a worker claims committed work.

## Runtime contract

- Ingress commits the inbound ledger event, stream authority, generation and
  `message.process` job before requesting a worker wake.
- A newly created process job schedules one authenticated, one-shot request to
  `message-worker` using its persisted `run_at`. The request may wait once for
  at most 30 seconds; it never polls or heartbeats.
- A newly created authorized outbound and `message.send` job requests
  `sender-worker` only after the durable write has committed.
- Duplicate provider deliveries and deduplicated sender jobs request no new
  wake.
- Wake failures never roll back accepted ingress or committed outbound work.
- Clinic debounce windows longer than 30 seconds are left to the durable
  fallback cron instead of opening a long-running function.
- `message-worker` and `sender-worker` keep their existing authorization,
  leases, `SKIP LOCKED`, retry, orphan reconciliation, stream authority and
  sender preflight checks.

The wake endpoint returns `202` before the one-shot task runs. The task executes
inside the Vercel request lifecycle through `after(...)`; there is no daemon,
new worker service, alternate database adapter or continuously running process.

## Fallback schedule

Both durable queues remain recoverable when a wake is lost:

| Route | Fallback |
| --- | --- |
| `/api/cron/message-worker` | every 10 minutes |
| `/api/cron/sender-worker` | every 10 minutes |

Other recurring maintenance tasks are aligned on the same minute grid where
their business cadence permits it. No cron route is removed. The exact route
set and schedules are enforced by `CronScheduleGrid.test.ts`.

Before this change, the two empty queue workers alone generated 2,880 scheduled
invocations per day. Their fallback schedules generate 288, a 90% reduction in
empty scheduled checks. Across all schedules changed in this rollout, the
static schedule falls from 3,348 to 660 invocations per day. These are schedule
calculations, not a billing forecast: event-driven invocations scale with real
work and Vercel/Neon billing must be measured after deployment.

## Recorded baseline

The read-only production snapshot recorded on 2026-08-25 at
`03:10:34.586Z` contained:

| Queue | Done | Failed | Due now |
| --- | ---: | ---: | ---: |
| `message.process` | 8,051 | 10 | 0 |
| `message.send` | 1,798 | 0 | 0 |

No pending row was observed. The database postmaster had been active since
2026-07-18; no compute suspension was observed during that interval, which is
consistent with the old one-minute wake pattern. This point-in-time aggregate
does not establish causation, latency improvement or cost savings.

## Deployment gate

1. Run the worker, webhook, sender, debounce, database-authority and cron-grid
   tests, then exact `npm run verify` on a clean tree.
2. Require GitHub Verify, Migration CI and Vercel preview to be green.
3. Merge through `develop`, then the normal `develop` to `main` release PR.
4. Confirm the production deployment is `READY` at the expected SHA.
5. Confirm no migration was introduced by this worker/cron change.
6. Observe at least one newly committed inbound and any resulting outbound
   through aggregate logs only. Do not expose message content or addresses.
7. Keep Neon autosuspend unchanged until queue and provider signals are healthy.

## Monitoring and stop conditions

Record UTC timestamps and aggregate values for both queues:

- oldest due pending job age and due pending count by queue;
- processing/locked count and oldest lock age;
- retry and `dead` counts;
- `worker.run.failed`, authorization rejection and orphan-reconciliation logs;
- provider delivery failures and latency;
- PostgreSQL CPU, lock waits, active sessions and transaction duration;
- Neon compute-active time and suspend/resume transitions.

Stop the rollout and restore the last known-good setting if any of these occur:

- due work survives past one complete 10-minute fallback window;
- queue age or first-reply latency regresses materially;
- provider failures, duplicate delivery, authorization rejection or dead jobs
  increase unexpectedly;
- locks persist after a worker invocation or affect another tenant;
- compute cannot resume reliably after suspension.

## Worker rollback

`DISABLE_EVENT_DRIVEN_WORKERS=1` disables both event-driven wake requests. It
does not change durable writes and it does not disable fallback crons.

For a planned rollback that preserves the old latency:

1. Revert only the cron-grid commit so both queue routes run every minute.
2. Deploy and verify the one-minute schedules are active.
3. Set `DISABLE_EVENT_DRIVEN_WORKERS=1` for the affected environment.
4. Drain both queues and verify due count, locks and provider errors.
5. Revert the worker-wake commit only if the flag is insufficient.

For an active request storm, set the disable flag first, accept the temporary
10-minute fallback bound, and immediately deploy the one-minute schedule
rollback. Never delete queue rows or bypass sender authorization as rollback.

## Neon autosuspend rollout

This section authorizes no production change by itself. Before each apply,
resolve the exact production project, branch, endpoint and current setting
without printing a connection string or credentials.

1. Confirm the current timeout is 300 seconds and record the actor and UTC time.
2. Record queue, provider, lock, CPU and compute-active baselines.
3. Change only that production compute endpoint from 300 to 120 seconds.
4. Observe multiple message/sender cycles and at least two complete fallback
   windows. Restore 300 immediately on a stop condition.
5. If healthy, change only the same endpoint from 120 to 60 seconds.
6. Repeat the same observation. Restore 120 immediately on regression.
7. Record the 60-second setting as provisional until the 24-hour comparison is
   complete.

Do not present immediate observations as a 24-hour cost result. The final
record must distinguish configuration confirmation, short-window operational
health and the still-pending 24-hour compute-active comparison.
