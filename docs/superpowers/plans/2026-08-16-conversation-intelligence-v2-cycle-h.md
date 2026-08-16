# Conversation Intelligence V2 — Cycle H Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a V2 authorized response plan into validated, deterministically rendered text without increasing its semantic authority.

**Architecture:** Extend the generic G result contract only enough to retain outcome class, identity, provenance, subjects and option grouping. Build a referential authorized-plan graph, compose a typed semantic draft, validate it deterministically, reduce invalid drafts through repair/fallback, and render only a branded validated draft.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, existing Conversation Core V2 and Domain Pack contracts.

## Global Constraints

- Preserve `semantics(finalText) ⊆ semantics(validatedDraft) ⊆ semantics(authorizedPlan)`.
- Keep `src/core/**` unchanged.
- Do not add provider, database, calendar, tenant config, I/O or side effects to `src/conversation-core/**`.
- Do not add dental vocabulary or behavior to the generic core.
- Do not accept free prose as semantic authority.
- Do not start V1×V2, shadow, production wiring, outbound delivery, cutover, Cycle I or Cycle J.
- Use RED → minimal GREEN → hardening for every behavioral task.
- Run `npm run verify` exactly before the final checkpoint.

---

### Task 1: Preserve outcome identity and relationships in the authorized plan

**Files:**
- Modify: `src/conversation-core/decision.ts`
- Modify: `src/conversation-core/authorized-response-plan.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/domain-packs/fixture/index.ts`
- Modify: `src/__tests__/V2AuthorizedResponsePlan.test.ts`
- Modify: affected G tests that construct `ActionResult` literals

**Interfaces:**
- Consumes: existing `Fact`, capability `execute()` results and `buildV2AuthorizedResponsePlan()`.
- Produces: `OutcomeSemanticClass`, relationship-preserving `ActionResult`, and a referential `V2AuthorizedResponsePlan` used by every later task.

- [x] **Step 1: Write the failing plan-graph tests**

Add literal fixtures proving that two outcomes keep distinct fact and subject refs, internal facts retain `disclosure: "internal"`, and options remain grouped:

```ts
const results: ActionResult[] = [
  {
    type: "quote_ready",
    semanticClass: "information_authorized",
    origin: { capabilityId: "quote" },
    subject: { type: "item", id: "item-a" },
    evidence: [{ source: "read", reference: "catalog-a" }],
    facts: [allowedFact("amount", 1200, "item", "item-a", "catalog-a")],
  },
  {
    type: "windows_found",
    semanticClass: "options_found",
    origin: { capabilityId: "reservation" },
    subject: { type: "item", id: "item-b" },
    evidence: [{ source: "read", reference: "windows-b" }],
    facts: [],
    options: [{
      id: "window-1",
      subject: { type: "window", id: "window-1" },
      facts: [allowedFact("window_label", "15:00", "window", "window-1", "windows-b")],
    }],
  },
];

const plan = buildV2AuthorizedResponsePlan(results);
expect(plan.outcomes[0]?.factRefs).toEqual(["fact-0"]);
expect(plan.outcomes[1]?.optionRefs).toEqual(["option-0"]);
expect(plan.facts[0]?.subjectRef).not.toBe(plan.options[0]?.subjectRef);
```

Add separate tests for a disclosable fact without subject and for options attached to a
non-`options_found` result; both must throw.

- [x] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npx vitest run src/__tests__/V2AuthorizedResponsePlan.test.ts
```

Expected: FAIL because `ActionResult` has no semantic class/options and the plan has only flattened `actionTypes`/`authorizedFacts`.

- [x] **Step 3: Implement the minimal generic result contract**

Define shared references in `decision.ts`:

```ts
export type Subject = { type: string; id: string };
export type Evidence = {
  source: "policy" | "read" | "write" | "derived";
  reference: string;
};
export type OutcomeSemanticClass =
  | "information_authorized"
  | "options_found"
  | "effect_completed"
  | "effect_failed"
  | "human_action_required"
  | "clarification_required";

export type ActionResultOption = {
  id: string;
  subject: Subject;
  facts: readonly Fact[];
};

type ActionResultBase = {
  type: string;
  semanticClass: OutcomeSemanticClass;
  origin: { capabilityId: string };
  subject: Subject | null;
  evidence: readonly Evidence[];
  facts: readonly Fact[];
};

