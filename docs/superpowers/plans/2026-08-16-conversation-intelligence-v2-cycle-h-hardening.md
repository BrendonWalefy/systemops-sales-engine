# Conversation Intelligence V2 — Cycle H Hardening Plan

> Implement finding by finding with TDD. Do not start Cycle I.

**Goal:** Close the authority-boundary findings from the independent H review and demonstrate
`semantics(finalText) ⊆ semantics(validatedDraft) ⊆ semantics(authorizedPlan)`.

**Design:** Follow
[`2026-08-16-conversation-intelligence-v2-cycle-h-hardening-design.md`](../specs/2026-08-16-conversation-intelligence-v2-cycle-h-hardening-design.md)
and canonical decision `CI-V2-H-GATE-2026-08-16`.

## Constraints

- RED → minimal GREEN → related regression for each finding, in review priority order.
- Runtime and compile-time derive outcome coherence from the same Domain Pack registry.
- `src/core/**` remains unchanged.
- No provider/model, database, calendar, config, I/O, outbound, shadow or Cycle I work.
- No arbitrary language labels, formatters, builder callbacks or forgeable structural brands.

## Task 0 — Documentation gate

- [x] Update the canonical spec and record `CI-V2-H-GATE-2026-08-16` before Cycle I results.
- [x] Write the approved hardening design and this execution plan.
- [x] Mark the initial H design, plan and closure report as historical/superseded evidence.
- [x] Self-review consistency among canonical spec, active design and active plan.

## Task 1 — CRITICAL: draft TOCTOU

- [x] Add adversarial getter/accessor/proxy and post-validation mutation tests.
- [x] Confirm the existing validator can validate one view and register another.
- [x] Canonicalize unknown composer output once into new plain data; freeze before validation.
- [x] Validate and register the exact same snapshot; run focused draft/pipeline regressions.

## Task 2 — CRITICAL: language authority

- [x] Add a RED proving `Desconto garantido` can be introduced without plan authority.
- [x] Remove `ResponseLanguageContribution` from the H trust boundary.
- [x] Introduce only closed generic templates and the minimal typed plan values used by H.
- [x] Prove renderer output depends only on validated refs and plan-authorized data.

## Task 3 — CRITICAL: OutcomeType coherence

- [x] Add compile-time and runtime RED cases for invalid concrete type/class pairs and missing required
  subject/evidence.
- [x] Introduce the generic Domain Pack outcome registry as the single type/runtime source.
- [x] Derive ActionResult types from the registry and validate external/cast values at runtime.
- [x] Cover failed appointment, escalation, slots, media information and write-evidence cases without
  adding their literals to generic core.

## Task 4 — IMPORTANT: trusted plan boundary

- [x] Add RED cases for invalid version, duplicates, dangling refs, fabricated authority and forged
  brands.
- [x] Canonicalize, validate, deeply freeze and runtime-register the exact plan snapshot.
- [x] Associate the plan with the executed results/schema that authorize it.
- [x] Remove arbitrary `buildPlan` from the turn pipeline.

## Task 5 — IMPORTANT: subject and relationship preservation

- [x] Add dental same-subject/cross-subject RED cases whose current text is indistinguishable.
- [x] Separate internal subject identity from authorized display data; never render the ID.
- [x] Preserve scheduling subject and qualify ambiguous multi-subject acts.
- [x] Reject incoherent outcome/fact/option/subject relations during plan construction.

## Task 6 — IMPORTANT: no OutcomeType widening

- [x] Add compile-time boundary tests proving arbitrary strings are rejected.
- [x] Thread the schema-derived concrete outcome union through plan, composer, validator and pipeline.
- [x] Add runtime rejection for cast/untyped input.

## Task 7 — Repair, fallback and directly related minors

- [x] Prove repair only removes, copies and freezes survivors before revalidation.
- [x] Prove fallback uses only the same registered plan and returns `no_safe_response` when empty.
- [x] Cover empty/duplicate options, ordering, partial failures and UNKNOWN versus FALSE.
- [x] Record unrelated minor findings as debt rather than widening the cycle.

## Task 8 — Final verification and independent adversarial review

- [x] Run focused H/G/architecture and all new adversarial tests.
- [x] Run required scheduling regressions.
- [x] Run exact `npm run verify`.
- [x] Confirm `git diff 7fb114f0 -- src/core` is empty.
- [x] Audit provider/model/domain/config/I/O imports and calls in composer/renderer.
- [x] Perform a fresh read-only adversarial review of both entailment inclusions and record every
  attempted bypass and result.
- [x] Stop after GO/NO-GO for H; do not start Cycle I.
