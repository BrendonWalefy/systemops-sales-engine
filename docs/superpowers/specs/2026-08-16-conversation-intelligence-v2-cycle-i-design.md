# Conversation Intelligence V2 — Cycle I Design

Date: 2026-08-16
Status: approved by the user prompt; detailed against the real runtime before implementation
Canonical decision: `CI-V2-I-SHADOW-2026-08-16`
Starting checkpoint: `99a852aa`

## Goal and boundary

Cycle I answers whether V2 is at least as safe and useful as V1 on the journeys V2 actually
supports, without letting the comparison execute a V2 side effect. It adds the productive
composition root outside `src/conversation-core/**`, records reproducible comparisons, executes
the predeclared corpus protocol, and creates the reversible tenant engine selector required for
internal dogfooding.

This design does not add unsupported capabilities, remove V1, perform external-client cutover,
weaken the H entailment gate, or reinterpret an empty period without traffic as stability.

## Decisions made before measurement

The following decisions are fixed before any final V1×V2 result:

1. The primary population is the committed, valid, Cycle-F-supported dental corpus. Cases outside
   that manifest remain visible as `unsupported`, not failures silently removed after the run.
2. Stable cases form primary analysis. Every D0-unstable case that is representable by V2 forms
   sensitivity analysis. An empty sensitivity intersection is reported as empty, never promoted
   into the primary population.
3. Each measured arm uses the same case set, the same fixed turn clock and the same read snapshot.
   Runs are paired and interleaved `V1_i → V2_i`, with `N = 6` unless a run fails. A missing arm
   invalidates the pair; it is never borrowed from another session.
4. The Cycle C/D0 quantitative victory rule remains bound to its original 64-case comparable
   Understanding population: every pair favors V2, mean delta is at least 3.0 percentage points,
   stable-case improvements are at least twice the regressions, critical regressions are zero in
   every stratum, and the V2 range is at most 1.6 points at equal `N = 6`. The 17-case supported
   scope has different score granularity, so those percentage thresholds are not transported to
   it. Its predeclared gate is the existing Section-14 rule: V2 request accuracy is at least V1 on
   the exact same 17 cases, the Cycle-F per-axis acceptance remains green, and critical
   regressions are zero. This decision precedes any Cycle-I V2 measurement.
5. The existing prose judge remains `experimental_non_gating`. It may be logged but cannot decide
   GO. Qualitative GO requires either a replacement that first passes the existing calibration
   protocol or structured human review using `review-checklist.v2-calibrada`.
6. Complete-turn cost and latency are compared at equivalent boundaries. The zero inference cost
   of H is not used as a proxy for total V2 turn cost.

## Alternatives considered

### Selected: captured-read shadow plus recording execution

V1 stays the control. During its normal run it exposes immutable copies of only the read material
it actually used: turn input, clock, history/state, tenant/domain configuration, catalog
resolution, pending offer and availability result. After the V1 response/outcome is known, V2
runs against adapters backed exclusively by those captured values. Its write ports are recording
ports that emit `would_have_executed` and never call repositories, BookingService, calendar,
outbox, channel, CRM or state mutation.

Completion of V1 is only the temporal trigger that permits shadow scheduling to begin; the V1
outcome does not control eligibility or inclusion. It is not an input to V2 Understanding,
claims, decisions, plans or text, and appears only in the control arm's comparison record.
V2 receives the pre-effect turn observation and the values captured by the individual V1 reads,
never a projection derived from the answer or side effects produced by V1.

This is selected because it satisfies the canonical same-read rule without teaching the generic
core about V1, infrastructure or tenant configuration.

### Rejected: run V2 before or after V1 with fresh production reads

Before V1, the two arms can observe different clock/calendar values and duplicate provider reads.
After V1, V2 can observe state or appointments that V1 just mutated. Both contaminate the
comparison and violate the canonical shared-read rule.

### Rejected: replay-only Cycle I

Replay is the strongest E2E evidence and remains required where an approved dataset exists, but a
replay-only implementation leaves no productive composition root, engine selector or internal
rollback seam. It also cannot manufacture the currently absent human-approved private dataset.

## Runtime topology

