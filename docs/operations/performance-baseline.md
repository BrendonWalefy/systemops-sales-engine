# Performance baseline protocol

This protocol is for preview/Lab collection only. It does not authorize production telemetry, does not enable automation, and does not establish that any optimization has occurred.

## Guardrails

- Use only synthetic Lab rows. Do not enter patient data, names, phone numbers, conversation content, URLs containing IDs, or credentials.
- Set `PERFORMANCE_TELEMETRY_ENABLED=1` only for the collection session.
- Keep all automation off for the session.
- Keep the client limit at 30 accepted samples per browser session. Do not clear or bypass the limit to extend a cohort.
- Collect only one device × surface × cache-condition cohort at a time. Give every cohort its own browser session, bounded collection window, and separately filtered client/server exports and offline reports.
- Assign the cohort an external non-PII ID, such as `desktop-inbox-cold-01`. Keep that ID in the record sheet and artifact filenames only; never add it to the telemetry payload or application logs.
- Never combine cohort exports, even when their telemetry rows have the same `source|surface|operation|outcome` key.
- Disable telemetry immediately after all planned cohorts are exported.

## Collection

The collection matrix contains 16 independent cohorts: two device classes × four surfaces × two cache conditions. Each cohort contains exactly 30 accepted client samples from one new browser session:

| Dimension | Allowed values |
| --- | --- |
| Device class | `desktop`, `mobile` |
| Surface | `inbox`, `conversation`, `agenda`, `dashboard` |
| Cache condition | `cold`, `warm` |

Collect the cohorts serially. For a cold cohort, start a fresh synthetic browser session and keep the browser cache disabled for the 30 measured navigations. For a warm cohort, start a different fresh session, hard-open the target surface once, wait for its data and assets to settle, then hard-open the synthetic source page. Record the collection-window start only after that source page has settled. The prime and the return used to establish the starting state are outside the collection window. Then collect 30 navigations with the browser cache enabled. Do not collect another surface or cache condition in that session.

Use the same synthetic source page for all 30 repetitions in a cohort. Enter that source page through an uninstrumented hard navigation, make exactly one instrumented tap to the target surface, and then hard-navigate back to the source before the next repetition. This keeps non-target soft navigations from consuming the shared 30-sample session allowance. For a conversation cohort, select only the predetermined synthetic conversation and never record its route or identifier in the artifacts.

The client payload currently records `cacheState: "unknown"`, and the summary does not group by cache condition. Cache identity therefore comes only from the externally recorded cohort procedure. An export containing more than one cache condition or more than one target surface is invalid and must be recollected, not split or relabeled after the fact.

End the collection window after the 30th target navigation has settled and before any final hard navigation back to the source. Immediately after each cohort, derive two separate Vercel JSONL exports from that exact window, always filtered to `scope=PerformanceTelemetry` and `msg=performance.sample`:

1. client target export: `source=client`, the cohort's normalized target `surface`, and `operation=soft_navigation`;
2. server target export: `source=server`, the same target `surface`, and only the server operations owned by that target page.

This surface/source filtering deterministically excludes server samples produced by auxiliary hard navigations on the synthetic source page. The post-prime window excludes the target's warm-up request. If the source and target normalize to the same surface, the cohort is invalid; choose a source on a different normalized surface and recollect. Name the two exports and reports with the external cohort ID plus `client` or `server`. Each export must contain only the allowed telemetry contract; do not add request headers, cookies, query strings, clinic identifiers, or any other log fields to the report.

Run the offline, read-only report separately for each filtered export:

```bash
npm run performance:summary -- ./desktop-inbox-cold-01-client.jsonl
npm run performance:summary -- ./desktop-inbox-cold-01-server.jsonl
```

The report groups by `source|surface|operation|outcome`; the external cohort ID supplies device and cache identity. A client group with fewer than 30 samples is explicitly marked `insufficient`; it is not a baseline result. Each expected server operation is evaluated as its own group and must contain exactly the samples produced inside the bounded post-prime window. A mismatched source, target surface, or operation invalidates that filtered export; do not remove rows manually after export.

## What `soft_navigation` measures

`soft_navigation` starts at an instrumented tap and completes when the client observes the target pathname. Because every target route can render a `loading.tsx` skeleton at that point, it measures visual navigation feedback only. It does not establish that target-screen data or useful conversation content is ready.

The first application open produces no `soft_navigation` sample: on initial mount the reporter clears any stale pending mark. This baseline therefore cannot measure first-open readiness. It also cannot measure content-ready time for a previously visited screen or an opened conversation, regardless of whether the cohort is labeled cold or warm.

