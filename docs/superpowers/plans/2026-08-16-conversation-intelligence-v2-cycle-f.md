# Conversation Intelligence V2 — Cycle F Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the smallest useful dental Domain Pack and prove its Understanding contract on frozen, population-specific acceptance sets without running a V1×V2 comparison.

**Architecture:** The dental pack owns its request vocabulary, prompt contribution, journeys, capability order, and domain safety rules. A provider adapter produces `understanding.v1`; the existing Conversation Core consumes only that structured value. Adding the pack must change zero files under `src/conversation-core/`.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, OpenAI structured output, JSONL eval datasets.

## Global Constraints

- The canonical design spec wins over this plan if they diverge.
- Use TDD: every production change starts with a failing test and a recorded RED run.
- Do not modify V1 predicates or run V1×V2; the paired comparison remains Cycle I.
- Do not add a DSL, plugin engine, generic workflow engine, or new event bus.
- Capabilities never receive lead text, message text, history, transcript, or renamed free-text equivalents.
- No dental vocabulary may enter `src/conversation-core/**`.
- Run `npm run verify` exactly, without `.env.local`, before any push.

---

## Metric resolution inherited from Cycle E

`95.2%` is not a persisted baseline. Git contains one measured intent baseline:
`evals/intent/baseline.json`, recorded over three runs of `gpt-4o-mini`:

| Population | Unit and denominator | Persisted result |
| --- | --- | ---: |
| `incident` | correct legacy intent per run, 21 known production incidents | 73.0% mean |
| `prompt_rule` | correct legacy intent per run, 58 prompt-authored examples | 92.5% mean |

The corpus result is a different measurement:

| Population | Unit and denominator | Persisted result |
| --- | --- | ---: |
| corpus `request`, comparable V1 vocabulary | correct legacy intent, 44/64 lead turns | 68.75% |
| corpus `request`, axis coverage denominator | correct request axis, 44/66 cases | 66.67% |

The harness uses 17 V1 intents and deliberately separates real incidents from prompt-rule
phrases. The corpus uses 30 `request` values from reviewed real/curated turns and scores axes
independently. They are neither the same population nor the same label space, so no valid
conversion from 95.2 to 69 exists. The semantic gate is therefore a vector, not one scalar:

1. **Legacy diagnostic (non-primary):** after mapping V2 output to legacy intents, do not fall
   below the persisted 73.0% `incident` or 92.5% `prompt_rule` means over the same 3-run protocol;
   blocking-severity counts must not increase. This reuses a frozen baseline; it does not execute
   V1 and is not the Cycle I comparison.
2. **F acceptance set (primary):** every explicitly supported price-with-identified-service and
   availability/scheduling case must produce the exact expected `request`, `dialogueMove`, and
   required entities in each of 3 runs. Unsupported dental journeys are reported, not silently
   included in the denominator.
3. **Safety:** zero critical errors in any run.
4. **Structural-feature parity:** reset command, menu re-request, and concrete-slot state are
   deterministic adapter/state scenarios; all must pass without an Understanding model call.
5. **Coverage:** the report prints numerator, denominator, skipped cases, model, prompt version,
   run count, and per-axis confusion rows. A scalar “Understanding accuracy” is forbidden.

This retires the unsupported `95.2%` claim rather than lowering it, and preserves the measured
~69% as a V1 corpus baseline rather than transporting it into another population.

### Task 1: Freeze the Cycle F acceptance manifest

**Files:**
- Create: `evals/understanding/cycle-f-dental.json`
- Create: `src/application/corpus/cycle-f-acceptance.ts`
- Create: `src/__tests__/CycleFAcceptanceManifest.test.ts`

**Interfaces:**
- Produces: `loadCycleFAcceptanceManifest(path): CycleFAcceptanceManifest`
- Each entry contains `caseId`, `requiredAxes`, and `critical`.

- [ ] **Step 1: Write a failing test** that rejects duplicate IDs, absent corpus cases, cases
  outside dental tenant fixtures, and an empty required-axis list.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/CycleFAcceptanceManifest.test.ts` and confirm
  failure because the loader does not exist.
- [ ] **Step 3: Implement the loader** with the exact supported slice: identified-service price
  plus availability, booking, and pending-slot answers. Keep all other journeys out with a
  written `excludedReason` in the manifest.
- [ ] **Step 4: Re-run the focused test** and confirm PASS.
- [ ] **Step 5: Commit** as `test(evals): freeze the cycle-f dental acceptance set`.

### Task 2: Build the dental vocabulary and Understanding schema adapter

**Files:**
- Create: `src/domain-packs/dental/vocabulary.ts`
- Create: `src/domain-packs/dental/understanding.ts`
- Create: `src/domain-packs/dental/index.ts`
- Create: `src/__tests__/DentalUnderstandingContract.test.ts`

**Interfaces:**
- Consumes: `Understanding<Request>` from `src/conversation-core/understanding/schema.ts`.
- Produces: `DentalRequest`, `parseDentalUnderstanding(value)`, and `dentalPack`.

- [ ] **Step 1: Write failing table-driven tests** for valid price, availability, booking, and
  pending-slot outputs; include malformed confidence, unknown request, and missing service cases.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/DentalUnderstandingContract.test.ts` and
  confirm the missing exports cause RED.
- [ ] **Step 3: Implement only the request values and entity validation required by Task 1.**
  Do not copy the 17-intent V1 taxonomy.