export type ActionResult =
  | (ActionResultBase & {
      semanticClass: "options_found";
      options: readonly ActionResultOption[];
    })
  | (ActionResultBase & {
      semanticClass: Exclude<OutcomeSemanticClass, "options_found">;
      options?: never;
    });
```

Reuse `Subject` and `Evidence` inside `Fact`.

- [x] **Step 4: Build the referential plan graph**

Replace the flat plan with these exact public shapes:

```ts
export type AuthorizedSubject = Subject & { ref: string };
export type AuthorizedEvidence = Evidence & { ref: string };
export type AuthorizedFact = Omit<Fact, "subject" | "evidence"> & {
  ref: string;
  subjectRef: string | null;
  evidenceRef: string;
};
export type AuthorizedOption = {
  ref: string;
  id: string;
  subjectRef: string;
  factRefs: readonly string[];
};
export type AuthorizedOutcome = {
  ref: string;
  outcomeType: string;
  semanticClass: OutcomeSemanticClass;
  origin: { capabilityId: string };
  subjectRef: string | null;
  evidenceRefs: readonly string[];
  factRefs: readonly string[];
  optionRefs: readonly string[];
};
export type V2AuthorizedResponsePlan = {
  version: typeof V2_AUTHORIZED_RESPONSE_PLAN_VERSION;
  outcomes: readonly AuthorizedOutcome[];
  options: readonly AuthorizedOption[];
  facts: readonly AuthorizedFact[];
  subjects: readonly AuthorizedSubject[];
  evidence: readonly AuthorizedEvidence[];
};
```

Assign deterministic refs in encounter order (`outcome-0`, `option-0`, `fact-0`, `subject-0`,
`evidence-0`). Deduplicate subjects by exact type/id and evidence by exact source/reference. Reject
allowed facts without a subject, empty `options_found`, and options on other classes.

- [x] **Step 5: Migrate the fixture and dental ActionResults without new decisions**

Map existing concrete results exactly:

```text
catalog_answered                  -> information_authorized
slots_found                       -> options_found
appointment_created/confirmed     -> effect_completed
appointment_*_failed              -> effect_failed
escalation_required               -> human_action_required
clarification_required            -> clarification_required
quote_prepared                    -> information_authorized
wind_window_reserved              -> effect_completed
```

Use the capability id as origin, write evidence for completed/failed writes, and preserve each
slot as an `ActionResultOption` instead of flattening it.

- [x] **Step 6: Run plan and G regression tests GREEN**

Run:

```bash
npx vitest run src/__tests__/V2AuthorizedResponsePlan.test.ts src/__tests__/DentalCatalogCapability.test.ts src/__tests__/DentalSchedulingCapability.test.ts src/__tests__/DentalOperationalPipeline.test.ts src/__tests__/FixturePackPipeline.test.ts src/__tests__/PipelineDecisionBarrier.test.ts
```

Expected: all tests pass.

- [x] **Step 7: Commit**

```bash
git add src/conversation-core/decision.ts src/conversation-core/authorized-response-plan.ts src/domain-packs/dental/capabilities.ts src/domain-packs/fixture/index.ts src/__tests__
git commit -m "feat(conversation-core): preserve authorized outcome relationships"
```

---

### Task 2: Add typed drafts, deterministic composition and entailment validation

**Files:**
- Create: `src/conversation-core/composer/contract.ts`
- Create: `src/conversation-core/composer/deterministic-composer.ts`
- Create: `src/conversation-core/composer/validator.ts`
- Create: `src/__tests__/V2SemanticDraftValidator.test.ts`
- Create: `src/__tests__/V2DeterministicComposer.test.ts`

**Interfaces:**
- Consumes: referential `V2AuthorizedResponsePlan` from Task 1.
- Produces: `DraftResponse`, `ResponseComposerPort`, `ValidatedDraftResponse`, validation violations and deterministic draft composition.

- [x] **Step 1: Write referential-integrity tests first**

Use literal plans/drafts. Add one test per break:

```ts
expect(validateDraft(plan, draftWith({ factRef: "missing" })).valid).toBe(false);
expect(validateDraft(plan, draftWith({ outcomeRef: "missing" })).valid).toBe(false);
expect(validateDraft(plan, draftWith({ subjectRef: "missing" })).valid).toBe(false);
expect(validateDraft(plan, crossOutcomeFactDraft).valid).toBe(false);
expect(validateDraft(plan, substitutedSubjectDraft).valid).toBe(false);
expect(validateDraft(plan, internalFactDraft).valid).toBe(false);
```

Each assertion must check the exact structured violation code, such as `unknown_fact_ref`,
`fact_outcome_mismatch`, `subject_mismatch` or `fact_not_disclosable`.

- [x] **Step 2: Write speech-act compatibility tests**

Cover the complete matrix with hand-authored drafts:

```text
information_authorized + inform_fact       -> valid
options_found + offer_options               -> valid
options_found + confirm_effect              -> invalid
effect_completed + confirm_effect           -> valid
effect_failed + communicate_failure         -> valid
effect_failed + confirm_effect              -> invalid
human_action_required + inform_required_action -> valid
human_action_required + confirm_effect      -> invalid
clarification_required + ask_clarification -> valid
```

- [x] **Step 3: Run validator tests and confirm RED**

Run:

```bash
npx vitest run src/__tests__/V2SemanticDraftValidator.test.ts
```

Expected: FAIL because the draft and validator modules do not exist.

- [x] **Step 4: Implement the typed draft contract**

Define only these acts:

```ts
export type DraftSpeechAct =
  | { kind: "inform_fact"; outcomeRef: string; factRef: string; subjectRef: string }
  | { kind: "offer_options"; outcomeRef: string; subjectRef: string | null; optionRefs: readonly string[] }
  | { kind: "confirm_effect"; outcomeRef: string; subjectRef: string; factRefs: readonly string[] }
  | { kind: "communicate_failure"; outcomeRef: string }
  | { kind: "inform_required_action"; outcomeRef: string }
  | { kind: "ask_clarification"; outcomeRef: string };

