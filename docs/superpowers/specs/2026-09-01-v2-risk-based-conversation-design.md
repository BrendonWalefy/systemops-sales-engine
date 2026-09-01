# V2 Risk-Based Conversation Design

Date: 2026-09-01
Status: approved

## Objective

Restore the mapped business coverage and conversational quality of V1 inside the definitive V2
runtime, using the existing UI, sources of truth, services, authority, outbox and trace. Safety must
be proportional to the risk of the operation rather than implemented as repeated generic gates.

## Existing foundation

The design extends, rather than replaces, these productive contracts:

- `LiveTurnContext` and `LiveTurnSnapshot` load tenant, conversation, editorial data, history and
  state once;
- `Understanding<DentalRequest>` owns structured interpretation;
- `Capability` produces a typed `Decision`;
- canonical services own external or durable effects;
- `ActionResult<DENTAL_OUTCOME_SCHEMA>` is the effect/information receipt;
- `V2AuthorizedResponsePlan` and the current hybrid response pipeline own language authorization;
- durable outbox, V2 authorization and sender preflight own delivery;
- Decision Trace and encrypted rejection evidence own observability.

No new core contract or generic router is required.

## Functional paths

### Read-only conversation path

Requests that can be resolved without durable or external mutation use `answer`, `ask`, `offer`,
`escalate` or `close` decisions. The capability adapter returns tenant-scoped facts with evidence.
The current response pipeline may verbalize those facts once.

Initial scope:

- greeting/acknowledgment/farewell;
- institutional address, business hours, location guidance, parking and social channels;
- treatment explanation/comparison/FAQ;
- authorized price, campaign, payment and objection responses.

### Transaction path

Requests with effects use `Decision.execute`. The executor invokes the canonical application
service with a durable operation identity. Only the returned `ActionResult` is verbalized.

Scope:

- find/offer/reoffer/book/confirm/list/cancel/reschedule appointments;
- treatment journey state and allowlisted media;
- reservation and deposit proof lifecycle;
- opt-out and handoff/operational effects.

### Automation path

Proactive producers do not call Understanding. They create typed deterministic results and reuse
the authorized response/outbox/sender boundary.

Scope: reminders, confirmation prompts, follow-up, recovery, post-appointment and campaigns.

## Domain ownership

Implementation is grouped by business authority, not by utterance:

- `knowledge-capability.ts` owns institutional and treatment knowledge;
- `dental-commercial-capability.ts` owns authorized commercial reads and objection policy;
- the existing scheduling capability plus `dental-appointment-lifecycle-capability.ts` own agenda;
- `dental-journey-capability.ts` owns pipeline/media/deposit coordination;
- `dental-operations-capability.ts` owns clinical routing and handoff.

These modules consume narrow ports. Adapters bind a clinic at construction and never accept a
second clinic ID from model-derived data.

## First vertical slice: institutional knowledge

The first slice proves the read-only path without schema or worker changes.

### Understanding contract

Add one request, `business-information`, and one closed entity,
`businessInformationTopic`, with values:

- `address`;
- `business-hours`;
- `location-guidance`;
- `parking`;
- `social`.

This avoids one intent per phrase while preserving a closed business vocabulary. The model must
select `other` when no listed topic applies.

### Read port

`DentalKnowledgeReadPort.resolveBusinessInformation(topic)` returns:

```ts
type DentalBusinessInformationResolution =
  | Readonly<{
      kind: "resolved";
      topic: DentalBusinessInformationTopic;
      organization: Readonly<{ id: string; displayName: string }>;
      facts: readonly DentalBusinessInformationFact[];
      evidenceRef: string;
    }>
  | Readonly<{
      kind: "missing";
      topic: DentalBusinessInformationTopic;
      evidenceRef: string;
    }>;
```

Facts use closed keys (`address`, `business_hours`, `location_guidance`, `parking`, `social`) and
display text already present in the claimed organization/editorial snapshot. They do not parse or
copy historical V1 prompt text.

### Decision and outcome

`dental-knowledge` claims only `business-information` with a valid topic. Resolved data produces
`Decision.answer`; missing data produces one clarification/handoff-safe question. The outcome
`business_information_answered` uses `information_authorized`, requires an organization subject and
read evidence.

No write port exists. A regression must prove the slice cannot produce `Decision.execute`.

### Source precedence

- address: `Organization.address`, with `addressComplement` appended when present;
- business hours: `Organization.businessHours`;
- location guidance: `Organization.locationMessage`, then address; `mapsUrl` is deferred until the
  response surface has an explicit authorized-link value;
- parking and social: active `EditorialConfig` structured/published content only when their
  canonical fields are resolved by the existing editorial owner; absence is `missing`.

