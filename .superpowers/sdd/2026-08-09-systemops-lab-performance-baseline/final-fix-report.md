# Final fix wave report

Date: 2026-08-09

Branch: `feat/systemops-lab-performance`

Scope source: `final-review-findings.md`

## Safety and scope

- Worked only in `systemops-sales-engine-lab-performance`.
- Did not connect to a database, Z-API, WhatsApp, Vercel, or any other remote service.
- Did not read or use credentials.
- Did not push, open a PR, merge, or deploy.
- Preserved telemetry off by default and the 30-sample browser-session cap.
- Added no content-ready instrumentation, realtime, cache, read model, pagination, optimistic mutation, or UX change.

## Finding 1 — Collection protocol coverage

Status: fixed in the collection protocol.

Files:

- `docs/operations/performance-baseline.md`

RED evidence:

- The reviewed protocol put 30 cold and 30 warm samples for four surfaces into each device session (240 requested client samples) while the implementation accepts at most 30 samples in one `sessionStorage` session.
- The payload emits `cacheState: "unknown"`, and the summary key does not include cache state, so a combined export could not preserve cold/warm cohort identity.

GREEN result:

- Defined 16 independent cohorts: device (`desktop`/`mobile`) × surface (`inbox`/`conversation`/`agenda`/`dashboard`) × cache condition (`cold`/`warm`).
- Required one new browser session, one export, and one offline report per cohort, with exactly 30 accepted client samples.
- Required serial collection, uninstrumented hard-navigation resets between repetitions, and invalidation rather than post-hoc splitting when a file mixes client surfaces or cache conditions.
- Kept cohort identity external and non-PII, in the record sheet and filenames only; it is not added to payloads or logs.
- Added explicit record-sheet fields and prohibited cross-cohort aggregation.

Testing note:

- This is human operational prose with no executable protocol contract in the repository. Per the test-quality rule, no source-grep/change-detector test was added.

Commit: `02dcd97 docs(observability): correct baseline cohort protocol`

## Finding 2 — Incorrect `soft_navigation` milestone mapping

Status: fixed in the protocol; non-measurable targets remain explicitly deferred.

Files:

- `docs/operations/performance-baseline.md`

RED evidence:

- `NavigationPerformanceReporter` completes on pathname change, while the four target surfaces can render `loading.tsx` skeletons.
- The existing mount behavior clears a stale pending navigation mark and emits no initial-open client sample.

GREEN result:

- Mapped `soft_navigation` only to visual navigation feedback after an instrumented tap.
- Marked previously visited screen readiness, first application open, open-conversation content readiness, and new-message visibility as `not_measurable` in this baseline.
- Prohibited combining client and server timings to claim those content-ready targets.
- Declared the future milestone needed: explicit per-surface content-ready signals, a first-open start/end contract, and validated cache-state attribution. No such instrumentation was added in this wave.

Verification:

- `src/__tests__/NavigationPerformance.test.ts`: 6/6 passed, including pathname completion and initial-mount stale-mark clearing.
- No documentation grep test was added.

Commit: `02dcd97 docs(observability): correct baseline cohort protocol`

## Finding 3 — Zod in the observed client graph

Status: fixed with a client-safe/runtime contract split.

Files:

- Added `src/application/observability/performance-contract.ts`
- Updated `src/application/observability/performance-telemetry.ts`
- Updated `src/application/observability/navigation-timing.ts`
- Updated `src/components/performance/navigation-performance-reporter.tsx`
- Added `src/__tests__/PerformanceTelemetryClientSafety.test.ts`

RED:

```text
npx vitest run src/__tests__/PerformanceTelemetryClientSafety.test.ts
1 failed
Cause: runtime validation reached the client performance graph
Import reached src/application/observability/performance-telemetry.ts:1
```

GREEN:

- Moved constants, types, route normalization, and static soft-navigation sample construction into the dependency-free `performance-contract.ts`.
- Client timing and reporter modules import only the client-safe contract.
- Kept strict Zod parsing in `performance-telemetry.ts`; endpoint, server logger/summary, and CLI continue to use it.
- Preserved the exact sample payload, normalized route mapping, privacy rejection behavior, telemetry default, and cap of 30.

```text
npx vitest run \
  src/__tests__/PerformanceLogger.test.ts \
  src/__tests__/PerformanceTelemetryClientSafety.test.ts \
  src/__tests__/PerformanceTelemetry.test.ts \
  src/__tests__/NavigationPerformance.test.ts \
  src/__tests__/PerformanceTelemetryRoute.test.ts \
  src/__tests__/PerformanceSummary.test.ts
6 files passed; 38 tests passed

npm run typecheck
exit 0
```

Commit: `2ae7cff fix(observability): keep zod out of client telemetry`

## Minor finding — Remote disconnected readiness test

Status: explicit regression coverage added; runtime behavior was already correct.

Files:

- `src/__tests__/SystemOpsLabReadiness.test.ts`

Coverage:

- Uses `SYSTEMOPS_LAB_CHECK_REMOTE=true`.
- Returns a disconnected remote status containing a synthetic error detail.
- Asserts exactly one remote status call.
- Asserts `connected: false` and blocker `remote_not_connected`.
- Asserts the JSON output contains no remote detail, token, client token, or webhook secret.

RED/GREEN:

- Baseline GREEN confirmed the requested behavior already existed.
- Mutation RED: temporarily removed the `remoteConnected === false` blocker mapping; the focused test failed with received `blockers: []` and `readyForControlledInbound: true`.
- Restored the production mapping; `src/__tests__/SystemOpsLabReadiness.test.ts` passed 6/6.
- The mutation was not retained, and no runtime file changed in this commit.

Commit: `57b6a3a test(lab): cover disconnected remote readiness`

## Final verification

Focused suite:

```text
npm test -- \
  src/__tests__/PerformanceTelemetryClientSafety.test.ts \
  src/__tests__/PerformanceTelemetry.test.ts \
  src/__tests__/NavigationPerformance.test.ts \
  src/__tests__/PerformanceLogger.test.ts \
  src/__tests__/PerformanceTelemetryRoute.test.ts \
  src/__tests__/PerformanceSummary.test.ts \
  src/__tests__/SystemOpsLabReadiness.test.ts
7 files passed; 44 tests passed
```

Repository verification:

```text
npm run verify
Drizzle meta OK
eslint: exit 0
tsc --noEmit: exit 0
236 test files passed
2153 tests passed; 10 skipped
exit 0
```

Diff hygiene:

```text
git diff --check
exit 0
```

The full suite continues to print existing warning/error logs from tests that exercise failure handling; they did not fail verification and were already listed for separate triage.

## Deferred items preserved

- `embedded-postgres` beta/install weight remains acceptable only if CI passes on Ubuntu with Node 22 before merge.
- Explicit schema-version and duration boundary tests remain deferred.
- Additional nearest-rank boundary tests remain deferred.
- Existing warning/error test logs remain deferred for separate triage.
- Dry-run per-invariant booleans remain deferred; guards stay enforced in policy/SQL.
- Content-ready, first-open, and cache-attribution instrumentation remains a future milestone.
- New-message visibility remains dependent on the planned Phase 3 realtime milestone.

## Concerns and required follow-up

- Local verification cannot establish the `embedded-postgres` install/runtime result on Ubuntu/Node 22; CI must pass before merge.
- No real baseline cohort was collected in this correction wave. Only visual-feedback targets are measurable with the current client signal.
- No remote readiness call was made; the disconnected path was verified with injected local dependencies only.
