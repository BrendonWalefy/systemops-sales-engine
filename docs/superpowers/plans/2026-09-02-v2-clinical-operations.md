# V2 Clinical Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement tenant-scoped V2 handling for evaluation-required treatments, clinical escalation, existing-work problems, and patient arrival/delay without diagnosis or agenda mutation.

**Architecture:** Extend the closed Understanding vocabulary, add one `dental-operations` capability with a read-only appointment port, and reuse the canonical V2 handoff store for the only business effect. The existing authority-v2 outbox and sender remain the exclusive delivery boundary; no V1 path, schema change, polling, or new worker is introduced.

**Tech Stack:** TypeScript, Zod, Vitest, Drizzle ORM, embedded PostgreSQL, Next.js runtime.

**Spec:** `docs/superpowers/specs/2026-09-02-v2-clinical-operations-design.md`

## Global Constraints

- V1 is historical evidence only; never import or execute its runtime.
- Every live turn still requires durable authority version 2 and the existing sender preflight.
- The model understands and verbalizes; deterministic code decides handoff and data access.
- Do not diagnose, prescribe, promise an appointment, or mutate appointment status.
- Reuse Inbox attention and Agenda records; add no schema migration or UI field.
- Preserve one Understanding call, at most one verbalization, one outbox, and one send job.
- Run RED → GREEN → refactor and commit every task independently.

---

### Task 1: Close the operational Understanding contract

**Files:**
- Modify: `src/domain-packs/dental/vocabulary.ts`
- Modify: `src/domain-packs/dental/understanding.ts`
- Modify: `src/domain-packs/dental/understanding-prompt.ts`
- Modify: `src/domain-packs/dental/response-conversation-brief.ts`
- Test: `src/__tests__/DentalUnderstandingContract.test.ts`
- Test: `src/__tests__/DentalUnderstandingCoverageMatrix.test.ts`
- Test: `src/__tests__/DentalUnderstandingProvider.test.ts`

**Interfaces:**
- Produces: `DentalRequest` values `clinical-urgency`, `existing-treatment-problem`, `patient-arrival`, and `patient-delay`.
- Produces: semantic validation that forbids unrelated entities for operational requests.

- [ ] **Step 1: Write failing contract tests**

Add exact enum/order assertions and parsing cases such as:

```ts
expect(parseDentalUnderstanding(understanding({
  request: "patient-delay",
  entities: { ...EMPTY_ENTITIES, date: "hoje", time: "10 minutos" },
})).request).toBe("patient-delay");
```

Assert that quantity, service candidates, objection question and professional are rejected for every operational request, while `service` is accepted only for `existing-treatment-problem`.

- [ ] **Step 2: Run the tests RED**

Run: `npx vitest run src/__tests__/DentalUnderstandingContract.test.ts src/__tests__/DentalUnderstandingCoverageMatrix.test.ts src/__tests__/DentalUnderstandingProvider.test.ts`

Expected: FAIL because the request enum and prompt registry do not contain the operational values.

- [ ] **Step 3: Implement the minimal closed vocabulary**

Append the four values without reordering existing values, update the prompt with positive and negative examples, and add semantic issue codes for forbidden operational entities. Keep all nullable fields explicit.

- [ ] **Step 4: Run GREEN and refactor**

Run the Task 1 command, then `npm run typecheck` and ESLint for the changed files. Remove duplicated request sets and retain one exported vocabulary source.

- [ ] **Step 5: Commit**

Commit: `feat(v2): classify clinical operations explicitly`

---

### Task 2: Add the dental operations capability

