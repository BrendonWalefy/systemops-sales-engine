# V2 Hybrid Contextual Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make V2 replies context-aware and natural while deterministic capabilities remain the sole authority for facts and effects.

**Architecture:** Convert the accepted dental Understanding into a bounded generic conversation brief, carry it to the existing response stage, and include it in the single verbalization request. Existing response authorization, validation, deterministic fallback, durable outbox and sender remain unchanged.

**Tech Stack:** TypeScript 5.8, Next.js 16, Vitest, OpenAI chat completions adapter.

**Spec:** `docs/superpowers/specs/2026-08-27-v2-hybrid-response-design.md`

## Global Constraints

- V2 remains the only productive runtime; no import, selection or fallback to V1.
- The model never decides facts, effects, booking, handoff, outbox or delivery.
- No database schema, migration, tenant configuration, worker, job or sender change.
- No raw lead message, history, objection text, entity value or unknown key enters the response brief or Decision Trace.
- At most one Understanding call and one verbalization call; no inline model retry.
- Rejected or failed verbalization uses the deterministic response from the same authorized plan.
- Existing authority-v2, kill-switch, consent, takeover, opt-out and sender preflight contracts remain unchanged.
- Every behavior change follows RED -> GREEN -> refactor.

---

### Task 1: Define the bounded conversation brief

**Files:**
- Create: `src/conversation-core/composer/response-conversation-brief.ts`
- Create: `src/domain-packs/dental/response-conversation-brief.ts`
- Create: `src/__tests__/DentalResponseConversationBrief.test.ts`

**Interfaces:**
- Produces `ResponseConversationBrief` and `buildDentalResponseConversationBrief(understanding)`.
- Consumes only an already accepted `Understanding<DentalRequest>`.

- [ ] Write tests covering every allowed enum, unknown values failing to `null`, objection reduced to boolean, frozen output, and absence of raw entity/objection values.
- [ ] Run `npx vitest run src/__tests__/DentalResponseConversationBrief.test.ts` and record RED because the modules do not exist.
- [ ] Implement the smallest closed builder and freeze every returned object.
- [ ] Run the focused test GREEN.
- [ ] Run ESLint and typecheck for the new boundary.
- [ ] Commit `feat(v2): define bounded response conversation brief`.

### Task 2: Make the existing verbalizer contextual

**Files:**
- Modify: `src/conversation-core/composer/verbalization.ts`
- Modify: `src/conversation-core/composer/response-pipeline.ts`
- Modify: `src/conversation-core/turn-pipeline.ts`
- Modify: `src/infrastructure/adapters/ai/live-response-verbalizer.ts`
- Modify: `src/infrastructure/adapters/ai/response-verbalization-prompt.ts`
- Modify: `src/__tests__/V2VerbalizedResponsePipeline.test.ts`
- Modify: `src/__tests__/LiveResponseVerbalizer.test.ts`

**Interfaces:**
- `VerbalizationRequest` gains required `conversationBrief`.
- `ResponseStageInput.verbalization` carries that exact immutable brief.

- [ ] Add RED tests proving the pipeline forwards the brief unchanged and the OpenAI payload contains only the bounded fields.
- [ ] Add RED prompt tests for continuity, closing, sentiment/objection and precedence of authorized statements.
- [ ] Run the two affected files and confirm intended assertion failures.
- [ ] Thread the brief through the existing function boundaries without adding a model call.
- [ ] Bump prompt version to `response-verbalization.v8` and update only the contextual instructions.
- [ ] Run focused tests GREEN, then ESLint and typecheck.
- [ ] Commit `feat(v2): verbalize authorized replies with context`.

### Task 3: Bind accepted Understanding to the live response and trace strategy

**Files:**
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/core/observability/DecisionTrace.ts`
- Modify: `src/__tests__/V2LiveConversationHandler.test.ts`
- Modify: `src/__tests__/DecisionTracePrivacy.test.ts`
- Modify: `src/__tests__/V2OnlyRuntimePerformance.test.ts`

**Interfaces:**
- The handler derives the brief immediately after Understanding succeeds and passes it to completion of the same turn.
- `response.validated` exposes only strategy and numeric call counts.

- [ ] Add RED handler tests proving one understanding call, one verbalization call, exact same-turn brief, and zero verbalization calls for suppressed/no-safe-response paths.
- [ ] Add RED privacy tests proving no conversational values survive trace sanitization.
- [ ] Add RED performance contract asserting calls never exceed the frozen V2 baseline and no DB/job cardinality changes.
- [ ] Implement the same-turn binding and closed trace metadata.
- [ ] Run all focused V2 response/handler/trace/performance tests GREEN.
- [ ] Run ESLint and typecheck.
- [ ] Commit `feat(v2): bind hybrid context to the live turn`.

### Task 4: Verify and deliver

**Files:**
- Modify: `docs/architecture/current.md`
- Modify: `docs/operations/ai-contract-rejection-evidence.md`

- [ ] Update canonical docs to state the two-stage hybrid contract and no-retry behavior.
- [ ] Run all Understanding, response pipeline, handler, rejection-evidence, trace and performance tests.
- [ ] Run `npm run test:db:authority` with zero skips to prove no authority regression.
- [ ] Commit `docs(v2): document hybrid contextual responses`.
- [ ] With a clean tree run exact `npm run verify`.
- [ ] In a disposable clean clone run `npm ci`, `npm run build`, and `npm run verify`.
- [ ] Push normally, open PR to `develop`, wait for Verify/Migration/Vercel, and merge only when green.
- [ ] Open the standard release PR from `develop` to `main`, wait for checks, merge normally, and confirm production READY at the exact SHA.
- [ ] Record total wall time split into design, coding, local gates, remote CI and deployment.

## Self-review result

- Every spec invariant maps to Tasks 1-4.
- No task changes schema, migration, worker, outbox, sender or tenant state.
- Type names and prompt version are consistent across tasks.
- There are no placeholders or result-dependent product decisions.
- Rollback is code-only and cannot select V1.