export type DraftResponse = { acts: readonly DraftSpeechAct[] };

export type ComposerStyle = {
  tone: "neutral" | "warm";
  verbosity: "concise" | "standard";
  greeting: "omit" | "include";
  emoji: "none" | "light";
};

export interface ResponseComposerPort {
  compose(input: {
    plan: V2AuthorizedResponsePlan;
    style: ComposerStyle;
  }): Promise<DraftResponse>;
}
```

Keep the brand symbol private to `validator.ts`; export the branded type from that module and
return it only from a successful validation result.

- [x] **Step 5: Implement deterministic validation**

Index the plan collections by ref, reject duplicates, and validate each act against an explicit
compatibility map. Never inspect text or domain-specific strings. Return every violation as:

```ts
export type DraftViolation = {
  actIndex: number;
  code:
    | "unknown_outcome_ref"
    | "unknown_fact_ref"
    | "unknown_subject_ref"
    | "unknown_option_ref"
    | "fact_outcome_mismatch"
    | "option_outcome_mismatch"
    | "subject_mismatch"
    | "fact_not_disclosable"
    | "incompatible_speech_act";
};
```

- [x] **Step 6: Run validator tests GREEN**

Run the same focused command and confirm all cases pass.

- [x] **Step 7: Write deterministic-composer tests and confirm RED**

Assert literal acts for a plan containing information, options, completed effect, failed effect,
required human action and clarification. Include a two-outcome test proving fact refs remain under
their original outcome.

- [x] **Step 8: Implement the minimal deterministic composer**

Create `DeterministicResponseComposer implements ResponseComposerPort`. Iterate outcomes in plan
order and emit the single compatible speech act for the semantic class. Include only facts with
`disclosure === "allowed"`; include all options owned by the outcome. Do not inspect concrete
outcome types, fact keys, values or subject types.

- [x] **Step 9: Run composer and validator tests GREEN**

```bash
npx vitest run src/__tests__/V2SemanticDraftValidator.test.ts src/__tests__/V2DeterministicComposer.test.ts
```

- [x] **Step 10: Commit**

```bash
git add src/conversation-core/composer src/__tests__/V2SemanticDraftValidator.test.ts src/__tests__/V2DeterministicComposer.test.ts
git commit -m "feat(conversation-core): validate typed semantic response drafts"
```

---

### Task 3: Add monotonic repair, fallback and response orchestration

**Files:**
- Create: `src/conversation-core/composer/repair.ts`
- Create: `src/conversation-core/composer/fallback.ts`
- Create: `src/conversation-core/composer/response-pipeline.ts`
- Create: `src/__tests__/V2DraftRepair.test.ts`
- Create: `src/__tests__/V2SafeFallback.test.ts`
- Create: `src/__tests__/V2ResponsePipeline.test.ts`

**Interfaces:**
- Consumes: draft validation and deterministic composition from Task 2.
- Produces: redactive repair, plan-subset fallback and a gate that cannot render an unvalidated draft.

- [x] **Step 1: Write repair monotonicity tests and confirm RED**

Test real `repairDraft(plan, draft)` behavior:

- a valid act and invalid success act over a failed outcome returns only the valid act;
- an unauthorized fact act is removed rather than replaced;
- a substituted subject act is removed;
- order of surviving acts is unchanged;
- repair never adds an outcome/fact/subject ref absent from the original draft.

Run:

```bash
npx vitest run src/__tests__/V2DraftRepair.test.ts
```

- [x] **Step 2: Implement redactive repair**

For each act, validate a one-act draft with the real validator and retain it only when valid. Remove
exact duplicate acts by a stable structural key. Do not synthesize or rewrite an act.

- [x] **Step 3: Write fallback monotonicity tests and confirm RED**

Assert that fallback uses only refs present in the plan, never changes an outcome class, may omit
content, and returns `null` for a plan with no safely renderable/disclosable material.

- [x] **Step 4: Implement minimal fallback**

Build a conservative draft using the same class-to-act mapping as deterministic composition, but
select at most one safe act per outcome. Return `null` when no act can be built. Validate fallback
inside its public function and return only a branded draft.

- [x] **Step 5: Write response-pipeline tests and confirm RED**

Use small in-memory composer implementations and the real validator/repair/fallback:

- valid compose path reaches renderer once;
- invalid draft is repaired before render;
- invalid-only draft uses fallback from the same plan;
- composer error uses fallback without external reads;
- empty/incoherent authority returns `no_safe_response` and never calls render.

- [x] **Step 6: Implement response orchestration**

Expose:

```ts
export type V2ResponsePipelineResult =
  | { status: "rendered"; source: "draft" | "repair" | "fallback"; response: CoreResponse }
  | { status: "no_safe_response"; violations: readonly DraftViolation[] };

