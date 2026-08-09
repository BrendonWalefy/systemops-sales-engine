# Performance baseline protocol

This protocol is for preview/Lab collection only. It does not authorize production telemetry, does not enable automation, and does not establish that any optimization has occurred.

## Guardrails

- Use only synthetic Lab rows. Do not enter patient data, names, phone numbers, conversation content, URLs containing IDs, or credentials.
- Set `PERFORMANCE_TELEMETRY_ENABLED=1` only for the collection session.
- Keep all automation off for the session.
- Run desktop and mobile as two separate sessions and export their logs separately. Never combine them before recording the baseline.
- Disable telemetry immediately after both collections.

## Collection

For each device session, collect 30 cold navigations and 30 warm navigations for each surface:

- Inbox
- Conversation
- Agenda
- Dashboard

Export Vercel JSONL logs filtered to `scope=PerformanceTelemetry` and `msg=performance.sample`. The export must contain only the allowed telemetry contract; do not add request headers, cookies, query strings, clinic identifiers, or any other log fields to the report.

Run the offline, read-only report separately for each export:

```bash
npm run performance:summary -- ./performance-lab.jsonl
```

The report groups by `source|surface|operation|outcome`. A group with fewer than 30 samples is explicitly marked `insufficient`; it is not a baseline result.

## Record sheet

For every sufficiently covered group, record the current p50, p75, p95, maximum, query-count observations, payload-size observations, device class, cache condition, and whether the applicable design target is already met. Preserve the two original Lab exports with the record, subject to the same synthetic-data restriction.

Do not describe this baseline as an optimization, regression, production benchmark, or real-user measurement. It is a reproducible Lab snapshot for later comparison.

## Approved comparison targets

| Metric | Design target |
| --- | --- |
| Visual feedback after tap | < 100 ms |
| Previously visited screen | p75 < 300 ms |
| First application open | p75 < 1.5 s |
| Open conversation | p75 < 800 ms |
| New message visible | <= 1 s (measured only after Phase 3 realtime work) |
