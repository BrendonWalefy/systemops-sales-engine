# V2 Journey, Media And Deposit Design

Date: 2026-09-02
Status: approved execution slice of the V2 capability roadmap

## Goal

Complete the live V2 path for treatment journeys, configured media and deposits without copying
the V1 orchestrator. The V2 interprets the turn, a dental capability selects the operation, and the
existing tenant-scoped state, reservation, media, Inbox and booking services remain the only owners
of business effects.

## Scope

This slice covers:

- starting and continuing a treatment `pipelineSteps` journey;
- delivering configured text, image and video blocks in their declared order;
- requesting and receiving a required journey photo;
- advancing a journey only after its outbound is delivered;
- creating a provisional slot reservation and deterministic Pix instructions;
- receiving a proof image or document and exposing it to the existing human review flow;
- preserving the existing operator approve, reject and expiry services.

It does not add a workflow engine, a new UI, a second state model, provider-specific rules in the
domain pack, model-based proof validation or a V1 fallback.

## Existing Owners

| Concern | Canonical owner |
| --- | --- |
| Journey definition and ordered content | `treatments.pipelineSteps` |
| Journey state and compare-and-set advancement | `ConversationStateMachine` |
| Media metadata and tenant binding | `MediaAssetRepository` / `media_assets` |
| Slot exclusion and provisional hold | `SlotReservationService` |
| Deposit configuration and Pix facts | `organizations` financial fields |
| Deposit copy | `DepositTemplates` |
| Proof state and review | `ConversationStateMachine`, Inbox `DepositBanner`, `confirmDepositDecision` |
| Final booking and calendar effects | `BookingService` |
| Durable delivery and post-delivery journey commit | outbox, `message.send`, sender |

No field or migration is needed: every source of truth and every durable state required by this
slice already exists.

## Architecture

`dental-journey` is one capability module for the related journey authority. It does not send and
does not query PostgreSQL directly. Its ports expose the current tenant-bound journey, a bounded
step resolver, idempotent state operations and deposit operations. `createDentalLiveAdapters()`
implements those ports with the existing repositories and services.

```text
inbound + exact stream claim
  -> LiveTurnContext + state snapshot
  -> deterministic media event OR one Understanding call
  -> dental-journey Decision
  -> existing state/reservation service
  -> ActionResult + turn-scoped DeliveryPlan
  -> AuthorizedResponsePlan / deterministic deposit copy
  -> one durable outbox containing ordered parts + expected state tuple
  -> sender preflight
  -> provider delivery
  -> compare-and-set journey advance
```

The turn-scoped `DentalJourneyDeliveryPlan` is not an authority and performs no write. It carries
only already-authorized delivery parts and the exact expected pipeline tuple from capability
execution to outbox construction. The outbox is the durable copy. A crash before outbox can safely
recompute the plan from unchanged state; a crash after outbox cannot recompute or duplicate it
because the stream-scoped reply dedupe owns the turn.

## Closed Requests And Structured Media

The dental vocabulary adds these requests:

- `start-treatment-journey` with the canonical service entity;
- `continue-treatment-journey` while a journey state is active;
- `submit-journey-media` for image/video in a photo-capable journey step;
- `submit-deposit-proof` for image/document while awaiting a proof;
- `change-pending-deposit` when the lead asks to change or cancel before proof review.

Provider media type is trusted as ingress metadata, not inferred by the model. Before invoking the
Understanding model, the handler maps an eligible media/state pair to a complete registered
`Understanding` value. Text turns still use exactly one Understanding call. Unsupported media
does not become a business effect: it produces a bounded handoff or acknowledgement according to
the current state.

The deterministic override is limited to the exact persisted states
`treatment_pipeline_active` and `awaiting_deposit_proof`; it cannot select a treatment from a
caption or media body.

## Journey State Machine

```text
no journey
  -- start exact configured treatment --> active(step=N, photoReceived=false)

active(content)
  -- outbound delivered + exact tuple --> active(next step) | idle

active(qa)
  -- direct business request ----------> answer by its owning capability; journey unchanged
  -- continue request -----------------> increment bounded QA count or advance

active(photo)
  -- no valid media --------------------> remain active; request configured photo
  -- tenant-bound image/video ----------> photoReceived=true + human review/handoff

active(ask_availability/offer_slots/book)
  -- scheduling request ----------------> scheduling capability; journey exits by exact CAS
```

Starting is idempotent. An existing active state for the same canonical treatment and selected
variant is reused; a different active journey fails closed instead of being overwritten. Every
advance carries `expectedTreatmentId` and `expectedStepIndex`. Only the sender applies it after all
ordered delivery parts succeed. A retry cannot advance twice because the state tuple no longer
matches.

`once !== false` content is skipped when canonical outbound history proves its media IDs or exact
content were already delivered. Resolution is bounded by one pipeline and one tenant media batch.
Missing, cross-treatment, unsupported or duplicate media references fail before outbox creation.

## Deposit State Machine

```text
persisted slot offer
  -- exact slot selected, deposit disabled --> BookingService (existing path)
  -- exact slot selected, deposit enabled --> reserve slot + awaiting_deposit_proof

awaiting_deposit_proof
  -- text says paid, no attachment -------> deterministic request for attachment
  -- change/cancel request ---------------> release hold + invalidate state, then reschedule path
  -- tenant-bound image/document ---------> deposit_proof_received + Inbox attention

deposit_proof_received
  -- operator approves -------------------> existing confirmDepositDecision + BookingService
  -- operator rejects --------------------> existing release + handoff
  -- lead requests change ---------------> handoff; no automatic money-affecting change

awaiting_deposit_proof expired
  -- existing expiry service ------------> release + deterministic expiry outbound
```

