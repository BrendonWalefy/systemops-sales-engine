# V2 Scheduling Lifecycle Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-01-v2-scheduling-lifecycle-design.md`

Every phase follows RED -> GREEN -> refactor and ends in an independently reviewable commit.

## Phase 1: Closed scheduling understanding

**Files:** dental vocabulary/schema/prompt, AI provider/model input, live handler, understanding and
coverage tests.

1. RED: add varied Portuguese cases for list/cancel/reschedule, professional preference and pending
   slot selection; require `professional` to be null outside scheduling requests.
2. GREEN: add `list-appointments`, `entities.professional`, prompt v5 and tenant active-professional
   catalog input.
3. Refactor: prove one model call, strict unknown-key rejection, no IDs or answers in model input.
4. Verify focused tests, ESLint and typecheck.
5. Commit `feat(v2): understand complete scheduling requests`.

## Phase 2: Appointment lifecycle capability

**Files:** new lifecycle capability, dental ports/index/provenance, capability tests.

1. RED: list zero/one/multiple; deterministic appointment selection; cancel and reschedule claims;
   malformed/cross-capability results.
2. GREEN: implement `dental-appointment-lifecycle` with narrow read/write ports and typed outcomes.
3. Refactor: keep `dental-scheduling` ownership of slot confirmation; remove cancel/reschedule from
   escalation conflicts.
4. Verify capability/provenance/architecture tests, ESLint and typecheck.
5. Commit `feat(v2): model appointment lifecycle decisions`.

## Phase 3: Professional-aware availability and persisted offers

**Files:** live adapters, professional repository dependency, state-machine payload, slot helpers and
focused tests.

1. RED: exact/inactive/unknown/ambiguous/cross-tenant professional; work schedule; persisted
   professional binding; provider timestamp independence.
2. GREEN: tenant-bind professionals, pass the resolved ID into availability, persist it with the
   offer and carry it into booking.
3. Refactor: share normalization/ordering helpers and keep reads bounded/cached per turn.
4. Run scheduling unit suites and adapter tenant-isolation tests.
5. Commit `feat(v2): bind slot offers to professionals`.

## Phase 4: Safe cancellation

**Files:** `BookingService`, lifecycle adapters, repository fakes/tests and live-handler cases.

1. RED: exact binding, zero/multiple appointment behavior, duplicate retry, cross-tenant denial,
   active status requirement and gateway failure policy.
2. GREEN: expose the tenant+lead-bound cancellation path and invoke it only through the lifecycle
   write port.
3. Refactor: preserve existing UI/V1 callers while sharing the canonical cancellation primitive.
4. Run BookingService, cancellation, follow-up and sender regression suites.
5. Commit `feat(v2): cancel exact appointments safely`.

## Phase 5: Safe reschedule saga

**Files:** `BookingService`, state payload, scheduling/lifecycle adapters and concurrency tests.

1. RED: old appointment retained before commit; target conflict; external failure; DB failure with
   compensation; failed compensation handoff; exact-target retry; concurrent confirmation.
2. GREEN: reserve/revalidate/update/persist/confirm/release in the approved order and make the
   persisted replacement offer the only authority.
3. Refactor: isolate the saga result and compensation code; no catch-all success.
4. Run slot reservation, double-booking, calendar gateway and reschedule suites.
5. Commit `feat(v2): reschedule appointments with compensation`.

## Phase 6: Response, trace and conversational regressions

**Files:** outcome renderer/verbalization fixtures, live handler, Decision Trace tests, sanitized
conversation corpus and parity docs.

1. RED: natural list/cancel/reschedule replies, no success on failed effects, no sensitive trace
   metadata, no duplicate outbox.
2. GREEN: wire outcome provenance and authorized facts through the existing hybrid response path.
3. Refactor: keep one verbalization attempt and deterministic same-plan fallback.
4. Update only completed scheduling rows in parity/current architecture documentation.
5. Commit `test(v2): prove scheduling lifecycle parity`.

## Phase 7: Performance and full delivery

1. Add representative availability/list/cancel/reschedule fixtures to the existing V2 measurement;
   RED only if an approved threshold is exceeded.
2. Run:
   - focused scheduling and V2 suites;
   - `npm run verify:agenda`;
   - `npm run test:db:authority` with zero skips;
   - schema tests;
   - `npm run measure:v2-only-runtime -- --baseline evals/v2-only/runtime-baseline.json`;
   - `npm run verify` on a clean tree;
   - production `npm run build` in a clean clone when Turbopack requires local dependencies;
   - `git diff --check` and source scan for V1 fallback, polling and cross-tenant IDs.
3. Commit `perf(v2): verify scheduling lifecycle budgets` if fixtures/evidence changed.
4. Push normally, open a PR to `develop`, wait for Verify/Migration CI/Vercel, merge normally, then
   promote `develop` to `main` through the standard release PR.
5. Confirm production `READY` and deployed SHA. Do not activate or mutate a tenant.

## Self-review checklist

- No V1 runtime import or fallback.
- No model-owned IDs, availability, status or effect decision.
- No cancellation of multiple appointments without exact selection.
- No old appointment cancellation before safe reschedule commit.
- No duplicate booking/outbox under retry or concurrency.
- All reads and writes are exact-tenant and exact-lead scoped.
- Sender authority v2, kill switch, consent, takeover and safety gates remain unchanged.
- No migration, polling, heartbeat or new worker unless separately reviewed.