**Files:**
- Create: `src/domain-packs/dental/operations-capability.ts`
- Modify: `src/domain-packs/dental/ports.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Modify: `src/domain-packs/dental/outcome-provenance.ts`
- Test: `src/__tests__/DentalOperationsCapability.test.ts`
- Test: `src/__tests__/DentalCapabilityClaims.test.ts`

**Interfaces:**
- Consumes: `Understanding<DentalRequest>` from Task 1.
- Produces:

```ts
export type DentalOperationsReadPort = Readonly<{
  resolveTodayAppointment(): Promise<
    | { kind: "exact"; appointment: DentalAppointmentReference }
    | { kind: "none" }
    | { kind: "ambiguous" }
  >;
}>;
```

- Produces: `DentalOperationsClaimPayload` and outcome types `clinical_operation_handoff` and `patient_presence_handoff` with semantic class `human_action_required`.

- [ ] **Step 1: Write failing capability tests**

Cover each request, emergency-signal coercion, priority/conflicts, exact appointment evidence, no/ambiguous appointment, and ensure no write port exists.

```ts
expect(result).toMatchObject({
  type: "patient_presence_handoff",
  semanticClass: "human_action_required",
  origin: { capabilityId: "dental-operations" },
});
```

- [ ] **Step 2: Run the tests RED**

Run: `npx vitest run src/__tests__/DentalOperationsCapability.test.ts src/__tests__/DentalCapabilityClaims.test.ts`

Expected: FAIL because `dental-operations` and its outcomes are not registered.

- [ ] **Step 3: Implement claims, decisions, outcomes, and provenance**

Use one capability. Clinical cases return `escalate`; arrival/delay first resolve the current-day appointment and then return `escalate` with optional subject/evidence. Set conflicts against catalog, commercial, scheduling, lifecycle, journey and reception.

- [ ] **Step 4: Run GREEN and refactor**

Run the Task 2 tests, `npm run typecheck`, and file-scoped ESLint. Keep reason mapping exhaustive with a `never` check.

- [ ] **Step 5: Commit**

Commit: `feat(v2): decide clinical operation handoffs`

---

### Task 3: Bind operational reads to the claimed tenant

**Files:**
- Modify: `src/application/conversation-v2/dental-live-adapters.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Test: `src/__tests__/DentalOperationsLiveAdapter.test.ts`

**Interfaces:**
- Consumes: `AppointmentRepository.findAllActiveByLeadId`, claimed `clinicId`, `leadId`, clinic timezone, and turn time.
- Produces: `operationsRead` for `createDentalPack`.

- [ ] **Step 1: Write failing adapter tests**

Test one appointment on the local calendar day, none, multiple, UTC boundary, foreign clinic/lead rejection, and non-active appointments. Assert zero calendar gateway calls and zero appointment writes.

- [ ] **Step 2: Run the test RED**

Run: `npx vitest run src/__tests__/DentalOperationsLiveAdapter.test.ts`

Expected: FAIL because the adapter exposes no operations port.

- [ ] **Step 3: Implement the tenant-scoped read**

Filter the repository result by exact clinic, lead, active status, and local date using `ClinicTimezone.toLocalParts()`. Sort only for deterministic ambiguity handling; never choose when count differs from one.

- [ ] **Step 4: Run GREEN and refactor**

Run the Task 3 test, `npm run typecheck`, and file-scoped ESLint. Verify source scan contains no manual timezone offset.

- [ ] **Step 5: Commit**

Commit: `feat(v2): resolve patient presence within tenant`

---

### Task 4: Persist exact handoff reasons and evaluation redirects

**Files:**
- Modify: `src/application/conversation-v2/v2-conversation-handoff.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/domain-packs/dental/ports.ts`
- Modify: `src/application/conversation-v2/dental-live-adapters.ts`
- Test: `src/__tests__/V2ClinicalOperationsLiveHandler.test.ts`
- Test: `src/__tests__/DentalSchedulingCapability.test.ts`

**Interfaces:**
- Produces closed handoff reasons `v2_clinical_urgency_requires_human`, `v2_existing_treatment_problem_requires_human`, `v2_patient_arrival_requires_human`, `v2_patient_delay_requires_human`, and `v2_clinical_evaluation_requires_human`.
- Extends `DentalSlotSearchResult.service` with `evidenceRef` so evaluation-required is tied to catalog authority.

- [ ] **Step 1: Write failing handler and scheduling tests**

Assert each operation persists its exact reason before outbox creation; outbox failure leaves the conversation in handoff. Assert evaluation-required returns a bound `human_action_required` result, offers zero slots, creates zero reservation, and never names an invented evaluation service.

- [ ] **Step 2: Run the tests RED**

Run: `npx vitest run src/__tests__/V2ClinicalOperationsLiveHandler.test.ts src/__tests__/DentalSchedulingCapability.test.ts`

Expected: FAIL because reasons collapse to `v2_explicit_human_request` and evaluation is generic clarification.

- [ ] **Step 3: Implement exact mapping**

Derive `handoffReason` from prepared/action outcomes, persist through the existing store, and keep the response/outbox authorized by the claimed inbound tuple. Add treatment evidence to the slot-search service and return a distinct evaluation outcome without any write.

- [ ] **Step 4: Run GREEN and refactor**

Run Task 4 tests, `npm run typecheck`, and file-scoped ESLint. Ensure one central mapping owns the outcome-to-handoff translation.

