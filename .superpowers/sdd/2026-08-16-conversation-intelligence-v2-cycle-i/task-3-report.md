# Task 3 report — Cycle I

## Status

Completed. This task only adds Cycle I comparison, protocol, human-review, and
gate-report contracts; it does not start Task 4 or production wiring.

## RED → GREEN

- RED: the four Task 3 suites failed because each required module was absent.
- GREEN focused suite: 6 files / 34 tests passed (the four new suites plus
  `CorpusCaseSchema` and `CorpusIndex`).
- Full verification: `npm run verify` exited 0 (Drizzle metadata, lint,
  TypeScript, and full Vitest suite). Lint retains the pre-existing, unrelated
  unused-variable warning in `src/core/intelligence/ResponseComposer.ts:34`;
  it has no lint errors.

## Delivered safeguards

- Strict, recursively frozen live comparison and approved-eval records. Live
  fields use fixed enums, ISO timestamps, commit hex, or exact HMAC refs; model
  IDs are accepted only from the supplied run allowlist. Live schema rejects
  unknown payload/PII-bearing fields and carries no text.
- HMAC-SHA256 keyed references; approved text requires either committed-corpus
  provenance or a signed-replay dataset plus approval digest.
- Approved pairs require V1/V2, one arm each, and the same snapshot.
- A frozen Cycle I protocol requires exactly 17 manifest cases, `N = 6`, and
  adjacent `V1_i → V2_i` order. Missing, duplicate, out-of-protocol, or
  infrastructure-error observations invalidate it.
- Blind review randomizes output position deterministically from the frozen run
  digest, requires both reviewers and all four boolean ratings, and preserves
  ties, disagreements, and per-reviewer scores.
- The gate report owns a frozen applicability matrix for every required
  criterion, translates absent measurements to `not_measurable`, marks the
  current judge as `experimental_non_gating`, and derives `GO` only when every
  blocking criterion is `pass`.

## Self-review / concerns

- Verified post-parse isolation from caller mutation, strict unknown-key
  rejection, HMAC formatting, model allowlist membership, arm/snapshot pairing,
  interleaving, missing reviewers, and forged-GO rejection.
- No database, provider, calendar, outbox, or external side effect was added.
- The only outstanding warning is the pre-existing lint warning noted above.