- [ ] **Step 4: Run the contract and all five Cycle E tests** and confirm PASS.
- [ ] **Step 5: Commit** as `feat(dental-pack): define the minimum understanding vocabulary`.

### Task 3: Add one structured Understanding provider adapter

**Files:**
- Create: `src/infrastructure/ai/DentalUnderstandingProvider.ts`
- Create: `src/domain-packs/dental/understanding-prompt.ts`
- Create: `src/__tests__/DentalUnderstandingProvider.test.ts`

**Interfaces:**
- Produces: `understand(input: { leadMessage; history; state; catalog }): Promise<Understanding<DentalRequest>>`.
- The adapter owns language input; capabilities and `CapabilityContext` remain unchanged.

- [ ] **Step 1: Write a failing provider-boundary test** using a fake model response and assert
  parsing, model ID, prompt version, and schema version. Assert no provider import appears under
  `src/conversation-core/**`.
- [ ] **Step 2: Run the focused test** and confirm RED because the adapter is absent.
- [ ] **Step 3: Implement one structured-output call** with a static prompt prefix plus dental
  vocabulary supplied by the pack. Add no fallback keyword classifier.
- [ ] **Step 4: Re-run provider, import-boundary, lexicon, and capability-contract tests.**
- [ ] **Step 5: Commit** as `feat(understanding): add the dental structured-output adapter`.

### Task 4: Preserve the three structural features outside language understanding

**Files:**
- Create: `src/domain-packs/dental/structured-input.ts`
- Create: `src/__tests__/DentalStructuralFeatureParity.test.ts`

**Interfaces:**
- Produces: structured events `reset_requested`, `menu_requested`, and
  `pending_option_selected`; none contains raw conversational text.

- [ ] **Step 1: Write failing tests** for exact reset commands, closed menu navigation, and a
  stored concrete-slot offer. Assert the model adapter is not invoked.
- [ ] **Step 2: Run the focused test** and confirm RED because the structured adapter is absent.
- [ ] **Step 3: Implement exact matching/state resolution only.** Do not copy the open-language
  branches inside V1 `resolveMenuSelection`.
- [ ] **Step 4: Run the focused test and `KeywordPredicateRegistry.test.ts`.**
- [ ] **Step 5: Commit** as `feat(dental-pack): preserve structured conversation controls`.

### Task 5: Add the minimum Catalog, Scheduling, and Escalation capabilities

**Files:**
- Create: `src/domain-packs/dental/capabilities/catalog.ts`
- Create: `src/domain-packs/dental/capabilities/scheduling.ts`
- Create: `src/domain-packs/dental/capabilities/escalation.ts`
- Create: `src/__tests__/DentalCapabilityClaims.test.ts`

**Interfaces:**
- Each capability implements the existing `Capability<DentalRequest, DentalPolicy>` contract.
- `claim()` consumes only `Understanding` and state; `decide()` reads structured policy;
  `execute()` returns an `ActionResult`.

- [ ] **Step 1: Write failing table tests** for ownership, non-ownership, pack-declared order,
  and critical escalation. Mutating `leadMessage`, `message`, or `history` into context must fail
  typecheck.
- [ ] **Step 2: Run the focused test plus `npm run typecheck`** and confirm RED.
- [ ] **Step 3: Implement only claims needed by the acceptance manifest.** Scheduling execution
  may use an in-memory fake; real calendar I/O remains outside this cycle.
- [ ] **Step 4: Run capability, coordinator-budget, context, and fixture-pack tests.**
- [ ] **Step 5: Commit** as `feat(dental-pack): add the minimum capability set`.

### Task 6: Produce the population-explicit Cycle F report

**Files:**
- Create: `scripts/eval-understanding-v2.ts`
- Create: `src/application/corpus/eval-understanding-gate.ts`
- Create: `src/__tests__/UnderstandingGate.test.ts`
- Create after measurement: `evals/understanding/cycle-f-baseline.json`

**Interfaces:**
- Produces separate `legacyDiagnostic`, `cycleFAcceptance`, `safety`, and
  `structuralFeatureParity` sections; every score includes numerator and denominator.

- [ ] **Step 1: Write failing tests** proving the gate rejects a missing axis, any critical
  failure, one failed acceptance case in any of three runs, a legacy stratum below its persisted
  baseline, and reports unsupported cases separately.
- [ ] **Step 2: Run the focused test** and confirm RED.
- [ ] **Step 3: Implement the pure gate aggregator, then the runner.** The runner may call only
  V2; it reads V1 numbers from the committed baseline and must never invoke V1.
- [ ] **Step 4: Run three V2 rounds, persist the report, and inspect all confusions.** Do not edit
  labels or thresholds after seeing the output.
- [ ] **Step 5: Run** the five Cycle E tests, all Cycle F focused tests, and `npm run verify`.
- [ ] **Step 6: Commit** as `test(evals): measure cycle-f understanding by population`.

## Cycle F exit gate

- Zero diff under `src/conversation-core/**` from the Cycle E closing commit.
- Every primary acceptance case passes every required axis in all three runs.
- Zero critical error in any population or run.
- Legacy diagnostic is at least 73.0% (`incident`) and 92.5% (`prompt_rule`) with no increase in
  blocking severity; results are diagnostic compatibility, not a V1×V2 experiment.
- All three structural features pass without an Understanding call.
- Full report includes populations, denominators, units, skipped cases, model, prompt version,
  and run count.
- `npm run verify` passes.

Stop after this gate. Do not begin Cycle G.