The scheduling write outcome becomes a closed union: a successful direct booking, a successful
deposit request or a failure. Deposit creation reserves first and writes the wait state with the
same slot, treatment and immutable price snapshot. It is idempotent for the exact conversation,
slot and lead: a retry reuses the live reservation/state and never creates a second hold.

Pix amount, recipient and key are deterministic facts from the claimed organization. They are not
passed to the verbalizer. The exact `buildDepositRequestMessage()` output is placed in the outbox.
The model never confirms payment and never sees authority to approve a proof.

## Inbound Proof And Human Review

An inbound proof is accepted only when:

- the current unexpired state is `awaiting_deposit_proof`;
- media type is `image` or `document`;
- the canonical inbound message belongs to the same conversation and tenant;
- the held reservation still matches the state;
- no proof has already consumed the state.

The transition is compare-and-set/idempotent. It records the canonical inbound message ID,
extends the existing hold using the tenant's `depositTtlHours`, and marks the conversation for the
current Inbox review only after the acknowledgement is delivered. The lead receives the
deterministic proof-received acknowledgement. No appointment or payment confirmation is created.
A duplicate provider delivery is absorbed by inbound and reply dedupe and cannot produce another
state transition.

## Response And Delivery

Journey steps can produce an ordered `interleavedParts` list. Text comes only from configured
`ContentBlock.content`; media comes only from a tenant-scoped `media_assets` row whose treatment is
the canonical treatment, selected variant or general (`treatment_id IS NULL`). Captions belong to
the `ContentBlock`, not the sender.

The normal authorized response plan still records the journey outcome and evidence. The handler
persists the sidecar delivery plan in the same `live_stream_reply` outbox as the textual response.
For an exact configured content step, the outbox uses the configured parts as the complete reply;
it does not ask the verbalizer to rewrite editorial blocks. For a deposit instruction or proof
acknowledgement, the deterministic template is the complete reply. Other journey outcomes may use
the normal V2 verbalizer within the existing validator.

Sender preflight remains unchanged and revalidates authority V2, exact claim, tenant live state,
takeover, consent, safety and the global kill switch. Pipeline commit happens only after provider
delivery. Partial media delivery retains the same outbox/job and retry cursor behavior already
owned by the sender; it never creates a new conversational response.

The persisted reply payload may carry one closed `postDeliveryControl`: proof acknowledgement
requests Inbox attention, while a journey-photo acknowledgement requests handoff. The sender
applies it only after the provider result and terminal outbox state are durable, using the exact
clinic, conversation and lead tuple. Unknown control kinds, reasons or fields fail payload
validation; retry only reconciles the same terminal delivery and never resends it.

## Failure And Retry Policy

- Unknown/ambiguous treatment: ask once; no state or media write.
- Missing or invalid configured media: fail closed, persist handoff, no partial outbox.
- State CAS loss: return stale outcome; do not send a step for the wrong revision.
- Reservation conflict: report the slot as unavailable through scheduling; no deposit state.
- Reservation succeeds but state write fails: release the exact reservation; if release is
  indeterminate, require handoff and do not claim success.
- State/deposit effect succeeds but outbox fails: existing V2 terminal policy requires handoff;
  retry reuses the exact durable state and dedupe.
- Proof acknowledgement outbox failure: proof remains auditable and human-visible; handoff is
  required, never proof rollback or automatic approval.
- Sender exhausts its existing ten attempts: outbound becomes terminal `dead`; no new response is
  composed.

## Isolation, Idempotency And Performance

Every read and write includes the claimed `clinicId` directly or reaches a conversation/lead
already verified against it. Media IDs are never looked up globally. A pipeline source/variant
relationship is validated before content or proof effects. Cross-tenant rows produce no state,
reservation, outbox or disclosure.

The live path adds no polling, heartbeat, worker or table scan. Per turn it allows:

- one bounded current-state read already present in the snapshot;
- at most one tenant treatment/media batch read for a journey step;
- one state CAS for start, proof or post-delivery advance;
- one reservation operation only when an exact offered slot is selected;
- one outbound and one sender job per inbound turn.

Performance gates use the existing V2 baseline. Compared with the ordinary V2 response, the
journey path must keep one Understanding call or zero for deterministic media, at most one
verbalization, one outbound/job, no idle database activity, p95 turn latency within +25%, at most
two additional bounded round trips for media/state resolution, and no lock held across a model or
provider call.

## Trace And Audit

Decision Trace records metadata only:

- closed request and `dental-journey` capability;
- outcome and exact evidence reference;
- pipeline action, expected step and part/media counts;
- deposit transition (`requested`, `proof_received`, `handoff`) and reservation result;
- outbox/job dedupe result and sender pipeline-commit result.

It never stores message content, phone, Pix key, proof URL, media URL or payload. Canonical messages
and existing business rows remain the authorized detailed audit surfaces.

## Tests And Rollout

Tests cover start, ordered content/media, once semantics, post-delivery advance, photo routing,
deposit request, proof receipt, operator approval/rejection/expiry compatibility, duplicate retry,
state race and cross-tenant rejection. An embedded PostgreSQL path proves persisted state,
reservation, outbox and sender commit with zero skips. Replay fixtures cover one complete content
journey and one deposit journey without calling V1.

The release changes no tenant configuration and activates no tenant. It follows the normal focused
PR to `develop`, release PR to `main`, production `READY` verification and metadata-only health
check. Rollback closes the global live-outbound switch if live delivery is unsafe, then reverts or
corrects forward; it never routes a turn to V1.
