# Conversation Intelligence V2 — Cycle G Design

Date: 2026-08-16
Status: approved for autonomous execution by the Cycle G continuation instruction
Starting checkpoint: `96ff0742e7a0ced085072cd050892503269fe6d6`

## Goal and scope

Turn the Cycle F dental representations into deterministic, operational capabilities for the
supported price and scheduling journeys. G ends at `ActionResult` and a generic authorized-plan
contract. It does not build the productive composer, wire V2 into production, compare V1×V2, or
change V1.

## Alternatives considered

### Authorized reads

1. **Capability-owned, pre-scoped ports — selected.** Read and write ports are injected when the
   concrete capability is constructed. The composition root scopes them to one tenant/lead. Reads
   are callable only by `decide`; writes are callable only by `execute`.
2. Put repositories/providers in `CapabilityContext`. Rejected: this makes the generic core a
   service locator and exposes every integration to every capability.
3. Preload every possible read into policy. Rejected: policy stops being policy, reads become
   stale, and each new capability inflates a shared context.

### Claim data

1. **Generic structured attributes on `CapabilityClaim` — selected.** Primitive attributes carry
   request/entity/state references from pure claim to decide. The coordinator remains mechanical.
2. Generic per-capability claim types. Rejected for now: heterogeneous capability arrays require
   existential typing machinery with no additional runtime safety for this slice.
3. Add Understanding to `CapabilityContext`. Rejected: it broadens every decision boundary and
   makes it easier for capabilities to reinterpret upstream output.

### Authorization

Every result fact carries a subject, evidence and disclosure status. A V2 plan builder preserves
only disclosable facts. Price facts must be scoped to a service subject; schedule facts remain
scoped to their offered slot or appointment. Unscoped or internal facts never enter the plan.

## Components and data flow

1. Understanding enters a pure `claim()` and becomes a claim with structured attributes.
2. Coordinator resolves declared dependencies/conflicts before decisions.
3. Every selected capability completes `decide()` using only policy, clock and its own read port.
4. Only after all decisions succeed does the pipeline call `execute()` in pack order.
5. Write ports return evidence-bearing outcomes. Failed writes return failure ActionResults and
   never facts claiming success.
6. The generic plan builder unions authorized facts without flattening subject/evidence links.

`CapabilityContext` remains exactly `{ state, policy, now }`. Ports are not added to it.

## Dental capabilities

- Catalog resolves an identified service against a tenant-scoped catalog. It can disclose a price
  only when policy allows it and the read result authorizes that exact service-price pair.
- Scheduling reads offers for booking requests, resolves a previously offered slot for
  confirmation, and calls its write port only for a validated selection.
- Escalation owns structured safety signals. It conflicts with Catalog/Scheduling and produces no
  external write in this slice.

`service-availability` is catalog ownership: it asks whether a service exists, not whether a
calendar slot exists. `book-appointment` and pending confirmations belong to Scheduling.

## Failure handling

- Unknown or ambiguous service produces clarification, never a fabricated negative or price.
- No slots produces an evidence-bearing empty result, never invented availability.
- Missing pending state/selection produces clarification and no write.
- Read failure rejects the turn before writes because all decisions complete first.
- Booking failure returns a failure result; it cannot expose appointment-created facts.
- Claim conflict or missing dependency blocks all decisions/writes through the coordinator.

## Tests and exit gate

Tests prove read/write phase separation, scoped price authorization, failed-write honesty,
decision-before-effects, conflict/dependency blocking, pack/core import boundaries, and fixture
compatibility. Final gates are focused capability tests, scheduling regression tests, exact
`npm run verify`, zero V1 diff, zero H/I/J files, clean tree and a local checkpoint commit.