```text
durable inbound event
  -> message worker composition root
  -> V1 ConversationOrchestrator (control)
       -> immutable V1TurnObservation + CapturedReadSnapshot
       -> V1 real effects/outbox, unchanged
  -> V1 inbound marked terminal and existing sender drains the V1 outbox
  -> tenant/window/cost gate
  -> V2ShadowRunner
       -> DentalUnderstandingProvider
       -> dental capabilities with captured-read adapters
       -> recording write ports
       -> H plan/composer/validator/renderer
       -> ComparisonRecordSink
  -> worker returns its normal result
```

The shadow batch is turn-local and in memory; it does no I/O while V1 runs. The worker invokes it
only after V1 inbound processing and the existing sender drain are terminal. It has a
tenant/window admission deadline and is awaited—never fire-and-forget in serverless. An exception,
malformed result or missing captured read may become a best-effort V2 error record after delivery
only when the comparison write itself is admitted before the deadline. If admission closes before
that sink admission, the outcome exists only in the frozen, in-memory batch summary and no DB
record starts. Neither path can change V1 acknowledgement, outbox or delivery. Work admitted
before the deadline is drained even when that makes the batch return after the nominal window.

## Admission deadline, mandatory drain and cooperative cancellation

Decision `CI-V2-I-ADMISSION-DEADLINE-2026-08-16`, approved on 2026-08-16, replaces every promise
of strict return-by-T in Task 5 with this exact runtime contract:

1. `deadlineAt` is an admission deadline. No provider call, DB read/write, side effect or other
   relevant asynchronous operation may start at or after it.
2. Every operation admitted before `deadlineAt` is observed and awaited to explicit completion or
   failure. No orphan Promise and no `Promise.race` may let the batch return while work remains.
3. Cancellation is cooperative where proven. The provider/OpenAI boundary receives
   `AbortSignal`; the summary distinguishes an abort request from cancellation acknowledged by a
   typed provider error. Fetch cancellation is not treated as proof of server-side DB cancellation.
4. Drizzle/Neon operations are prechecked immediately before start and then awaited. No mutation
   may start after admission closes or be dispatched after summary creation.
5. Closure caused by T records `admissionClosedAt = deadlineAt`. Return after T while draining
   admitted work is measured and named `overrun`, never strict deadline compliance.
6. The frozen, PII-free summary exposes whether admission closed, measured overrun and admitted
   operation drain facts. Its overrun evidence preserves the greatest valid clock sample already
   observed; a later malformed/non-monotonic sample fails closed and cannot erase proven overrun.
7. Strict return-by-T together with no orphan and no post-return commit needs a different
   execution boundary and cancellation owner. That is future architecture, not part of Cycle I.

This amendment is prospective and traceable to the Task 5 report: the prior implementation had a
QUALITY PASS, while the remaining blocker was semantic/architectural. Current ports cannot prove
the old guarantee, and a Neon HTTP abort cannot prove that the server did not commit. Mandatory
drain is therefore the safety-preserving choice. Tenant isolation, approvals, authority,
single-use envelopes, sender ordering, rollback, write isolation and observability remain intact.

## Composition root and dependency direction

Production assembly belongs under `src/application/conversation-v2/` and
`src/infrastructure/conversation-v2/`, constructed by the message-worker route. It may know the
OpenAI adapter, repositories, tenant config, feature flags, clock, trace sink and the V1
observation adapter.

`src/conversation-core/**` continues to know only generic contracts. The Dental Pack continues to
own its concrete request, claim payload, outcome schema and narrow read/write ports. No provider,
DB, calendar, config, V1 type or comparison persistence enters the generic core.

## Immutable captured reads

`CapturedV2TurnReads` is a canonical plain-data, deeply frozen, turn-local snapshot. Its parser
rejects prototypes other than `Object.prototype`/`Array.prototype`, accessors, proxies that throw
or change values between reads, non-finite numbers, unknown keys and mutable built-ins. It uses
an ISO-8601 string for `now`, never a `Date` object. It contains only the
minimum material for supported dental capabilities:

- a fixed `now` and immutable conversation phase/pending-step projection;
- the exact recent author/body history already supplied to V1, held only in the turn-local
  in-memory snapshot and never copied into live comparison persistence;
