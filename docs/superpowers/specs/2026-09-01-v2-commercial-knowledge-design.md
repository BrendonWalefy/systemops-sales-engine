# V2 Commercial Knowledge Design

**Status:** executable slice of the approved V2 capability roadmap.

## Outcome

Complete the read-only commercial path in the V2 runtime without V1 or free-text business-rule
inference:

- quote the current registered price, including one active campaign override;
- quote exact registered quantity packages and never extrapolate another quantity;
- explain configured payment methods and exact installment values;
- answer an exact registered objection;
- correct an old-price reference by returning only the current value and its provenance.

Understanding classifies the turn and copies canonical labels. Deterministic code resolves the
claimed tenant records and authorizes every value. The existing verbalizer may phrase the result
once, but it cannot add a price, condition, method, installment, campaign or objection answer.

## Canonical ownership

- List price, `from` semantics, quote permission and quantity packages remain in `treatments`.
- `price_campaigns` remains the only temporary price override. A campaign never overwrites the
  treatment and quantity packages continue to take precedence for an exact quantity.
- Installment rates remain in `organizations.installmentRates` and use the existing flat-rate
  formula.
- Registered objections remain in the active `playbook_versions.objections` list.
- Payment methods need a structured owner because the current free `commercialPolicy` text cannot
  safely authorize a business rule. `organizations.paymentMethods` becomes a bounded list of
  closed method codes edited in the existing Financeiro tab.

`commercialPolicy` remains editorial context and is not parsed for prices, methods or terms. No
second catalog, campaign table, objection store, vector search or rule engine is introduced.

## Understanding contract

The closed vocabulary gains `payment-options` and `registered-objection`.

- `price-of-service` requires one canonical service. `quantity` is optional, positive and integral;
  `quantityScope` is optional and closed to `total`, `superior` or `inferior`.
- `payment-options` may carry a canonical service when exact installment amounts were requested.
- `registered-objection` requires one exact `objectionQuestion` copied from the bounded active
  catalog supplied to Understanding.
- Objection answers, prices, payment configuration and campaign data never enter Understanding.
- A referenced historical price is not copied or trusted. It remains `price-of-service`; the
  commercial capability returns the current persisted authority.

## Commercial capability

`dental-commercial` owns price, payment and registered-objection reads. `dental-catalog` keeps
service availability only. The commercial read port is closed over the claimed tenant, turn time,
organization and active editorial snapshot.

For price, it resolves an exact tenant treatment and at most one currently active campaign through
the existing campaign resolver. The returned facts can include current amount, `from` qualifier,
original amount, campaign label/end date, exact quantity and scope. Missing, ambiguous,
non-quotable or malformed data fails closed. An unmatched quantity offers only the registered
packages; it is never calculated proportionally.

For payment, method codes are converted through one universal label map. Active installment rows
are validated, sorted and calculated from the exact effective service price with
`calculateFlatInstallment`. Without a service, the capability can disclose configured methods and
available installment counts but not invent an amount. Invalid or absent configuration produces
clarification or handoff.

For objections, the port matches the exact normalized canonical question selected by
Understanding and returns its one registered response with playbook-version/index evidence.
Unknown or unsafe responses escalate; the model's free `signals.objection` never becomes an
answer authority.

## Safety and effects

- One Understanding call and at most one verbalization; no model retry, judge or repair.
- No V1 import, runtime, fallback or shared V1 matcher.
- All disclosed money and numbers are explicit facts in the authorized response surface.
- Price and payment reads add at most one bounded, indexed campaign query for the exact tenant.
- The slice creates no scheduling, state-machine, notification or external business effect.
- Exact tenant scope is checked on treatments, campaigns, organization and active playbook.
- Decision Trace records request/capability/outcome/evidence and counts, never objection text,
  answers, prices, campaign labels or payment details.
- Outbox authority, sender preflight, consent, takeover and global kill switch are unchanged.

## Schema and rollout

The generated Drizzle migration adds only
`organizations.payment_methods jsonb not null default '[]'`. Existing tenants therefore gain no
new claim and are not activated or mutated beyond the inert default. The existing Financeiro UI
edits a strict, deduplicated closed list. Application rollback leaves the additive column inert;
contraction is deferred.

No price, campaign, installment or objection data is backfilled or rewritten. Deploy does not
activate any tenant and sends no synthetic message.

## Acceptance

- Schema/UI tests prove strict payment-method ownership and tenant-scoped writes.
- Understanding tests prove closed entities and that answers/configuration never reach the model.
- Capability tests cover campaigns, expiry, quantity packages, installments, exact objections,
  malformed data, ambiguity and isolation.
- Integrated and embedded PostgreSQL tests prove one event/process/reply/send/sent chain, no
  business effects, one Understanding, at most one verbalization and bounded indexed reads.
- The old-price scenario discloses only the current effective value with persisted evidence.
- Clean verification, build, CI, migration CI and preview precede normal develop-to-main promotion.
