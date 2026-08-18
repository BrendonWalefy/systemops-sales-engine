# Conversation Intelligence V2 — Cycle H Design

Date: 2026-08-16
Status: superseded for final H closure by the approved hardening design
Starting checkpoint: `7fb114f0`

> Historical design note: the independent adversarial review after checkpoint `32e6dd82` found
> trust-boundary gaps in the plan, draft canonicalization, outcome typing and language input. For
> the active closure criteria and superseding runtime design, see
> [`2026-08-16-conversation-intelligence-v2-cycle-h-hardening-design.md`](./2026-08-16-conversation-intelligence-v2-cycle-h-hardening-design.md).

## Goal and scope

Cycle H turns a `V2AuthorizedResponsePlan` into controlled natural language without adding facts,
outcomes, actions or capabilities. It ends at an in-memory final response. It does not wire V2 to
production, send outbound messages, run V1×V2, start shadow mode or perform cutover.

The safety property is:

```text
semantics(finalText) ⊆ semantics(validatedDraft) ⊆ semantics(authorizedPlan)
```

The plan authorizes, the draft organizes, the validator proves and the renderer verbalizes.

## Alternatives considered

1. **Typed semantic draft plus deterministic renderer — selected.** The composer emits only
   structured references and speech acts. Validation happens before rendering, so critical
   invariants do not depend on interpreting prose.
2. Free prose plus probabilistic entailment validation. Rejected for H: a model can complement a
   deterministic gate later, but cannot override it or be the only proof of authorization.
3. Pre-rendered final sentences inside the authorized plan. Rejected: it couples decision results
   to presentation and removes the useful style boundary.

## Generic outcome model

The current G `ActionResult` keeps only a concrete `type` and a flat fact list. H needs a minimal,
generic extension because that shape cannot prove whether a result represents information,
options, a completed effect, a failed effect, required human action or clarification. It also
cannot preserve option grouping.

Each result will therefore carry:

- concrete `outcomeType`, owned by the capability or Domain Pack;
- generic `semanticClass`: `information_authorized`, `options_found`, `effect_completed`,
  `effect_failed`, `human_action_required` or `clarification_required`;
- `origin`, containing the capability identifier;
- outcome subject when one exists;
- outcome evidence/provenance;
- related facts;
- structured options, only for `options_found`.

This metadata records a decision already made by the capability. It does not decide again. The
core treats concrete outcome identifiers, capability identifiers and subject types as opaque.

## Authorized plan as a graph

`buildV2AuthorizedResponsePlan` converts results into a referential graph instead of flattening
them:

```text
AuthorizedOutcome
  -> subjectRef
  -> evidenceRefs
  -> factRefs
  -> optionRefs

AuthorizedOption
  -> subjectRef
  -> factRefs

AuthorizedFact
  -> subjectRef
  -> evidenceRef
  -> disclosure
```

The plan owns stable turn-local refs for outcomes, options, facts, subjects and evidence. Internal
facts remain represented with their disclosure status so invalid references can be rejected, but
they are never supplied to the renderer. Duplicate or dangling relationships make plan building
fail closed.

Outcome boundaries preserve multi-intent attribution. A price fact in outcome A cannot be used by
an options act for outcome B, even when both subjects have similar labels.

## Composer and semantic draft

At the initial checkpoint, `ResponseComposerPort` was designed to receive only:

- the authorized plan;
- a structured style configuration containing closed enums;
- a declarative language contribution.

It has no context for repositories, providers, tenant configuration, the original message,
Understanding, capabilities or side effects. The initial implementation is deterministic and
maps each outcome class to a semantically equivalent act while preserving plan order.

`DraftResponse` contains no authoritative free prose. H supports only the required speech acts:

- `inform_fact`: outcome, fact and subject refs;
- `offer_options`: outcome, optional outcome subject and option refs;
- `confirm_effect`: outcome and effect subject refs plus related fact refs;
- `communicate_failure`: outcome ref;
- `inform_required_action`: outcome ref;
- `ask_clarification`: outcome ref.

The draft builder does not choose services, prices, slots, truth, booking, escalation or
capability ownership. It includes every disclosable fact and every renderable outcome, then orders
them deterministically.