- tenant-scoped public catalog entries and the exact service resolution used by V1 when present;
- the exact pending offered-slot/appointment projection read by V1;
- the exact slot list returned to V1, including public labels and opaque turn-local refs;
- the structured dental policy values required by capabilities.

It never contains a repository, callback, live client, DB row object, calendar gateway, lead
phone/name, channel credential or mutable state-machine object. Missing capture is explicit. A V2
port asked for an uncaptured read returns `shared_read_unavailable`; it never falls back to a new
production read.

Reads with hidden mutation are prohibited. In particular, reservation expiry/release, lazy
upserts, media rehosting, profile lookup, trace persistence and any calendar method that creates
or refreshes state are not read adapters.

## Shadow execution

The generic turn pipeline is split without changing its normal behavior: a preparation stage
produces a canonical, immutable set of claims and decisions, and a completion stage executes and
promotes results. The existing `runTurnPipeline` composes both stages for normal callers.

Shadow invokes preparation first. If every decision is read-only, completion uses captured-read
adapters and write ports that fail closed if touched. If any decision is `execute`, shadow does
not call that capability's `execute()` at all. A Dental Pack adapter maps the closed, typed action
to one frozen intended-effect record:

```ts
type IntendedEffect = Readonly<{
  kind: "would_have_executed";
  capabilityId: string;
  payloadHash: string;
}> & (
  | Readonly<{ action: "book_slot"; payload: Readonly<{ slotRefHash: string }> }>
  | Readonly<{
      action: "confirm_appointment";
      payload: Readonly<{ appointmentRefHash: string }>;
    }>
);
```

This is a closed discriminated union, not an open runtime record. Adding a new effect requires a
new typed variant, canonicalizer, privacy test and comparison renderer. An unknown action makes
the shadow result `unsupported`; it is never forwarded to a real writer.

Payloads contain only allowlisted, turn-local identifiers or hashes. No phone, name, message,
prompt, credential, provider ID or external URL is recorded.

A simulated write is never represented as an `ActionResult`: there is no fabricated success or
failure evidence. The shadow result retains the real prepared `Decision` and intended effect,
sets execution to `simulation_not_executed`, and emits no FinalText for that write-dependent
branch. A committed offline fixture may separately supply an explicit execution receipt to test
the post-execution response path. Live simulated turns can pass decision-safety checks but do not
count as success-response evidence.

## Comparison record and privacy

There are two closed schemas. `conversation-v2-live-comparison.v2` is canonicalized from exact
plain data, parsed at runtime and frozen
before a dedicated application sink receives it. It includes:

- keyed-HMAC turn/conversation/input references; raw `turnId` is in-memory correlation only;
- commit, config fingerprint, dataset/case version and engine version;
- V1 and V2 Understanding summaries;
- capability claims, Decision kinds and ActionResult outcome types;
- authorized-plan and FinalText structural summaries, character count and keyed digest, never text;
- intended effects, latency, provider-call count, model IDs, tokens and estimable cost;
- errors, fallback source, `no_safe_response`, unsupported reason and divergence codes.

The `.v2` live schema is an exact discriminated union. `comparisonStatus = comparable` requires
an observed V1 arm with an HMAC final digest and character count. `not_measurable` requires the
exact V1 `unavailable/final_response_unavailable` arm and an empty divergence list. V2 has no
`unavailable` variant. Unsupported/error/simulation variants cannot carry outcomes, semantic
classes or final-response material. An unsupported result may carry model telemetry only when
the provider callback actually ran; pre-provider duplicate or missing-read rejection carries
`model: null`, and every non-null summary has `calls >= 1`. Observed/no-safe outcomes bind
capability, prepared Decision kind, concrete execute action when applicable, concrete outcome
type and canonical semantic class in one structured identity. The Dental Pack owns one frozen
provenance registry whose same literal definitions derive the TypeScript union and runtime
validation; the generic core remains unaware of dental literals. Redundant capability/Decision
arrays must align one-to-one and in order; invalid duplicates fail closed. Intended effects are
nonempty only for `simulation_not_executed`, align one-to-one with typed execute-decision
identities, including their concrete action and capability owner, and are forbidden for every
other status. The parser rejects proxies, accessors, symbol keys and
non-plain prototypes before schema evaluation, applies conservative depth/node/array/object
budgets, then validates and freezes the one canonical snapshot.

