# V2 Institutional Details and Social Reception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer parking and social-channel questions from structured tenant data and make V2
acknowledgements/farewells natural without adding a runtime, model call or business effect.

**Architecture:** Add two nullable organization-owned fields and edit them in the existing
Knowledge settings tab. Extend the existing tenant-bound Knowledge adapter and capability, and use
the existing dialogue move in `dental-reception` for social acts. All outputs continue through the
current authorized response plan, validator, outbox and sender.

**Tech Stack:** TypeScript 5.8, Drizzle/PostgreSQL, Next.js 16, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-v2-institutional-details-design.md`

## Global Constraints

- V2 is the only productive runtime; no V1 import, selector or fallback.
- No model retry or new model call; each inbound keeps one Understanding and at most one verbalizer.
- Never derive or accept a tenant ID from model output or form input.
- Missing or malformed canonical data fails closed and is never completed from editorial prose.
- The migration is generated only by `drizzle-kit generate` after editing `schema.ts`.
- No polling, worker, queue, trigger, function, provider adapter or background activity is added.
- Existing tenants remain unchanged because both columns are nullable and no backfill is run.
- Every task follows RED -> GREEN -> refactor and ends in an independently reviewable commit.

---

### Task 1: Add structured organization facts and a generated migration

**Files:**

- Modify: `src/domain/entities/clinic.ts`
- Modify: `src/infrastructure/db/schema.ts`
- Modify strict `Organization` fixtures reported by TypeScript
- Create generated files under `drizzle/` through `npm run db:generate`
- Test: `src/__tests__/EventDrivenSchemaContract.test.ts`
- Test: `src/__tests__/ClinicContentIsolation.test.ts`

**Interfaces:**

- Produces `SocialChannel = Readonly<{ label: string; url: string }>`.
- Produces nullable `Organization.parkingInformation` and `Organization.socialChannels`.
- Produces nullable columns `parking_information` and `social_channels`.

- [ ] **Step 1: Write schema contract RED tests**

Assert the two Drizzle columns exist, are nullable, and the domain organization accepts structured
channels. Add a tenant-isolation fixture proving two organizations retain different values.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/__tests__/EventDrivenSchemaContract.test.ts src/__tests__/ClinicContentIsolation.test.ts
```

Expected: failure because the properties and columns do not exist.

- [ ] **Step 3: Add the minimum schema and domain fields**

Add the exact `SocialChannel` type and fields from the design. Update strict fixture literals only;
do not add defaults or backfill data.

- [ ] **Step 4: Generate and inspect migration**

```bash
npm run db:generate
git diff -- drizzle src/infrastructure/db/schema.ts
```

Expected SQL: only two nullable `ALTER TABLE organizations ADD COLUMN` operations plus generated
metadata. Stop if it drops, rewrites or makes an existing column non-null.

- [ ] **Step 5: Run GREEN and static gates**

```bash
npx vitest run src/__tests__/EventDrivenSchemaContract.test.ts src/__tests__/ClinicContentIsolation.test.ts
npm run db:check
npm run typecheck
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/entities/clinic.ts src/infrastructure/db/schema.ts src/__tests__ drizzle
git commit -m "feat(v2): add structured institutional details"
```

### Task 2: Edit institutional details through the existing tenant-scoped UI

**Files:**

- Modify: `src/app/(clinic)/app/settings/playbook/ia-settings-client.tsx`
- Modify: `src/app/(clinic)/app/settings/playbook/tab-conhecimento.tsx`
- Modify: `src/app/(clinic)/app/settings/playbook/playbook-version-actions.ts`
- Create: `src/application/config/institutional-details.ts`
- Create: `src/__tests__/InstitutionalDetails.test.ts`
- Modify: `src/__tests__/PlaybookTenantScope.test.ts`

**Interfaces:**

- Produces `parseInstitutionalDetails(input): { parkingInformation: string | null;
  socialChannels: SocialChannel[] | null }` using a strict Zod schema.
- Produces `updateInstitutionalDetails(input)`; it obtains the organization solely from
  `requireSessionClinicId()` and updates `organizations.id = sessionClinicId`.

- [ ] **Step 1: Write validation and tenant-scope RED tests**