export async function runV2ResponsePipeline(input: {
  plan: V2AuthorizedResponsePlan;
  style: ComposerStyle;
  composer: ResponseComposerPort;
  render(validated: ValidatedDraftResponse): CoreResponse;
}): Promise<V2ResponsePipelineResult>;
```

Every branch must validate before invoking `render`. A composer exception skips directly to the
same-plan fallback. No exception path may return text.

- [x] **Step 7: Run repair/fallback/pipeline tests GREEN**

```bash
npx vitest run src/__tests__/V2DraftRepair.test.ts src/__tests__/V2SafeFallback.test.ts src/__tests__/V2ResponsePipeline.test.ts
```

- [x] **Step 8: Commit**

```bash
git add src/conversation-core/composer src/__tests__/V2DraftRepair.test.ts src/__tests__/V2SafeFallback.test.ts src/__tests__/V2ResponsePipeline.test.ts
git commit -m "feat(conversation-core): repair invalid drafts without new authority"
```

---

### Task 4: Render validated drafts with structured language and style

**Files:**
- Create: `src/conversation-core/composer/language.ts`
- Create: `src/conversation-core/composer/deterministic-renderer.ts`
- Create: `src/domain-packs/dental/response-language.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Create: `src/__tests__/V2DeterministicRenderer.test.ts`
- Create: `src/__tests__/DentalResponseLanguage.test.ts`

**Interfaces:**
- Consumes: branded validated drafts and authorized-plan refs.
- Produces: pure `CoreResponse` text with no semantic expansion and declarative dental terminology outside the core.

- [x] **Step 1: Write renderer safety tests and confirm RED**

Build validated drafts through the real validator, never by casting. Assert hand-derived text for:

```text
inform_fact            -> neutral label/value only
offer_options          -> "Tenho estas opções: ..." and never confirmation
confirm_effect         -> completion copy for the exact outcome/subject
communicate_failure    -> failure copy and never completion
inform_required_action -> requirement copy and never completed handoff
ask_clarification      -> one conservative question
```

Also assert renderer input cannot be a plain `DraftResponse` with `expectTypeOf`.

- [x] **Step 2: Define structured presentation contracts**