`conversation-v2-live-comparison.v1` was a pre-activation prototype. Zero live observations were
captured or persisted and zero tenant/channel was activated under that contract. It is therefore
rejected, not silently reinterpreted or migrated. This `.v2` decision was made during Task 7
hardening, before any V1×V2 result existed.

The round-3 relational completion also occurred before the first `.v2` observation,
persistence or tenant/channel activation. It replaces the unpublished parallel outcome arrays
with structured per-result identities under the already-selected `.v2` pre-activation contract;
this decision is recorded explicitly and does not reinterpret stored data.

The final provenance closure occurred under the same pre-observation condition. It makes the
Domain Pack registry authoritative for capability → Decision → concrete action → outcome →
semantic class/requirements, requires the application producer to pair each prepared Decision
with its exact ActionResult, and preserves concrete action identity in simulations and wire
round-trips. This closes an impossible-tuple gap; it does not migrate or reinterpret persisted
records because none exist.

Live records do not contain response text, raw lead input, raw history, prompts, names, phones,
emails, URLs, provider payloads, opaque database identifiers or raw evidence references. The
separate `conversation-v2-approved-eval.v1` permits sanitized text only for the committed corpus
or a human-reviewed, signed replay dataset outside Git. Its parser requires the corpus or replay
approval metadata.

Runtime comparison persistence follows the existing 30-day Decision Trace retention and
best-effort behavior but uses a V2 application/infrastructure sink and closed schema; V2 types and
stages do not enter `src/core/observability`. Persistence failure never changes the turn.

Writing this comparison record is an explicitly authorized observability effect, not a business
effect. It is performed only by the sink after the isolated shadow result is complete. No V2
capability receives the sink, and recording the comparison cannot update conversation state,
appointments, catalog, outbox or any external provider.

## Corpus comparison

The runner consumes the committed corpus index, Cycle-F acceptance manifest, D0 unstable-case
list and tenant fixtures. It refuses:

- a changed case set/digest after a run begins;
- unequal arm counts or non-interleaved ordering;
- `N != 6` for the final comparable report;
- a case silently dropped after an arm error;
- a threshold changed after measurements exist;
- unstable cases credited as primary improvement;
- an infrastructure/model error represented as a passing observation.

Decision scoring compares concrete expected outcomes only where the fixture supplies the read or
execution receipt needed to decide them. Unsupported or unmeasurable cases remain separate
denominators. Safety metrics always include both strata and are blocking.

### Task 6 authority and comparability hardening (post-review)

This amendment was approved on 2026-08-17 before any real V1×V2 Cycle I result existed: the
committed measurement state still had zero observations, no result artifact, and an unsigned
`NO_GO` report. It does not change any threshold retrospectively. The protocol population remains
exactly 17 cases and 204 scheduled positions. Until structured pending-slot state exists, exactly
15 cases are comparable (90 observed positions per arm / 180 total) and exactly
`scheduling-0003` and `burst-0002` contribute the remaining 24 explicit `not_measurable`
positions with reason `structured_pending_state_absent`.

The productive comparison is not authorized by structural JSON, HMAC-shaped strings or a caller
supplied model label. A configured Ed25519 public root verifies a frozen run manifest that binds
the implementation commit/tree, exact corpus/population/D0/comparability digests, tenant-fixture
digest, model IDs, prompt/adapter source digests and optional Decision/prose/full-turn artifacts.
The public root is process configuration and is distinct from the activation-approval root; it is
not accepted as a function argument. A serialized measurement run requires its own signature over
the complete canonical run before it can be re-registered for gate evaluation. The in-process
runner may register only the snapshot it parsed after executing the registered real V1/V2 arms.
Before either productive arm is invoked, a closed Git adapter snapshots the actual repository
`HEAD`, its tree object and cleanliness. The immutable registered attestation must match the signed
manifest's commit and tree digest; caller/env claims and a dirty tree are rejected with zero model
calls.

