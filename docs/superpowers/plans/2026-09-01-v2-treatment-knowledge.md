# V2 Treatment Comparison, Differentials and FAQ Implementation Plan

**Goal:** Complete treatment comparison, registered differentials and structured FAQ answers in the
V2 runtime without a second knowledge store or additional model call.

**Architecture:** Reuse treatment descriptions, the active playbook and the current response-plan
pipeline. Extend `dental-explanation` for paired treatments and add one small read-only
`dental-playbook-knowledge` capability. FAQ is the only new stored content because no structured
question/answer owner exists today.

**Spec:** `docs/superpowers/specs/2026-09-01-v2-treatment-knowledge-design.md`

## Constraints

- V2-only; no V1 runtime, fallback or config.
- The model understands and verbalizes; code resolves and authorizes.
- One Understanding and at most one verbalizer call.
- No query accepts a tenant identifier from model output.
- No free-text `notes` mining, embeddings, vector search, polling or new worker.
- Drizzle migration generated from `schema.ts`, never hand-edited.
- Every phase is RED -> GREEN -> refactor and ends in a focused local commit.

## Phase 1: Structured FAQ owner and existing UI

**Files:**

- `src/infrastructure/db/schema.ts`
- `src/application/config/editorial-config.ts`
- `src/application/config/faq-config.ts` (new)
- `src/app/(clinic)/app/settings/playbook/[id]/editor-client.tsx`
- `src/app/(clinic)/app/settings/playbook/playbook-version-actions.ts`
- schema/UI/publication tests and generated `drizzle/0107_*`

1. RED: assert the FAQ schema, strict limits, duplicate rejection, active-version read and exact
   tenant-scoped save/publication behavior.
2. GREEN: add `faqs` to `playbook_versions`, parser, editor rows and `EditorialConfig`.
3. Generate with `npm run db:generate`; stop if SQL is not one additive JSONB column/default.
4. Run focused tests, `npm run db:check`, lint, typecheck and `git diff --check`.
5. Commit: `feat(playbook): add structured frequently asked questions`.

## Phase 2: Closed Understanding vocabulary

**Files:**

- `src/domain-packs/dental/vocabulary.ts`
- `src/domain-packs/dental/understanding.ts`
- `src/domain-packs/dental/understanding-prompt.ts`
- `src/infrastructure/adapters/ai/live-dental-understanding.ts`
- `src/infrastructure/adapters/ai/DentalUnderstandingProvider.ts`
- `src/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel.ts`
- `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Understanding contract/prompt/model tests

1. RED: require exactly two `serviceCandidates` for comparison, exact `faqQuestion` for FAQ and
   forbid those entities for unrelated requests.
2. GREEN: add the three requests/entity and pass bounded canonical FAQ questions (never answers) to
   the existing one-call Understanding boundary.
3. Refactor fixture builders to one exact contract factory; do not loosen strict schema tests.
4. Run focused tests, lint, typecheck and diff check.
5. Commit: `feat(v2): classify treatment and playbook knowledge`.

## Phase 3: Deterministic treatment comparison

**Files:**

- `src/domain-packs/dental/ports.ts`
- `src/domain-packs/dental/capabilities.ts`
- `src/domain-packs/dental/explanation-capability.ts`
- `src/application/conversation-v2/dental-live-adapters.ts`
- explanation/capability/adapter/live-handler tests

1. RED: compare two exact same-tenant treatments; reject one/more-than-two, duplicates, ambiguity,
   missing or unsafe descriptions and cross-tenant candidates.
2. GREEN: resolve both from one cached tenant catalog and emit paired `service_description` facts
   with exact treatment evidence.
3. Preserve single-service explanation behavior and no business effect.
4. Run focused tests, lint, typecheck and diff check.
5. Commit: `feat(v2): compare registered treatments safely`.

## Phase 4: Deterministic differentials and FAQ capability

**Files:**

- `src/domain-packs/dental/ports.ts`
- `src/domain-packs/dental/capabilities.ts`
- `src/domain-packs/dental/playbook-knowledge-capability.ts` (new)
- `src/domain-packs/dental/index.ts`
- `src/application/conversation-v2/dental-live-adapters.ts`
- response composer/provenance files reported by closed-contract tests
- capability/adapter/handler/verbalization tests

1. RED: prove exact active-version answers, stable order, missing FAQ, malformed values, stale draft
   exclusion, no content in trace and no cross-tenant read.
2. GREEN: close a read port over `context.editorial`, produce authorized facts/evidence and register
   the capability in the existing dental pack.
3. Add deterministic drafts and validator coverage; the verbalizer can only use allowed values.
4. Run focused tests, lint, typecheck and diff check.
5. Commit: `feat(v2): answer registered playbook knowledge`.

## Phase 5: Integrated proof and documentation

**Files:**

- `src/__tests__/ConversationV2JourneyMatrix.test.ts`
- `src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts`
- `docs/architecture/current.md`
- `docs/architecture/v2-capability-parity.md`

1. RED: add comparison, differentials and FAQ journeys through the real handler and embedded
   PostgreSQL path.
2. GREEN: require one event/process job/reply/send job/sent outbound, one Understanding, at most one
   verbalizer, no state/agenda mutation and no extra SQL statements or lock duration.
3. Update only the completed matrix rows; keep commercial, scheduling and journey gaps open.
4. Commit: `test(v2): prove treatment knowledge completion`.

## Delivery gates

Run on a clean tree:

```bash
npm run db:check
npm run lint
npm run typecheck
npm test -- --reporter=dot
npm run test:db:authority -- --reporter=dot
npm run build
npm run verify
git diff --check
git status --porcelain
```

Then push normally, open a focused PR to `develop`, wait for Verify, Migration CI and Vercel,
merge normally, open the standard `develop -> main` release PR, repeat remote gates and require the
production deployment to be READY at the exact merge SHA. Do not populate FAQ data, activate a
tenant or send a synthetic WhatsApp message during deployment.