- [ ] **Step 5: Commit**

Commit: `feat(v2): persist operational handoffs exactly`

---

### Task 5: Prove the production PostgreSQL boundary

**Files:**
- Create: `src/__tests__/V2ClinicalOperationsDatabase.test.ts`
- Modify: `package.json`
- Modify: `src/__tests__/DatabaseTestCommandIsolation.test.ts`

**Interfaces:**
- Consumes: embedded authority PostgreSQL helper and production repositories/stores.
- Produces: CI-executed database proof with zero skips.

- [ ] **Step 1: Add RED database tests and command contracts**

Exercise one claimed V2 inbound through handler/outbox for arrival and clinical urgency. Assert exactly one conversation is paused, one authorized outbox/job exists, duplicate provider delivery creates no second effect, cross-tenant appointments are ignored, and no appointment row changes.

- [ ] **Step 2: Run RED in embedded PostgreSQL**

Run: `npx vitest run src/__tests__/V2ClinicalOperationsDatabase.test.ts --maxWorkers=1`

Expected: FAIL for missing operational handling, never for setup, imports, credentials, or skips.

- [ ] **Step 3: Register the suite**

Append the file to `test:db:authority`, exclude it from ordinary `test`, and update the exact command/no-skip source contract without weakening string equality.

- [ ] **Step 4: Run GREEN**

Run the direct DB test and `npm run test:db:authority`; require every test executed and zero skipped. Run `DatabaseTestCommandIsolation.test.ts` directly.

- [ ] **Step 5: Commit**

Commit: `test(v2): prove clinical operations on postgres`

---

### Task 6: Close parity, corpus, trace, and performance contracts

**Files:**
- Modify: `docs/architecture/v2-capability-parity.md`
- Modify: `src/application/conversation-v2/comparison-record-config.ts`
- Modify: `src/__tests__/ConversationV2JourneyMatrix.test.ts`
- Modify: `src/__tests__/DentalUnderstandingCoverageMatrix.test.ts`
- Modify: `src/__tests__/DentalCapabilityClaims.test.ts`
- Modify: `src/__tests__/DecisionTracePrivacy.test.ts`
- Modify: `src/__tests__/V2RuntimePerformanceRegression.test.ts`

**Interfaces:**
- Produces: closed registry entry `dental-operations` and sanitized replay cases for all operational outcomes.

- [ ] **Step 1: Write RED registry and performance expectations**

Assert all new requests map to `dental-operations`, traces expose only closed reason/evidence references, and performance remains one Understanding, at most one verbalization, one outbox/job, zero agenda mutations, at most one indexed appointment read, p95 +25%, and lock delta <=20 ms.

- [ ] **Step 2: Run RED**

Run the six affected test files directly. Expected: FAIL only on stale registries/matrix entries.

- [ ] **Step 3: Update the closed contracts and roadmap**

Mark evaluation, urgency, existing-work problem and arrival/delay `green`; document exact owners and evidence. Do not mark proactive automations green.

- [ ] **Step 4: Run GREEN and measurement**

Run the Task 6 tests and `npm run measure:v2-only-runtime -- --baseline evals/v2-only/runtime-baseline.json`; require `violations: []`.

- [ ] **Step 5: Commit**

Commit: `test(v2): close clinical operations parity`

---

### Task 7: Final verification and delivery

**Files:**
- Review: all files changed by Tasks 1-6.

- [ ] **Step 1: Run focused verification**

Run all operational, scheduling, handoff, authority and sender tests. Require zero failures and database zero skips.

- [ ] **Step 2: Run repository gates**

Commit any stale closed-contract correction separately, obtain a clean tree, then run exactly `npm run verify`, `npm run test:db:authority`, `npm run test:db:schema`, and `git diff --check`.

- [ ] **Step 3: Build from a disposable clean clone**

Check out the exact HEAD under `/private/tmp/systemops-v2-operations-verify.*`, run `npm ci` and `npm run build`, confirm tracked cleanliness, then move only that validated directory to Trash.

- [ ] **Step 4: Review and integrate**

Push normally, open a focused PR to `develop`, wait for GitHub/Vercel checks, merge normally when clean, then open the standard `develop` → `main` release PR. Never force-push.

- [ ] **Step 5: Verify production**

Require Vercel `READY` at the exact main SHA, unchanged migrations, no automatic tenant activation, and no synthetic WhatsApp send. Preserve the worktree for review corrections.