**Superseding source-attestation amendment (2026-08-17, pre-result).** Independent review proved
that Git status/index/config alone cannot attest the bytes actually executed: `PATH`,
`core.worktree`, stat-cache settings, `assume-unchanged` and `skip-worktree` can each hide a
different working file set. This decision was recorded while the real measurement state still had
zero observations, no result artifact, an unsigned manifest/report and `NO_GO`; no denominator or
quality threshold changed. Productive authority therefore additionally binds
`implementationSourceDigest`, computed directly by Node filesystem reads from the module-derived
repository root over the closed implementation scope (`src/**`, the Cycle-I CLI, package manifest,
lockfile and TypeScript config). Canonical entries bind normalized relative path, file mode, size
and SHA-256 of the bytes. Symlinks, root escapes, duplicate paths, hard-linked aliases,
non-regular files and files changing during capture fail closed. Within the trusted execution
substrate defined below, this source digest—not Git status—is the admission snapshot of the
implementation bytes and must match the signed run manifest before any arm call. It is not a proof
against a compromised host or code already executed before the snapshot. Commit/tree/status remain additional traceability and defense; the
Git worktree and config overrides are closed constants rather than caller or local-config
authority. Metadata and generated gate artifacts are deliberately outside the implementation
scope to avoid an autorreferential digest and remain separately content-bound.

### Task 6 trusted execution substrate (pre-result clarification)

The adversarial-input model starts after a trusted bootstrap. The OS/filesystem, Node executable,
`tsx`, package manager, dependencies installed from the committed lockfile, the minimal bootstrap
and absence of concurrent host mutation are the trusted execution substrate. Corpus/config/model
inputs, manifests, results and evidence artifacts remain adversarial. This boundary was recorded
on 2026-08-17 with zero real observations, unsigned `NO_GO` artifacts and no threshold,
denominator or gate change. The signed manifest binds the package-lock source snapshot plus Node
version/platform/architecture for reproducibility; it does not claim to prove npm installation,
Node binary or host integrity.

The canonical productive command loads only the trusted bootstrap and attestation adapter first.
It captures the registered admission snapshot before dynamically importing dotenv, the CLI,
runner, providers or application graph. Calling the productive CLI directly without that exact
registered preflight fails closed before provider construction or calls. If anti-host or
supply-chain guarantees are later required, Task 6 evidence must be produced by an external
immutable/signed build or CI execution boundary; in-process self-attestation and hashing all of
`node_modules` are explicitly not represented as that guarantee.

Decision evidence uses `conversation-v2-decision-fixtures.v2`. The signed run manifest binds the
fixture file digest and its frozen population digest. The file predeclares applicability for all
17 cases, and fixtures must exactly equal the applicable subset. A write receipt is content-bound
to `caseId`, captured-read `snapshotDigest`, intended effect action and payload hash, concrete
outcome type and source evidence. Missing, partial, dangling or incompatible material makes the
whole Decision layer `not_measurable`; it cannot shrink the denominator into PASS. In particular,
`scheduling-0003` and its `book_slot`/`appointment_confirmed` mismatch remain explicitly
unmeasurable until a canonical corpus decision is approved.

Understanding comparability is predeclared before calls. The corpus currently lacks a structured
pending-slot state for `scheduling-0003` and `burst-0002`; neither arm is called for those cases,
both scheduled rows remain visible as `not_measurable`, and they do not enter the
accuracy/critical-regression PASS denominators (90 per arm / 180 observations). They still remain
in the 204-row protocol-integrity denominator. This state is never inferred from prose.

Approved prose is a separately content-bound artifact covering exactly the same 90 V1/V2 pairs.
Every prose record's `snapshotDigest` must equal the corresponding comparison-run `inputDigest`.
Qualitative scoring becomes reachable only through its parser plus a complete calibration manifest
and two distinct calibrated reviewers. Calibration and rating records are signed under a
domain-separated, separately configured review authority and bind the run manifest, run digest,
reviewer and calibration. Full-turn cost/p95 becomes reachable only through a
content-bound artifact, a cryptographically approved `replay-dataset.v2`, and an isolated Lab
record with automation disabled. The replay approval root is resolved from closed configuration;
its key ID is bound by the signed run manifest and is never accepted as a function argument.
Deterministic H/shadow/Cycle-F/rollback/observability/verification/adversarial-review results are
also parsed from content-digested artifacts named by the signed manifest; raw HMAC references
cannot create PASS. Without those artifacts the gates stay `not_measurable` (or
`pending_human_review` only after approved prose exists); no synthetic ratings or replay are made.