Cover valid input, empty-to-null normalization, more than five channels, duplicate normalized
labels, non-HTTPS URL, overlong values and a submitted foreign organization identifier that is not
accepted by the action contract. Preserve existing treatment editing assertions.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/__tests__/InstitutionalDetails.test.ts src/__tests__/PlaybookTenantScope.test.ts
```

Expected: failure because parser/action/UI do not exist.

- [ ] **Step 3: Implement parser, action and UI**

Render a compact “Informações institucionais” card above treatments with parking textarea and up to
five label/HTTPS URL rows. Pass the already-loaded `clinic` into `TabConhecimento`. On save, call
the server action with facts only; never pass or accept clinic ID. Display normal pending/success
feedback using the tab's existing visual primitives.

- [ ] **Step 4: Run GREEN and static gates**

```bash
npx vitest run src/__tests__/InstitutionalDetails.test.ts src/__tests__/PlaybookTenantScope.test.ts
npx eslint src/application/config/institutional-details.ts \
  'src/app/(clinic)/app/settings/playbook/ia-settings-client.tsx' \
  'src/app/(clinic)/app/settings/playbook/tab-conhecimento.tsx' \
  'src/app/(clinic)/app/settings/playbook/playbook-version-actions.ts' \
  src/__tests__/InstitutionalDetails.test.ts src/__tests__/PlaybookTenantScope.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add src/application/config/institutional-details.ts src/app/'(clinic)'/app/settings/playbook \
  src/__tests__/InstitutionalDetails.test.ts src/__tests__/PlaybookTenantScope.test.ts
git commit -m "feat(settings): manage institutional details"
```

### Task 3: Ground parking and social answers in the claimed organization

**Files:**

- Modify: `src/domain-packs/dental/ports.ts`
- Modify: `src/domain-packs/dental/knowledge-capability.ts`
- Modify: `src/application/conversation-v2/dental-live-adapters.ts`
- Modify: `src/__tests__/DentalKnowledgeCapability.test.ts`
- Modify: `src/__tests__/DentalLiveAdapters.test.ts`
- Modify: `src/__tests__/V2LiveConversationHandler.test.ts`

**Interfaces:**

- Extends `DentalBusinessInformationFact.key` with `parking_information | social_channels`.
- `resolveBusinessInformation("parking" | "social")` returns one validated display fact or the
  existing `missing` result.
- Social rendering is stable: normalized-label ascending order, `Label: URL`, joined by ` · `.

- [ ] **Step 1: Write capability and adapter RED tests**

Prove exact fact keys, evidence refs, deterministic social ordering, tenant binding, missing values,
unsafe parking text, invalid/duplicate channels and a combined rendered value over 240 characters.
The live test must assert one Understanding call, at most one verbalization, one answer/outbox and
zero scheduling/effect calls.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/__tests__/DentalKnowledgeCapability.test.ts \
  src/__tests__/DentalLiveAdapters.test.ts src/__tests__/V2LiveConversationHandler.test.ts
```

Expected: parking/social remain unavailable despite registered structured source values.

- [ ] **Step 3: Implement the bounded read path**

Map each topic to exactly one expected fact key. Validate and render from `deps.clinic` only. Do not
query the database, read notes, use maps URL as social data or expose partial malformed lists.

- [ ] **Step 4: Run GREEN and static gates**

```bash
npx vitest run src/__tests__/DentalKnowledgeCapability.test.ts \
  src/__tests__/DentalLiveAdapters.test.ts src/__tests__/V2LiveConversationHandler.test.ts
npx eslint src/domain-packs/dental/ports.ts src/domain-packs/dental/knowledge-capability.ts \
  src/application/conversation-v2/dental-live-adapters.ts \
  src/__tests__/DentalKnowledgeCapability.test.ts src/__tests__/DentalLiveAdapters.test.ts \
  src/__tests__/V2LiveConversationHandler.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add src/domain-packs/dental/ports.ts src/domain-packs/dental/knowledge-capability.ts \
  src/application/conversation-v2/dental-live-adapters.ts \
  src/__tests__/DentalKnowledgeCapability.test.ts src/__tests__/DentalLiveAdapters.test.ts \
  src/__tests__/V2LiveConversationHandler.test.ts
git commit -m "feat(v2): answer grounded institutional details"
```

### Task 4: Make social acknowledgement and farewell explicit

**Files:**

- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/application/conversation-v2/deterministic-response-composer.ts`
- Modify: `src/__tests__/DentalReceptionCoverage.test.ts`
- Modify: `src/__tests__/V2DeterministicComposer.test.ts`
- Modify: `src/__tests__/V2SemanticRegression.test.ts`

**Interfaces:**

- `DentalReceptionClaimPayload` gains `socialAct: "opening" | "acknowledgement" | "farewell"`.
- `reception_answered` exposes one closed boolean fact named `social_acknowledgement` or
  `social_farewell` for non-opening turns; it never contains clinic or lead text.

- [ ] **Step 1: Write social-turn RED tests**

Assert `acknowledges` produces a short acknowledgement with no question, `closes` produces a polite
farewell with no question, `new_topic` keeps the existing invitation and `repeats` still escalates.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/__tests__/DentalReceptionCoverage.test.ts \
  src/__tests__/V2DeterministicComposer.test.ts src/__tests__/V2SemanticRegression.test.ts
```

Expected: acknowledgement/farewell currently receive the generic help question.

- [ ] **Step 3: Implement social acts in the existing reception capability**

Derive the closed act from `dialogueMove`, emit the minimal fact and add deterministic drafts:
acknowledgement “Por nada! Fico à disposição.” and farewell “Até mais! Quando precisar, estou por
aqui.” Keep style verbalization optional and validator-bound; do not add a capability or prompt.

- [ ] **Step 4: Run GREEN and static gates**

```bash
npx vitest run src/__tests__/DentalReceptionCoverage.test.ts \
  src/__tests__/V2DeterministicComposer.test.ts src/__tests__/V2SemanticRegression.test.ts
npx eslint src/domain-packs/dental/capabilities.ts \
  src/application/conversation-v2/deterministic-response-composer.ts \
  src/__tests__/DentalReceptionCoverage.test.ts src/__tests__/V2DeterministicComposer.test.ts \
  src/__tests__/V2SemanticRegression.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add src/domain-packs/dental/capabilities.ts \
  src/application/conversation-v2/deterministic-response-composer.ts \
  src/__tests__/DentalReceptionCoverage.test.ts src/__tests__/V2DeterministicComposer.test.ts \
  src/__tests__/V2SemanticRegression.test.ts
git commit -m "feat(v2): handle social conversation turns"
```

### Task 5: Prove migration, isolation, performance and delivery readiness

**Files:**

- Modify: `src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts`
- Modify: `src/__tests__/ConversationV2JourneyMatrix.test.ts`
- Modify: `docs/architecture/current.md`
- Modify: `docs/architecture/v2-capability-parity.md`

**Interfaces:** No new production interface.

- [ ] **Step 1: Add RED matrix/performance expectations**

Mark parking/social and social reception green only when the productive fixtures prove one inbound,
one process job, one answer/outbox/send job, no business effect, no additional query/lock and the
same model-call ceiling as address.

- [ ] **Step 2: Run RED, then update evidence documentation**

```bash
npx vitest run src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts \
  src/__tests__/ConversationV2JourneyMatrix.test.ts
```

After the expected missing matrix evidence fails, add the measured fixture and update architecture
and parity status with the exact source fields and limitations.

- [ ] **Step 3: Run complete local gates on a clean commit**

```bash
git diff --check
npm run db:check
npm run lint
npm run typecheck
npm test -- --reporter=dot
npm run build
```

Commit the evidence/docs, confirm a clean tree, then run exact `npm run verify`.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts \
  src/__tests__/ConversationV2JourneyMatrix.test.ts docs/architecture/current.md \
  docs/architecture/v2-capability-parity.md
git commit -m "test(v2): prove institutional knowledge completion"
```

- [ ] **Step 5: Delivery gates**

Push normally, open a PR to `develop`, wait for Verify, Migration CI and Vercel, and merge only when
green and mergeable. Open the normal `develop -> main` release PR, repeat gates, merge normally and
confirm the production deployment is `READY`. Do not populate any tenant as part of deployment.

## Self-review

- Every design requirement maps to a task; no V1, fallback, model retry or parallel configuration.
- Types and field names are identical across schema, domain, action, adapter and tests.
- Tenant scope is derived only from session or claimed turn context.
- The only migration is expand-only and generated.
- Social links are structured; parking remains bounded display-only text.
- Runtime cardinality and idle Neon activity cannot increase.
- Treatment comparison/FAQ is explicitly a separate next release, not an omitted implementation.
- Placeholder scan: no `TBD`, `TODO`, “similar to” or unspecified implementation step remains.
