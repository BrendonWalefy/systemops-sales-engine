# V2 Trace Diagnosis and Final Parity Corpus Design

Date: 2026-09-02
Status: approved by the master V2 continuation

## Objective

Close the final product slice of the V2 capability roadmap with two small additions built on the
existing runtime:

1. a read-only diagnostic summary in the Inbox that explains how each turn travelled from ingress
   to delivery; and
2. an executable, sanitized parity corpus that maps every definitive V2 request and proactive
   authorization kind to its expected owner, outcome family, trace contract and existing test
   evidence.

This is not a new observability platform, runtime, router or evaluation engine.

## Existing foundation

- `decision_traces` already stores tenant-scoped, 30-day metadata batches keyed by `turnId`;
- `/api/conversations/[conversationId]/decision-trace` already enforces session and conversation
  tenant scope and exposes AI rejection metadata only to Owner;
- the Inbox conversation page already owns operational diagnosis and handoff;
- the V2 request vocabulary, capabilities, outcome schema and proactive authorization kinds are
  closed contracts in code;
- the committed corpus, replay sandbox and capability tests remain the detailed behavioral
  evidence.

No schema or migration is required.

## Read-only diagnostic summary

`buildConversationTraceSummary(events)` is a pure application function. It groups events by
`turnId`, orders events by timestamp and sequence, and returns newest turns first. Each turn exposes
only closed metadata:

- terminal status: `sent`, `ignored`, `failed`, `pending_delivery` or `processing`;
- first/last timestamp and elapsed milliseconds;
- request, capability IDs, decision kinds, outcome types and semantic classes;
- response strategy, validation/rejection codes and handoff reason;
- outbound category and authorization kind;
- ordered stage names and timestamps.

The summary never copies message bodies, prompts, model output, phone, name, email, URL, provider
payload, claim token or free error text. Unknown metadata keys are discarded. Invalid timestamps do
not crash the endpoint and produce `durationMs: null`.

The existing endpoint adds `summary` while preserving `events` for compatibility. Its tenant and
role boundaries stay unchanged. The summary is built only after the conversation has been proven
to belong to the session clinic.

## Inbox surface

A client component named `ConversationDiagnostics` appears in the existing desktop side panel. It
does not fetch during normal page rendering. The operator explicitly expands “Diagnóstico da IA”,
which performs one no-store GET to the existing endpoint. It shows a compact newest-first list and
can expand one turn to its stage timeline.

The UI presents Portuguese labels for closed status/request/stage values, never raw metadata or
message content. Empty, loading and unavailable states are local UI states and do not alter the
conversation. Mobile remains unchanged because the current side panel is intentionally hidden
there.

## Final parity corpus

`evals/v2-only/capability-parity-corpus.json` is a committed synthetic manifest, not a production
conversation export. It contains:

- one or more sanitized Portuguese examples for every value in `DENTAL_REQUESTS`;
- one scenario for each proactive authorization kind (`follow_up`, `reminder`, `campaign`,
  `recovery`, `operational`);
- expected capability, allowed outcome family and required trace stages;
- exact existing test files that prove the scenario's deterministic business boundary.

The parser is strict and fails closed on an unknown request, capability, outcome, authorization
kind, trace stage, evidence path or duplicate ID. The corpus gate proves full request coverage,
full proactive-kind coverage, all evidence files exist, every scenario contains terminal trace
evidence, and no scenario contains obvious PII or production identifiers.

The manifest is a coverage index and a source for manual smoke prompts. It does not call a model,
claim production quality from one deterministic run, execute V1 or replace the approved replay
process. Language quality remains distributional and private replay still requires its existing
approval and sandbox controls.

## Safety and performance

- Productive execution remains V2-only and requires exact tenant authority version 2.
- No tenant, authority, outbox, job, message or configuration is changed by this slice.
- Diagnostics are session-bound, conversation-bound, read-only and loaded on demand.
- The default Inbox page gains zero database query and zero network request.
- Opening diagnostics performs one indexed conversation lookup and one indexed trace lookup, both
  already present in the endpoint.
- No polling, heartbeat, worker, cron or idle Neon activity is introduced.
- Decision Trace remains best-effort and cannot alter an answer or delivery.

## Test contract

- pure summary tests cover sent, ignored, failed, pending, malformed time, ordering and privacy;
- route tests cover tenant isolation, staff/Owner rejection visibility and the summary response;
- component/source contracts prove on-demand loading and no raw-event rendering;
- parity-corpus tests prove complete closed-vocabulary coverage and evidence paths;
- existing trace, replay, V2 capability, PostgreSQL authority, schema, performance, full verify and
  production build gates remain green.

## Rollback

The UI component, summary field and parity manifest can be reverted together without changing
runtime behavior or data. Existing raw metadata endpoint compatibility remains available during
rollback. No rollback may enable V1 or relax authority/sender controls.

## Non-goals

- no raw prompt/response viewer in the staff Inbox;
- no new table, migration, retention policy or analytics backend;
- no automatic replay, production model call or synthetic WhatsApp send;
- no new mobile layout in this slice;
- no V1 execution, fallback or comparison at runtime.
