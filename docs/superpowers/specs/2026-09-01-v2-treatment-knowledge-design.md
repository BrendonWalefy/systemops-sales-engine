# V2 Treatment Comparison, Differentials and FAQ Design

**Status:** executable slice of the approved V2 capability roadmap.

## Outcome

Answer three common knowledge turns without V1 or free-text inference:

- compare exactly two registered treatments;
- explain the organization's registered differentials;
- answer a registered frequently asked question.

The LLM identifies the request and copies canonical catalog labels. Deterministic capabilities
resolve the exact tenant-owned records, authorize the facts and decide whether to answer or ask for
clarification. The existing verbalizer may improve phrasing but cannot introduce another fact.

## Canonical ownership

- Treatment name, aliases and description remain owned by `treatments` and edited in the existing
  Knowledge treatment UI.
- Organization differentials remain owned by the active `playbook_versions.differentials` list and
  edited in the existing playbook editor.
- FAQ requires a structured question/answer pair, so `playbook_versions.faqs` becomes its single
  owner. `notes` is not parsed as FAQ because it has no deterministic question/answer boundary.
- The active `EditorialConfig` exposes the published FAQ list. Draft data never reaches live turns.

No second knowledge store, vector database, embedding search or generic rule engine is introduced.

## Understanding contract

The closed dental request vocabulary gains:

- `compare-services`, requiring exactly two canonical `serviceCandidates`;
- `business-differentials`, requiring no service or FAQ entity;
- `frequently-asked-question`, requiring one canonical `faqQuestion` copied from the supplied FAQ
  catalog.

The live Understanding input receives bounded read-only FAQ questions from the already loaded
active editorial snapshot. It receives no answers. Semantic validation rejects missing, extra or
wrong-cardinality entities before a capability runs.

## Capability boundaries

`dental-explanation` expands its existing responsibility from one service description to comparison
of two exact services. Both services must resolve once within the claimed tenant and both must have
safe registered descriptions. It returns paired facts with treatment evidence; ambiguity or missing
description produces clarification.

`dental-playbook-knowledge` is a new read-only capability for two active-playbook facts:

- differentials: a bounded ordered list of safe configured values;
- FAQ: one answer selected by exact normalized canonical question.

Its port is closed over `context.editorial`; it accepts no tenant ID and performs no query. Evidence
references contain the active playbook version and item position, never content.

## FAQ schema and UI

```ts
type FrequentlyAskedQuestion = Readonly<{
  question: string;
  answer: string;
}>;
```

The JSONB list is non-null with default `[]`, generated through Drizzle. Validation permits at most
20 entries, unique normalized questions, questions of 1-120 characters and answers of 1-240
characters. Control characters and non-normalized whitespace are rejected. Empty draft rows are
removed before save; partially filled rows are rejected. The existing playbook editor manages the
list and publication validates it.

## Safety, observability and performance

- No V1 import, engine selector, fallback, retrying model call or second verbalizer.
- One Understanding call and at most one verbalization per inbound.
- Exact tenant scope is inherited from the lifecycle context and active playbook read.
- Missing, ambiguous, malformed or cross-tenant data fails closed as clarification.
- Comparison and FAQ are read-only: no state, scheduling, notification, job or business effect.
- Decision Trace records request, capability, outcome and evidence counts, never questions,
  answers, descriptions or differential text.
- The same turn snapshot already loaded for tone now supplies editorial facts; no extra database
  query, lock, worker, polling or Neon idle activity is introduced.

## Rollout and rollback

The migration adds only `playbook_versions.faqs jsonb not null default '[]'`. Existing versions
therefore contain no FAQ and answer honestly with clarification. No tenant is populated or
activated by deploy. Application rollback leaves an inert additive column; contraction is deferred.

## Acceptance

- RED/GREEN tests cover schema/UI validation, publication and tenant scope.
- Understanding tests cover exact entity requirements and prompt/catalog boundaries.
- Capability tests cover success, missing facts, ambiguity, unsafe values and tenant isolation.
- Live-handler and PostgreSQL measurement prove one answer/outbox, at most two model calls, no
  effects and no added query/lock/cardinality.
- Clean `npm run verify`, authority PostgreSQL suite, production build, CI, migration CI and preview
  precede normal develop-to-main promotion.