### Frozen applicability matrix

Applicability is fixed before measurements and recorded in the report schema:

| Layer | Gating population and instrument | Gating rule |
| --- | --- | --- |
| Understanding `request`, supported scope | Exact 17-case schedule; 15 predeclared comparable cases (90 observations per arm), with both non-comparable arms retained as explicit `not_measurable`; paired/interleaved live-model observations, stable primary and D0 sensitivity | V2 accuracy ≥ V1 on identical comparable cases, Cycle-F per-axis gate remains green, zero critical regressions |
| Understanding `request`, original D0 scope | Original digest and 64-case comparable denominator only | Contextual program benchmark: Cycle C/D0 delta/range/improvement rules; `not_measurable` while V2 lacks that population, never credited toward or required for scoped internal activation |
| Other Understanding axes | Same cases where V1 emits a comparable value | No regression on comparable axes; V2-only axes are reported, not credited as wins |
| Decision / ActionResult | Cases with explicit expected result plus required read or offline execution receipt | Exact expected result and zero critical regressions; no 3-point aggregate rule |
| V1 Decision comparison | Only turns where the V1 observation seam emits a concrete comparable outcome | Descriptive until a pre-measurement denominator is available; absence cannot be declared a V2 win |
| Prose | Blind pairs with the frozen four-question rubric | V2 is at least V1 through calibrated human review or a replacement instrument that first passes calibration |
| Shadow component cost and latency | Understanding, decision and composition only, with captured reads excluded from both arms | Descriptive diagnostic only; never called complete-turn evidence |
| Complete-turn cost and latency, all turns | Approved replay/Lab run with equivalent DB/read/write/outbox adapters and receipts | V2 mean cost and p95 latency are each at most V1; shadow is not comparable and `not_measurable` blocks activation |

The gate report canonicalizer rejects a criterion whose layer, population digest, denominator or
applicability differs from this table. A criterion cannot be declared inapplicable after any arm
for that run has been observed. Missing V1 comparability produces `not_measurable`, never PASS.

## Qualitative evaluation

The deterministic checks run first: unauthorized facts, price/slot expansion, subject mismatch,
success/failure inversion, response length, question count, repetition, fallback and
`no_safe_response`. Any critical safety failure blocks qualitative scoring.

The four calibrated questions remain unchanged:

- `factuallyCorrect`;
- `addressedWhatTheLeadRaised`;
- `advancedTheJourney`;
- `wouldRepeatToday`.

Human gating uses two reviewers who independently passed the existing checklist calibration.
Engine identity is removed, pair order is deterministically randomized from the frozen run digest,
and both reviewers score every eligible pair on all four booleans. No discussion or adjudication
changes the primary scores. For each dimension, V2's total positive ratings across the identical
reviewer×case denominator must be at least V1's; a tie satisfies “at least”, not “wins”. Any V2
`factuallyCorrect = false` on a critical case is a critical regression. Disagreement, ties and
per-reviewer results remain visible in the artifact. Missing ratings invalidate the pair rather
than shrinking one arm's denominator.

If a model-based replacement evaluator is attempted, its calibration result is committed before
the final comparison: at least 90% preference for deliberately degraded responses, order-flip
instability below 25%, length-win correlation below 0.3, no use of engine identity, a model family
different from the engine under evaluation, and frozen model/prompt versions. Otherwise
the runner produces a blind, randomized human-review sheet and records the qualitative gate as
`pending_human_review`; it must not infer GO from deterministic metrics alone.

## Engine selection and rollback

The V2 engine selector is separate from the existing `shadowModeEnabled`, whose meaning is
observation-only automation. The new closed values are:

```text
v1
v1_with_v2_shadow
v2_internal
```

Default is `v1`. `v2_internal` fails closed unless the tenant is explicitly marked `isTest`.
The selector dependency is constructed in the message-worker composition root, but its value is
resolved exactly once per turn and `clinicId`, after automation mode is known, with no cross-tenant
cache. The resolved value is recorded in trace metadata. Changing it back to `v1` is the immediate
rollback; V1 code, data and feature flag remain.
The existing automation policy has precedence: `disabled` and `observe` never invoke shadow or
V2 live execution; an engine selection is considered only when automation mode is `live`.