## Deterministic entailment validator

The validator works on refs and types, never regex or prose. It checks:

- every outcome, option, fact and subject ref exists;
- facts/options belong to the referenced outcome;
- fact subjects match the draft subject ref;
- option subjects and outcome subjects are not substituted;
- only `disclosure: allowed` facts are referenced;
- `options_found` permits only `offer_options`;
- `effect_completed` permits only `confirm_effect`;
- `effect_failed` permits only `communicate_failure`;
- `human_action_required` permits only `inform_required_action`;
- `clarification_required` permits only `ask_clarification`;
- `information_authorized` permits only `inform_fact`;
- successful acts have the exact completed-effect subject;
- each referenced fact/effect remains attached to its concrete outcome.

Validation returns structured violation codes. Only this module can brand a draft as validated.

## Repair and fallback

Repair is intentionally narrower than the maximum allowed behavior: it only removes invalid or
duplicate speech acts and preserves the order of surviving acts. It never replaces refs or adds
semantic material. Therefore:

```text
semantics(repairedDraft) ⊆ semantics(originalDraft) ∩ semantics(authorizedPlan)
```

If repair leaves no valid material, fallback derives a minimal compatible draft directly from the
same plan. It may omit authorized material but cannot manufacture refs, change semantic class or
upgrade an effect. If the plan has no safely renderable material, the response pipeline returns a
structured `no_safe_response` result and no text.

The orchestration is:

```text
compose -> validate
  -> invalid: repair -> validate
  -> still invalid/empty: fallback -> validate
  -> valid: deterministic render
  -> no valid material: no_safe_response
```

Every attempt receives the same immutable plan. No step performs I/O.

## Renderer and language contribution (superseded for final H closure)

The renderer described below records the initial H design and is not the final trust boundary.
The hardening design removes `ResponseLanguageContribution` and arbitrary structured presentation
data from the renderer. Historically, the initial design stated that the renderer accepted only a
branded validated draft, its plan and structured presentation data.
It uses fixed templates selected by speech-act kind. It can control punctuation, safe connectors,
greeting, tone and concision, but it cannot select or mutate semantic refs.

Historically, the language contribution was declarative data: locale, neutral labels for fact keys, outcome types
and subject types, plus closed value-format enums. It contains no callbacks, prompts, operational
rules, instance facts or provider configuration. Dental terminology, when needed, stays in the
Dental Pack and is injected into the generic renderer; the core never imports it.

The initial renderer is deterministic. A future probabilistic renderer would require an
additional post-render semantic validator before outbound and cannot bypass the deterministic
draft gate. That adapter is outside H.

## Critical distinctions

- `options_found` can offer options and cannot confirm an effect.
- `effect_completed` can confirm only the exact effect and subject proved by the outcome.
- `effect_failed` can communicate failure and cannot produce success.
- `human_action_required` can state that human action is needed and cannot claim completed
  handoff.
- media information cannot become `media_sent`; only an explicit completed effect can confirm it.
- absence of an authorized fact cannot produce false, inexistence or unavailability.
- price and option facts cannot cross outcome or subject boundaries.

## Testing strategy

TDD will establish RED before each production contract. Focused suites cover:

- plan graph identity, provenance and non-flattening;
- dangling and cross-outcome refs;
- the full speech-act compatibility matrix;
- success/failure, media/handoff and UNKNOWN distinctions;
- same-subject and cross-subject multi-intent;
- repair and fallback monotonicity;
- pure deterministic rendering for every act;
- a composed response pipeline where render is unreachable before validation;
- architectural import/provider/domain lexicon boundaries;
- representative sanitized semantic regressions, never automatic human-response goldens.

The final gate includes focused tests, relevant corpus guards, exact `npm run verify`, zero diff in
`src/core/**`, a clean worktree and a local checkpoint commit.

## Deliberately outside H

- OpenAI or any free-prose composer/renderer;
- post-render probabilistic entailment validation;
- production composition root or outbound delivery;
- V1×V2 comparison, shadow traffic and final quality evaluation;
- tenant migration, cutover or removal of V1/scars;
- new domain capabilities or operational decisions.