```ts
export type ValueFormat = "text" | "integer" | "currency_minor_brl" | "boolean";
export type ResponseLanguageContribution = {
  locale: "pt-BR";
  factTerms: readonly { factKey: string; label: string; format: ValueFormat }[];
  outcomeTerms: readonly { outcomeType: string; label: string }[];
  subjectTerms: readonly { subjectType: string; label: string }[];
};
```

Validate duplicate keys and reject empty/multiline/sentence-like labels. Do not allow callbacks,
templates, prompts, arbitrary style instructions or instance-specific values.

- [x] **Step 3: Implement the pure renderer**

Resolve only refs present in the validated draft. Pass only allowed facts to value formatting.
Use fixed core templates keyed exclusively by speech-act kind. Structured style may select among a
closed set of punctuation/connective/greeting variants but must not omit or add semantic acts.

- [x] **Step 4: Run renderer tests GREEN**

```bash
npx vitest run src/__tests__/V2DeterministicRenderer.test.ts
```

- [x] **Step 5: Add declarative Dental terminology under TDD**

Create a failing test that passes `DENTAL_RESPONSE_LANGUAGE` through the generic renderer and
expects safe price, slot, completed booking, failed booking and required-human-action surfaces.
Then add only noun labels and closed formats in `src/domain-packs/dental/response-language.ts`.
Do not add provider imports, I/O, callbacks or operational conditions.

- [x] **Step 6: Run dental language and architectural tests GREEN**

```bash
npx vitest run src/__tests__/DentalResponseLanguage.test.ts src/__tests__/arch/CoreImportBoundary.test.ts src/__tests__/arch/CoreDomainLexicon.test.ts src/__tests__/arch/DentalPackBoundary.test.ts
```

- [x] **Step 7: Commit**

```bash
git add src/conversation-core/composer src/domain-packs/dental/response-language.ts src/domain-packs/dental/index.ts src/__tests__/V2DeterministicRenderer.test.ts src/__tests__/DentalResponseLanguage.test.ts
git commit -m "feat(conversation-core): render validated semantic drafts"
```

---

### Task 5: Close bypasses and add adversarial semantic regressions

**Files:**
- Modify: `src/conversation-core/turn-pipeline.ts`
- Create: `src/__tests__/V2SemanticRegression.test.ts`
- Create: `src/__tests__/V2MultiIntentResponse.test.ts`
- Modify: `src/__tests__/FixturePackPipeline.test.ts`
- Modify: `src/__tests__/DentalOperationalPipeline.test.ts`
- Modify: `src/__tests__/PipelineDecisionBarrier.test.ts`
- Modify: `src/__tests__/CoordinatorConflict.test.ts`
- Modify: `src/__tests__/arch/CoreImportBoundary.test.ts` only if the new directory exposes an uncovered import form

**Interfaces:**
- Consumes: `runV2ResponsePipeline` from Task 3 and deterministic renderer from Task 4.
- Produces: an end-to-end in-memory H flow where raw compose/boolean validate callbacks cannot deliver text.

- [x] **Step 1: Write bypass and semantic-regression tests first**

Add literal plans/drafts covering these breaks:

- slots/options draft attempts `confirm_effect` (“Agendado!” semantics);
- media-information outcome attempts completed-send semantics;
- required-human-action attempts completed-handoff semantics;
- failed creation/confirmation attempts success semantics;
- absent/unknown service fact attempts a false/nonexistent fact ref;
- price fact for subject A is referenced from outcome/subject B;
- unauthorized discount/guarantee/clinical-attribute fact refs;
- invented slot fact ref.

Assert validator codes and that `runV2ResponsePipeline` renders only repair/fallback output.

- [x] **Step 2: Write multi-intent tests first**

Use two literal plans:

1. price subject A plus options subject A;
2. price subject A plus options subject B.

Assert distinct outcome/option/fact refs survive composition, validation and rendering, and that a
cross-linked draft is rejected in both cases.

- [x] **Step 3: Run new tests and confirm RED**

```bash
npx vitest run src/__tests__/V2SemanticRegression.test.ts src/__tests__/V2MultiIntentResponse.test.ts
```

- [x] **Step 4: Remove the raw response bypass from `runTurnPipeline`**

Replace the independent `compose(plan)` and boolean `validate({ plan, response })` callbacks with a
single response boundary that returns `V2ResponsePipelineResult`. Deliver only `status:
"rendered"`; map `no_safe_response` to the existing rejected turn outcome. Keep gate,
coordination, decide-all-before-execute and ActionResults unchanged.