Internal live execution is not enabled merely because the selector exists. It additionally
requires an `InternalV2ActivationApproval` created only by a runtime parser over the closed,
frozen gate-report schema. The parser verifies every blocking gate, report/dataset/config digest,
the exact build commit and an explicit approval record; it stores successful snapshots in a
private registry rather than trusting a TypeScript cast. Any mismatch, unknown key, mutation or
unregistered value routes to V1 and records `activation_gate_missing`.

## Internal V2 execution

The initial Cycle-I implementation keeps real `v2_internal` routing disabled because the current
V1 handler does not expose a reusable shell for deduplication, state, durable outbox and delivery.
The selector and rollback behavior are implemented and tested fail-closed; they do not bypass the
V1 shell. Enabling live V2 requires a later, separately reviewed seam that reuses those guarantees
and a valid approval from the complete evidence below.

After that seam and all gates pass, internal/test tenants may route supported dental turns to V2.
Unsupported turns route to V1 before any V2 execution. The selector must use V2
Understanding/claims without executing a capability; once a V2 write begins, fallback to V1 for
the same turn is forbidden.

Real V2 effects remain constrained to existing production services: bookings through
`BookingService`, state through the state-machine/repository boundary, and outbound through the
durable outbox. No direct Google Calendar event or channel send is introduced. A failed V2
response after a committed effect must fail closed and request internal attention; it cannot run
V1 and duplicate the effect.

## Gates for internal activation

Activation approval exists only when all are true:

1. Cycles A–H and the H entailment property remain green.
2. Shadow records prove zero V2 side effects and zero V1/V2 contamination.
3. Corpus comparison completes with the predeclared equal-N protocol.
4. Each blocking criterion for the supported internal scope in the frozen applicability matrix
   passes. A predeclared `not_measurable` cell retains its population digest, denominator and
   rationale and cannot be counted as PASS; if that cell is blocking (including write-turn cost
   or latency), activation is blocked. The contextual original-D0 benchmark is never credited as
   a scoped PASS and no criterion may become inapplicable after measurement begins.
5. Qualitative comparison is valid and at least V1.
6. Critical safety regressions are zero.
7. Supported critical journeys cover price, availability, booking intent, write failure,
   escalation and multi-intent; unsupported journeys are enumerated.
8. Feature selection and `v2_internal → v1` rollback pass tests.
9. Minimum trace/latency/token/cost/error/fallback observability is present.
10. Focused, architecture, scheduling and complete verification are green.
11. Independent adversarial review has no blocking Critical or Important finding.

No traffic-volume or seven-day delay is required for internal/test activation. No evidence may
be claimed for an external tenant.

## Dogfooding and external boundary

After internal activation, the journey matrix records happy, boundary, failure, multi-intent,
adversarial and recovery cases. Unsupported capabilities are marked `unsupported/deferred` rather
than implemented to fill the matrix. Every discovered bug follows reproduction → RED → minimal
fix → GREEN → replay.

The first future external tenant is `external_canary_1`. It requires explicit later approval,
volume-based observation, rollback and monitoring. V1 removal, predicate cleanup, universal
default V2 and the historical seven-day external cleanup gate remain outside Cycle I.
Internal/test activation is not a promotion between environments and does not waive the approved,
signed private replay required before that future external canary.

## Verification

Implementation uses TDD and task-scoped independent review. The final gate includes:

- shadow write-boundary and contamination adversarial tests;
- comparison protocol/metric integrity and PII tests;
- composition-root/import boundary tests;
- feature flag, activation brand and rollback tests;
- supported journey E2E tests with capturing adapters;
- required agenda regressions;
- exact `npm run verify`;
- `git diff 99a852aa -- src/core` reviewed so any V1 change is a narrow observation seam only;
- final independent adversarial review.

## Deliberately outside Cycle I

- new domain capabilities for Information, Media, Objection, Discount or FollowUp;
- arbitrary free-prose renderer or probabilistic outbound without post-render validation;
- first external client activation;
- V1 removal or legacy predicate cleanup;
- a new event bus, generic observability platform, RAG or unrelated refactor;
- claiming faithful private replay without a sanitized, human-reviewed, signed dataset and
  isolated Lab database.
