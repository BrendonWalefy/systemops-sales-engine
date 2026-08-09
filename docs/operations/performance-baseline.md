# Performance baseline protocol

This protocol is for preview/Lab collection only. It does not authorize production telemetry, does not enable automation, and does not establish that any optimization has occurred.

## Guardrails

- Use only synthetic Lab rows. Do not enter patient data, names, phone numbers, conversation content, URLs containing IDs, or credentials.
- Set `PERFORMANCE_TELEMETRY_ENABLED=1` only for the collection session.
- Keep all automation off for the session.
- Keep the client limit at 30 accepted samples per browser session. Do not clear or bypass the limit to extend a cohort.
- Collect only one device × surface × cache-condition cohort at a time. Give every cohort its own browser session, log export, and offline report.
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

Collect the cohorts serially. For a cold cohort, start a fresh synthetic browser session and keep the browser cache disabled for the 30 measured navigations. For a warm cohort, start a different fresh session, hard-open the target surface once to prime it without producing a client sample, and then collect 30 navigations with the browser cache enabled. Do not collect another surface or cache condition in that session.

Use the same synthetic source page for all 30 repetitions in a cohort. Enter that source page through an uninstrumented hard navigation, make exactly one instrumented tap to the target surface, and then hard-navigate back to the source before the next repetition. This keeps non-target soft navigations from consuming the shared 30-sample session allowance. For a conversation cohort, select only the predetermined synthetic conversation and never record its route or identifier in the artifacts.

The client payload currently records `cacheState: "unknown"`, and the summary does not group by cache condition. Cache identity therefore comes only from the externally recorded cohort procedure. An export containing more than one cache condition or more than one target surface is invalid and must be recollected, not split or relabeled after the fact.

Immediately after each cohort, export only its time window from Vercel JSONL logs filtered to `scope=PerformanceTelemetry` and `msg=performance.sample`. Name the export and report with the external cohort ID. The export must contain only the allowed telemetry contract; do not add request headers, cookies, query strings, clinic identifiers, or any other log fields to the report.

Run the offline, read-only report separately for each export:

```bash
npm run performance:summary -- ./desktop-inbox-cold-01.jsonl
```

The report groups by `source|surface|operation|outcome`; the external cohort ID supplies device and cache identity. A client group with fewer than 30 samples is explicitly marked `insufficient`; it is not a baseline result. More than one client surface group in a cohort export also invalidates that export.

## What `soft_navigation` measures

`soft_navigation` starts at an instrumented tap and completes when the client observes the target pathname. Because every target route can render a `loading.tsx` skeleton at that point, it measures visual navigation feedback only. It does not establish that target-screen data or useful conversation content is ready.

The first application open produces no `soft_navigation` sample: on initial mount the reporter clears any stale pending mark. This baseline therefore cannot measure first-open readiness. It also cannot measure content-ready time for a previously visited screen or an opened conversation, regardless of whether the cohort is labeled cold or warm.

Do not use `soft_navigation`, server-operation timings, or a combination of the two to declare those content-ready targets achieved. A future instrumentation milestone must first define explicit content-ready signals for each surface, a first-application-open start/end contract, and validated cache-state attribution. That work is outside this measurement-only phase.

## Record sheet

Create one record-sheet row per report group and include these explicit fields:

- external cohort ID;
- device class, target surface, and cache condition;
- browser-session start and end timestamps in UTC;
- export filename and report filename;
- source, normalized telemetry surface, operation, and outcome;
- accepted sample count and `sufficient`/`insufficient` coverage status;
- p50, p75, p95, and maximum;
- query-count and payload-size observations, when separately observed;
- mapped design target;
- target evaluation status: `met`, `not_met`, or `not_measurable`;
- reason when `not_measurable` or `insufficient`;
- operator notes containing no PII, tenant identity, route IDs, or credentials.

Preserve all 16 original Lab exports and their 16 reports separately with the record, subject to the same synthetic-data restriction. Do not calculate a cross-cohort aggregate.

Do not describe this baseline as an optimization, regression, production benchmark, or real-user measurement. It is a reproducible Lab snapshot for later comparison.

## Approved comparison targets

| Metric | Design target | Baseline mapping |
| --- | --- | --- |
| Visual feedback after tap | < 100 ms | Measurable with `client|<surface>|soft_navigation|ok`. |
| Previously visited screen | p75 < 300 ms | `not_measurable`: current navigation timing stops at pathname/loading feedback, not useful content readiness. |
| First application open | p75 < 1.5 s | `not_measurable`: initial reporter mount emits no sample. |
| Open conversation | p75 < 800 ms | `not_measurable`: `soft_navigation` can stop on the conversation skeleton. |
| New message visible | <= 1 s | `not_measurable`: requires the planned Phase 3 realtime milestone. |
