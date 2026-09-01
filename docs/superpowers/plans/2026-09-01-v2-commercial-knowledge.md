# V2 Commercial Knowledge Implementation Plan

**Goal:** Complete current price/campaign, quantity, payment/installment and registered-objection
answers in V2 using existing business owners plus one structured payment-method field.

**Spec:** `docs/superpowers/specs/2026-09-01-v2-commercial-knowledge-design.md`

## Constraints

- V2-only; no V1 import, matcher, runtime or fallback.
- The model classifies and verbalizes; deterministic code resolves and authorizes.
- One Understanding and at most one verbalizer call.
- No text parsing of `commercialPolicy` and no tenant ID from model output.
- No polling, worker, trigger, procedure or hand-written migration.
- Every phase is RED -> GREEN -> refactor and ends in a focused commit.

## Phase 1: Structured payment-method owner

**Files:** `schema.ts`, `clinic.ts`, organization reader/settings action, Financeiro tab, strict config
module, schema/UI/action tests and generated `drizzle/0108_*`.

1. RED: reject unknown, duplicate, malformed and cross-tenant payment-method writes; prove dry
   display and existing installment settings are unchanged.
2. GREEN: add bounded closed method codes with default `[]`, parse at every boundary and expose
   checkboxes in the existing Financeiro tab.
3. Generate with `npm run db:generate`; stop if SQL is not one additive JSONB column/default.
4. Run focused tests, schema check, lint, typecheck and diff check.
5. Commit `feat(commercial): add structured payment methods`.

## Phase 2: Closed commercial Understanding

**Files:** dental vocabulary/schema/prompt, Understanding provider/model input, live handler and
contract/prompt/model tests.

1. RED: classify payment, exact registered objection, exact positive quantity/scope and old-price
   references; reject extraneous entities and prove objection answers/config never enter input.
2. GREEN: add the two requests and canonical objection-question catalog to the existing one-call
   boundary; bump the prompt version.
3. Refactor fixtures without loosening strict schemas.
4. Run focused tests, lint, typecheck and diff check.
5. Commit `feat(v2): classify commercial requests`.

## Phase 3: Current price, campaign and quantity authority

**Files:** dental ports/commercial capability/pack/provenance, live and captured adapters, runtime
composition, price-campaign adapter and commercial tests.

1. RED: prove list price, `from`, active/expired campaign, old-price correction, exact quantity,
   duplicate-scope ambiguity, unsupported quantity, non-quotable and cross-tenant behavior.
2. GREEN: add `dental-commercial`, reuse `resolveEffectivePrice`, cache one bounded campaign read
   per commercial turn and emit explicit money/qualifier/campaign/quantity evidence.
3. Keep `dental-catalog` responsible only for service availability.
4. Run focused tests, price-campaign tests, lint, typecheck and diff check.
5. Commit `feat(v2): authorize effective commercial prices`.

## Phase 4: Payment and registered objections

**Files:** commercial capability/read port/live adapters, payment config, response/provenance tests,
live handler tests.

1. RED: prove methods, available installment counts, exact service installment amounts, invalid
   rates, absent configuration, exact objection answer, unknown objection escalation and no free
   model signal authority.
2. GREEN: reuse `calculateFlatInstallment`, active editorial objections and strict payment method
   labels; authorize each number/money value as a fact.
3. Ensure escalation ignores an exact registered-objection request but owns every unresolved free
   objection.
4. Run focused tests, lint, typecheck and diff check.
5. Commit `feat(v2): answer payment and registered objections`.

## Phase 5: Integrated proof and documentation

**Files:** journey matrix, V2 performance PostgreSQL test/population, current architecture and
capability parity.

1. RED: add campaign, quantity, payment/installment and objection journeys through the real
   handler and embedded PostgreSQL authority path.
2. GREEN: require cardinality `1/1/1/1/1`, one Understanding, at most one verbalization, no state or
   agenda effect, at most one additional indexed campaign read and lock duration within the current
   measured tolerance.
3. Update only completed commercial matrix rows and document remaining scheduling/journey work.
4. Commit `test(v2): prove commercial knowledge completion`.

## Delivery gates

On a clean tree run:

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

Push normally, open a focused PR to `develop`, wait for Verify, Migration CI and Vercel, merge
normally, create the standard `develop -> main` release PR, repeat remote gates and require READY
at the exact production SHA. Do not populate tenant data, activate a tenant or send a synthetic
WhatsApp message during deployment.
