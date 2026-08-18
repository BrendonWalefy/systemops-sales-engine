# Conversation Intelligence V2 — Cycle H Hardening Design

Date: 2026-08-16
Status: approved
Canonical decision: `CI-V2-H-GATE-2026-08-16`
Starting checkpoint: `32e6dd82`

## Goal and boundary

Hardening closes the authority gaps found by the independent adversarial review without starting
Cycle I or changing V1. The required property is:

```text
semantics(finalText) ⊆ semantics(validatedDraft) ⊆ semantics(authorizedPlan)
```

The selected strategy is **closed generic lexicon plus variable data explicitly authorized by the
plan**. H remains deterministic, in-memory and provider-free.

## Trust flow

```text
Domain Pack outcome schema
  -> executed ActionResults
  -> canonical plan builder
  -> validated + branded + deeply frozen AuthorizedResponsePlan
  -> composer port
  -> unknown/untrusted draft
  -> canonicalize once into new plain immutable data
  -> validate that exact snapshot
  -> ValidatedDraftResponse
       invalid -> reductive repair -> validate
       invalid -> plan-only fallback -> validate
  -> deterministic closed renderer
  -> FinalText
```

There are exactly two trust promotions: untrusted executed results become a validated plan, and an
untrusted draft snapshot becomes a validated draft. Neither promotion is structural typing alone;
both require runtime registration owned by their canonical validator.

## Outcome schema: one source for type and runtime truth

Each Domain Pack provides a generic outcome registry whose keys are its concrete `OutcomeType`s.
Each entry declares only generic core semantics:

```ts
type OutcomeDefinition = Readonly<{
  semanticClass: OutcomeSemanticClass;
  subjectRequirement: "required" | "optional" | "forbidden";
  evidenceRequirement: "required" | "write_required" | "optional";
}>;
```

The type-level ActionResult union is derived from the same registry value used by runtime
validation. There is no parallel enum/table. The core knows the generic rule vocabulary but no
dental literal. Runtime parsing remains mandatory because casts, JavaScript and external data can
bypass TypeScript.

The registry must reject mismatches such as failure/options/media-information represented as
completed, escalation represented as completed, and completed effects without write evidence when
their definition requires it.

## Canonical AuthorizedResponsePlan boundary

The plan builder consumes the registered outcome schema and the ActionResults that were actually
executed. It canonicalizes them into a new plain-data graph, validates every relationship, creates
one immutable snapshot, deeply freezes it and registers that exact object as trusted.

It rejects invalid version, duplicate refs, dangling refs, missing graph nodes, incoherent
outcome/fact/option/subject relationships, missing required evidence and authority not derivable
from the executed results. The turn pipeline no longer accepts an arbitrary `buildPlan` callback;
it either invokes the canonical builder or accepts only a registered plan demonstrably associated
with the same executed-results snapshot.

## Untrusted draft canonicalization and TOCTOU

Composer output is `unknown`. Canonicalization reads each supported field in a controlled pass and
copies it into a new plain object. Validation never returns to the source object. The new snapshot
is deeply frozen before validation, and the validator registers exactly the snapshot it checked.

Getter, accessor or proxy behavior can at most influence the one canonicalization read. It cannot
swap a validated failure for a branded success between validation and registration. Source aliases
and mutations after canonicalization cannot reach the trusted snapshot. Malformed or throwing
accessors fail closed.

## Closed language and semantically typed values

`ResponseLanguageContribution` is removed from the H safety boundary. The renderer receives only a
registered `ValidatedDraftResponse`, its associated registered plan and closed generic templates.
It has no callback, provider, database, calendar, Domain Pack or tenant-config input.

Variable material required for communication belongs to plan authority. A subject separates its
opaque internal identity from an authorized public display value; internal IDs are never rendered.
Facts and options use only the value kinds required by H, such as authorized display text, integer,
money and structured date/time option. There is no arbitrary formatting function and no universal
presentation DSL.

The renderer serializes already-selected acts and typed values. It does not select outcomes,
facts, subjects or options, and cannot decide price, availability, completion, failure, booking,
handoff or media delivery. Greeting, emoji and style are absent unless later represented as
explicit authorized semantics.

## Subject preservation

Outcome, fact and option subject relationships remain intact through the graph and draft. With one
unambiguous subject, rendering may stay concise. With multiple relevant subjects, every ambiguous
act is qualified with its authorized public display value. Same-subject and cross-subject
multi-intent cases therefore cannot render as semantically indistinguishable text. Scheduling
preserves the service subject when it is semantically known.

## Repair and fallback

Repair may only remove invalid or policy-defined duplicate acts, preserving survivor order. It
canonicalizes and freezes new copies before revalidation and never preserves mutable aliases:

```text
semantics(repair) ⊆ semantics(originalDraft) ∩ semantics(authorizedPlan)
```

Fallback derives solely from the same registered plan, uses only its existing refs and passes the
same validator. With no safe material it returns `no_safe_response`:

```text
semantics(fallback) ⊆ semantics(authorizedPlan)
```

## Verification and gates

Implementation proceeds finding by finding with a witnessed RED, minimal correction, GREEN and
related regressions before the next finding. Required tests include runtime and compile-time
outcome coherence, brands and casts, plan graph failures, TOCTOU/proxy/accessor/alias mutation,
language authority, subject disambiguation, repair/fallback monotonicity and renderer bypass.

H closes only after focused H/G/architecture suites, scheduling regressions and exact
`npm run verify` pass; `src/core/**` remains unchanged; composer/renderer contain no provider/model
call; and a fresh adversarial review fails to falsify the entailment property.

The qualitative V1×V2 comparison remains mandatory but belongs to Cycle I under canonical decision
`CI-V2-H-GATE-2026-08-16`. No Cycle I implementation is part of this design.

## Deliberately excluded

- probabilistic composer or renderer;
- post-render model validation;
- outbound, production wiring, shadow or cutover;
- a general presentation DSL;
- unrelated minor cleanup;
- any change to V1 `src/core/**`.