Do not use `soft_navigation`, server-operation timings, or a combination of the two to declare those content-ready targets achieved. A future instrumentation milestone must first define explicit content-ready signals for each surface, a first-application-open start/end contract, and validated cache-state attribution. That work is outside this measurement-only phase.

## Record sheet

Create one record-sheet row per report group and include these explicit fields:

- external cohort ID;
- device class, target surface, and cache condition;
- browser-session start and end timestamps in UTC;
- collection-window start and end timestamps in UTC, recorded after warm priming when applicable;
- client export/report filenames and server export/report filenames;
- exact client filter and exact target-server filter used;
- source, normalized telemetry surface, operation, and outcome;
- accepted sample count and `sufficient`/`insufficient` coverage status;
- p50, p75, p95, and maximum;
- query-count and payload-size observations, when separately observed;
- mapped design target;
- target evaluation status: `met`, `not_met`, or `not_measurable`;
- reason when `not_measurable` or `insufficient`;
- operator notes containing no PII, tenant identity, route IDs, or credentials.

Preserve all 16 cohorts' client and server exports and reports separately with the record, subject to the same synthetic-data restriction. Do not calculate a cross-cohort aggregate and do not merge the paired client/server files.

Do not describe this baseline as an optimization, regression, production benchmark, or real-user measurement. It is a reproducible Lab snapshot for later comparison.

## Approved comparison targets

| Metric | Design target | Baseline mapping |
| --- | --- | --- |
| Visual feedback after tap | < 100 ms | Measurable with `client|<surface>|soft_navigation|ok`. |
| Previously visited screen | p75 < 300 ms | Measurable with `client|<surface>|content_ready|ok`. |
| First application open | p75 < 1.5 s | `not_measurable`: no emitter can currently distinguish a cold start from an un-instrumented soft navigation into an instrumented surface. |
| Open conversation | p75 < 800 ms | Measurable with `client|conversation|content_ready|ok`. |
| New message visible | <= 1 s | `not_measurable`: requires the planned Phase 3B realtime milestone. |

The two targets that moved out of `not_measurable` — previously visited
screen and open conversation — did so because the `content_ready` operation
was added to the telemetry contract. It fires after paint, once the surface's
data is rendered, so it measures content readiness rather than the pathname
change that `soft_navigation` stops at.

`app_first_open` is also in the telemetry contract, but no emitter currently
produces it, and first application open stays `not_measurable`. The reporter
that emits `content_ready`, `src/components/performance/content-ready-reporter.tsx`,
decides what the measurement *means* before it decides the number:

- On a **soft navigation** it measures from the navigation mark written at
  click time by `markNavigationStartInSession` to the paint, and emits
  `content_ready`. Earlier revisions of this document assumed the elapsed
  value of `performance.now()`; that is time since the document's
  `timeOrigin`, so a conversation opened 45 s into a session reported
  ~45,000 ms against an 800 ms target.
- With **no mark**, the reporter emits nothing, regardless of whether this is
  the first content-ready of the document. A hard load has no mark because
  nothing has been clicked yet — but so does a soft navigation into an
  instrumented surface (`inbox_list` or `conversation`) from a page that
  carries no `ContentReadyReporter` of its own, such as the Dashboard. Both
  look identical from inside the reporter: first mount in the document, no
  mark. There is currently no way to tell them apart, so the reporter would
  otherwise report the elapsed session time — potentially tens of seconds of
  reading the Dashboard — as a false first-open measurement. A previous
  revision of this document and this reporter did exactly that, mapping this
  case to `app_first_open`; it produced untrustworthy samples and was
  reverted. Building a real first-open discriminator is deliberately out of
  scope for this phase and is left for a future milestone.

Being measurable is not being measured. No cohort has been collected against
these operations, so none of these targets has a baseline value yet, let alone
a met/not-met verdict.

## Comparing against the Phase 1 baseline after Phase 3A

Phase 3A moved the clinic-wide portion of the Inbox read out of
`inbox_base_query` and into a new `inbox_segment_scan` operation.
`inbox_base_query` now covers only the bounded page fetch.

A before/after reading of `inbox_base_query` alone is therefore
apples-to-oranges and will overstate the improvement. Any comparison against a
Phase 1 cohort must **sum `inbox_base_query` and `inbox_segment_scan`** to
represent the same work the Phase 1 number covered. Recording them separately
is still correct and useful — it shows which half the cost sits in — but the
sum is the only figure comparable to the earlier baseline.