The first implementation must not mine arbitrary prose for parking or social data. If the current
editorial contract does not expose an authoritative structured value, those two topics remain
`missing` and receive a later source-of-truth slice.

## Response policy

The existing deterministic composer and verbalizer are reused. For institutional display text:

- every fact is tied to the organization subject and read evidence;
- money, arbitrary digits, links and promises remain subject to current validator policy;
- maps/social URLs can be emitted only when represented as an explicitly authorized value by the
  response surface; the first slice may omit URL delivery rather than weaken link validation;
- rejected verbalization uses the deterministic rendering of the same fact once;
- there is no model retry.

## Trace and privacy

The current stages remain canonical. A successful first-slice turn must contain:

- `v2.understanding` with request `business-information`;
- `v2.decision` with capability `dental-knowledge` and kind `answer` or `ask`;
- `v2.action_result` with outcome `business_information_answered` or
  `clarification_required` and zero completed effects;
- response plan and validation stages;
- outbox and delivery stages when a reply is created.

No institutional value, address, URL, message or response text may enter Decision Trace.

## Safety invariants

- Productive runtime remains V2-only.
- Live execution still requires exact tenant permission and authority version 2.
- Cross-tenant data can never be passed into or returned from a knowledge adapter.
- A missing fact is never guessed.
- The read path creates no business mutation before outbox creation.
- Duplicate ingress and retries reuse existing durable authority/dedupe behavior.
- Sender safety, takeover, consent, shadow/observe and global kill switch remain unchanged.
- Live requires the exact tenant to be active, explicitly live-enabled and at
  `conversation_authority.version >= 2`; paused, disabled, demo, prospect and pre-v2 tenants stay
  fail-closed and are never activated by deployment.
- Sender delivery revalidates the global kill switch, exact stream/generation/inbound/claim tuple,
  authority v2, operational status, auto-reply, tenant live permission, shadow/observe, takeover,
  consent/opt-out and safety gates. Missing or stale state blocks delivery without a V1 fallback.
- Existing durable retry budgets remain three claims for a new process job and ten for a send job.
  Retry reuses authority, dedupe and completed effects; exhaustion yields one safe authorized reply
  or explicit handoff/terminal delivery state, never an unbounded loop.

## Quality gates

Each slice includes:

- capability unit cases for every topic, missing data and invalid claim;
- Understanding schema/provider tests for varied Portuguese phrasing;
- adapter tenant-binding tests;
- live handler tests proving one Understanding call, at most one verbalization and zero effects;
- trace privacy tests;
- sanitized conversation fixtures measuring factual correctness and whether the answer addressed the
  request;
- unchanged job/outbox cardinality and no database polling.

Each slice also reruns the frozen V1/V2 measurement and compares V2-only against
`evals/v2-only/runtime-baseline.json`: model calls cannot increase; p50/p95 latency stays within
+10% and +100 ms/+250 ms; mean/p95 tokens within +10%/+15%; statements p95 within +10%, round
trips within +2 and lock p95 within +10%/+5 ms; event/job/outbox cardinality is unchanged; and two
idle observation windows gain no SQL wakes while compute-active grows no more than 5%. The institutional
slice is stricter: because it reads the loaded organization snapshot, it adds zero query, lock,
job or outbound beyond the normal single-reply path.

## Rollout boundary

Capability PRs do not activate tenants. Future tenant activation is an exact-ID compare-and-set
after validation and old-worker/outbound drain. The global kill switch plus handoff and forward fix
is the first-cut rollback; V1 is never a rollback. A previously proven V2-only release may be
redeployed only after such a release exists. The operational sequence is owned by
`docs/operations/v2-only-runtime-rollout.md`.

Changes to prompt constraints are allowed only after a reproduced case fails an eval. The default
response should be natural and concise, not a scripted menu.

The historical V1 observation snapshot is not expanded to manufacture institutional reads that V1
never captured. Its captured adapter exposes the new port as unavailable, so a historical turn
classified as `business-information` is explicitly `shared_read_unavailable`, never evaluated with
guessed data. Institutional quality cases use sanitized V2-native fixtures and the productive V2
trace. This keeps V1 historical while preserving honest replay semantics.

## Delivery sequence

1. institutional knowledge;
2. remaining knowledge and social turns;
3. commercial and objections;
4. scheduling lifecycle;
5. journey/media/deposit;
6. operations and automations;
7. Inbox trace summary and final parity corpus.

Each sequence item receives its own plan and reviewable PR. No PR activates another tenant or
changes production data.

## Non-goals

- no microservices, broker, multi-agent supervisor, DSL or rule engine;
- no new database schema in the first slice;
- no duplicate V2 UI/configuration;
- no V1 runtime import;
- no claim of eliminating every possible language-model hallucination;
- no weakening of irreversible-effect or sender boundaries.