- [x] **Step 5: Migrate pipeline tests to the real H response pipeline**

Use `DeterministicResponseComposer`, real validator/repair/fallback and deterministic renderer in
fixture/dental delivered paths. Conflict/read-failure tests must continue proving the response
stage is unreachable.

- [x] **Step 6: Run all H, G and architecture tests GREEN**

```bash
npx vitest run \
  src/__tests__/V2AuthorizedResponsePlan.test.ts \
  src/__tests__/V2SemanticDraftValidator.test.ts \
  src/__tests__/V2DeterministicComposer.test.ts \
  src/__tests__/V2DraftRepair.test.ts \
  src/__tests__/V2SafeFallback.test.ts \
  src/__tests__/V2ResponsePipeline.test.ts \
  src/__tests__/V2DeterministicRenderer.test.ts \
  src/__tests__/V2SemanticRegression.test.ts \
  src/__tests__/V2MultiIntentResponse.test.ts \
  src/__tests__/DentalResponseLanguage.test.ts \
  src/__tests__/DentalOperationalPipeline.test.ts \
  src/__tests__/FixturePackPipeline.test.ts \
  src/__tests__/PipelineDecisionBarrier.test.ts \
  src/__tests__/CoordinatorConflict.test.ts \
  src/__tests__/arch/CoreImportBoundary.test.ts \
  src/__tests__/arch/CoreDomainLexicon.test.ts \
  src/__tests__/arch/DentalPackBoundary.test.ts
```

- [x] **Step 7: Commit**

```bash
git add src/conversation-core/turn-pipeline.ts src/__tests__
git commit -m "test(conversation-core): block semantic response escalation"
```

---

### Task 6: Document, self-review and close Cycle H

**Files:**
- Create: `docs/ai-system/cycle-h-composer-validator.md`
- Modify: `docs/superpowers/plans/2026-08-16-conversation-intelligence-v2-cycle-h.md` only to check completed steps

**Interfaces:**
- Consumes: complete H implementation and test evidence.
- Produces: review report source, verified checkpoint and explicit gaps for I without starting it.

- [x] **Step 1: Perform adversarial self-review**

Try to construct typed drafts that transform options into completion, failure into success,
required action into completed handoff, media information into sent media, unknown into false,
cross subjects/outcomes, elevate disclosure, or add authority through repair/fallback/style. Add a
failing regression test before fixing any discovered bypass.

- [x] **Step 2: Audit architectural boundaries**

Run:

```bash
git diff 7fb114f0 -- src/core
rg -n 'openai|anthropic|database|calendar|fetch|process\.env' src/conversation-core/composer
rg -n 'dental|dentist|treatment|appointment|service|price|slot' src/conversation-core/composer
```

Expected: zero V1 diff and zero provider/I/O/domain behavior in core H. Generic words appearing
only in test fixtures or type comments must be removed when they encode domain behavior.

- [x] **Step 3: Write the Cycle H report document**

Document contracts, the entailment proof, repair/fallback monotonicity, renderer constraints,
critical cases, multi-intent, domain/provider independence, RED→GREEN evidence, deviations and
gaps for I. State explicitly that no production adapter, provider or outbound path was added.

- [x] **Step 4: Run focused and architectural suites**

Run the complete Task 5 focused command and record exact file/test totals.

- [x] **Step 5: Run relevant scheduling regressions**

Because G scheduling result shapes changed, run:

```bash
npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts
```

- [x] **Step 6: Run the canonical verification**

```bash
npm run verify
```

Expected: database meta check, lint, typecheck and full Vitest suite all pass. Report any existing
warning separately; do not fix unrelated V1 warnings.

- [x] **Step 7: Commit documentation and final checkpoint**

```bash
git add docs/ai-system/cycle-h-composer-validator.md docs/superpowers/plans/2026-08-16-conversation-intelligence-v2-cycle-h.md
git commit -m "docs(ai-system): close cycle h"
git commit --allow-empty -m "chore(checkpoint): close cycle h"
```

- [x] **Step 8: Confirm terminal state**

Run:

```bash
git status --short --branch
git log --oneline 7fb114f0..HEAD
git diff --name-only 7fb114f0 -- src/core
```

Expected: clean `feat/conversation-core-v2`, local H commits, zero V1 diff, no push/PR/merge, and no
Cycle I/J or production-wiring files.
