# V2 Trace Diagnosis and Final Parity Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand, privacy-safe Inbox diagnosis for V2 turns and a strict final parity corpus covering every V2 request and proactive authorization kind.

**Architecture:** A pure summary builder converts existing Decision Trace events into a closed read model returned by the existing tenant-scoped endpoint. A small client component fetches it only when opened. A strict synthetic JSON manifest indexes the already implemented capability and automation contracts without introducing a new runner or production effect.

**Tech Stack:** TypeScript 5.8, React 19, Next.js 16, Zod, Vitest, existing Decision Trace and corpus contracts.

**Spec:** `docs/superpowers/specs/2026-09-02-v2-trace-parity-design.md`

## Global Constraints

- V2 remains the only productive runtime; no V1 import, fallback or execution.
- No schema change or migration.
- No production data, tenant configuration, job, outbound or message mutation.
- Diagnostics are read-only, tenant-scoped, metadata-only and loaded on demand.
- Unknown metadata and corpus vocabulary fail closed.
- No polling, heartbeat, worker, cron or idle database activity.
- Every task follows RED → GREEN → refactor and ends in a reviewable local commit.

---

### Task 1: Closed conversation trace summary

**Files:**
- Create: `src/application/observability/conversation-trace-summary.ts`
- Create: `src/__tests__/ConversationTraceSummary.test.ts`

**Interfaces:**
- Consumes: `DecisionTraceEventV1[]`.
- Produces: `buildConversationTraceSummary(events): ConversationTraceSummaryV1`.

- [ ] Write RED cases for grouping, timestamp/sequence ordering, sent/ignored/failed/pending status,
      duration, selected metadata and forbidden sentinel text.
- [ ] Run `npm test -- src/__tests__/ConversationTraceSummary.test.ts`; require missing-module RED.
- [ ] Implement the strict metadata selectors and immutable summary.
- [ ] Rerun the focused test and `npx eslint` for both files.
- [ ] Commit `feat(v2): summarize decision traces safely`.

### Task 2: Tenant-scoped summary endpoint

**Files:**
- Modify: `src/app/api/conversations/[conversationId]/decision-trace/route.ts`
- Modify: `src/__tests__/ConversationDecisionTraceRoute.test.ts`

**Interfaces:**
- Consumes: `buildConversationTraceSummary(events)` from Task 1.
- Produces: existing response plus `summary`.

- [ ] Add RED assertions that the endpoint returns the summary only after tenant validation and
      never mixes cross-tenant or Owner-only rejection records into staff output.
- [ ] Run the route test and confirm assertion RED.
- [ ] Build the summary from the already loaded sanitized events without adding a query.
- [ ] Run route, summary, tenancy tests, ESLint and typecheck.
- [ ] Commit `feat(inbox): expose tenant-scoped v2 diagnosis`.

### Task 3: On-demand Inbox diagnostics

**Files:**
- Create: `src/app/(clinic)/app/inbox/[conversationId]/ConversationDiagnostics.tsx`
- Modify: `src/app/(clinic)/app/inbox/[conversationId]/page.tsx`
- Modify: `src/app/globals.css`
- Create: `src/__tests__/ConversationDiagnosticsSourceContract.test.ts`

**Interfaces:**
- Consumes: `GET /api/conversations/:conversationId/decision-trace` and
  `ConversationTraceSummaryV1`.
- Produces: an explicit button and compact read-only turn timeline.

- [ ] Add RED source-contract assertions for no mount-time fetch, endpoint path, no raw events or
      rejection body rendering, and page placement in the existing side panel.
- [ ] Run the focused test and confirm RED.
- [ ] Implement explicit on-demand fetch, loading/empty/error states and closed Portuguese labels.
- [ ] Add scoped responsive styling without changing the mobile page contract.
- [ ] Run diagnostics, route, Inbox waterfall and tenant-scope tests, ESLint and typecheck.
- [ ] Commit `feat(inbox): show v2 turn diagnosis on demand`.

### Task 4: Executable final parity corpus

**Files:**
- Create: `evals/v2-only/capability-parity-corpus.json`
- Create: `src/application/conversation-v2/v2-parity-corpus.ts`
- Create: `src/__tests__/V2CapabilityParityCorpus.test.ts`

**Interfaces:**
- Consumes: `DENTAL_REQUESTS`, `DENTAL_OUTCOME_SCHEMA`, `DECISION_TRACE_STAGES`, proactive
  authorization kinds and repository-relative evidence paths.
- Produces: `loadV2CapabilityParityCorpus(path): V2CapabilityParityCorpusV1`.

- [ ] Add RED parser/coverage tests requiring every inbound request and every proactive kind,
      unique IDs, terminal trace stages, valid outcomes/capabilities, existing evidence files and
      no obvious PII.
- [ ] Run the focused test and confirm missing manifest/parser RED.
- [ ] Implement the strict parser and a synthetic Portuguese scenario for every closed request and
      proactive kind, with exact evidence paths.
- [ ] Run corpus integrity, V2 journey matrix, capability suites, ESLint and typecheck.
- [ ] Commit `test(v2): publish final capability parity corpus`.

### Task 5: Documentation and final delivery gates

**Files:**
- Modify: `docs/architecture/v2-capability-parity.md`
- Modify: `docs/architecture/replay-and-decision-trace.md`

**Interfaces:**
- Consumes: the UI summary and parity manifest delivered by Tasks 1–4.
- Produces: current-state documentation with no roadmap placeholders.

- [ ] Mark the trace/corpus slice complete and document the exact diagnostic/privacy boundaries.
- [ ] Run targeted trace, corpus, Inbox and V2 capability suites.
- [ ] Run `npm run test:db:authority` with zero skips and `npm run test:db:schema`.
- [ ] Run `npm run measure:v2-only-runtime -- --baseline evals/v2-only/runtime-baseline.json`.
- [ ] Commit `docs(v2): close trace and parity roadmap`.
- [ ] On the clean commit run `npm run verify`, `git diff --check`, and a clean-clone
      `npm run build`.
- [ ] Open a focused PR to `develop`, wait for all checks, merge normally, promote through the
      standard `develop` → `main` PR, and confirm production `READY` without writing tenant data.

## Self-review

- Every spec requirement maps to one task; no schema, runtime effect or production write exists.
- Function/type names are consistent across tasks.
- The UI remains on-demand and adds no default query.
- The parity corpus indexes existing capabilities; it does not claim a private replay or run V1.
- No placeholder, alternate architecture or unresolved product decision remains.
