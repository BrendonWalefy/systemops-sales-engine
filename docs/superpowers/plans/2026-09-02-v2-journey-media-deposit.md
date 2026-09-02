# V2 Journey, Media And Deposit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect configured treatment journeys, ordered media and the existing deposit lifecycle to the live V2 runtime with tenant isolation, durable idempotency and no V1 execution.

**Architecture:** Add one `dental-journey` capability and narrow ports over the existing state, media, reservation and deposit services. A turn-scoped delivery plan carries authorized ordered parts to the V2 outbox; the durable outbox and sender retain delivery authority and commit the exact pipeline revision only after successful delivery.

**Tech Stack:** TypeScript, Vitest, Drizzle/PostgreSQL, existing Conversation Core capability contracts, durable outbox/jobs, embedded PostgreSQL gates.

**Spec:** `docs/superpowers/specs/2026-09-02-v2-journey-media-deposit-design.md`

## Global Constraints

- V2 is the only productive conversation runtime; never call or select V1.
- Do not add schema fields or migrations for this slice.
- Reuse `treatments.pipelineSteps`, `ConversationStateMachine`, `MediaAssetRepository`, `SlotReservationService`, `BookingService`, deposit templates and Inbox review.
- The model never selects a treatment from media content and never approves a payment proof.
- Every media/state/reservation operation is bound to the claimed tenant, conversation and lead.
- A pipeline step advances only after sender delivery and an exact state compare-and-set.
- Use one Understanding call for text and zero for deterministic eligible media; at most one verbalization.
- Create at most one conversation reply outbox and one sender job per inbound turn.
- Introduce no polling, heartbeat, continuously running worker or automatic tenant activation.

---

### Task 1: Close The Journey Contracts

**Files:**
- Modify: `src/domain-packs/dental/vocabulary.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/domain-packs/dental/ports.ts`
- Modify: `src/domain-packs/dental/outcome-provenance.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Modify: `src/domain-packs/dental/understanding-prompt.ts`
- Test: `src/__tests__/DentalJourneyContract.test.ts`
- Test: `src/__tests__/DentalUnderstandingPromptContract.test.ts`

**Interfaces:**
- Produces: closed `DentalJourneyClaimPayload`, `DentalJourneyReadPort`, `DentalJourneyWritePort`, `DentalJourneyDeliveryPlan`, deposit-aware `DentalSchedulingWriteOutcome`, registered outcomes and provenance.
- Consumes: existing `DentalRequest`, `PipelineStep`, `OutboundDeliveryPart` and `PipelineAdvance` types.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(DENTAL_REQUESTS).toEqual(expect.arrayContaining([
  "start-treatment-journey",
  "continue-treatment-journey",
  "submit-journey-media",
  "submit-deposit-proof",
  "change-pending-deposit",
]));
expect(DENTAL_OUTCOME_SCHEMA).toMatchObject({
  journey_step_ready: expect.any(Object),
  journey_media_received: expect.any(Object),
  deposit_requested: expect.any(Object),
  deposit_proof_received: expect.any(Object),
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/__tests__/DentalJourneyContract.test.ts src/__tests__/DentalUnderstandingPromptContract.test.ts`

Expected: fail because the requests, ports, outcomes and capability provenance do not exist.

- [ ] **Step 3: Add exact contracts**

Define these stable shapes in `ports.ts`:

```ts
export type DentalJourneyDeliveryPlan = Readonly<{
  replyText: string;
  interleavedParts: readonly OutboundDeliveryPart[];
  pipelineAdvance: PipelineAdvance | null;
  deterministic: boolean;
}>;

export type DentalJourneyReadPort = Readonly<{
  resolveStart(serviceQuery: string): Promise<DentalJourneyResolution>;
  resolveCurrentStep(): Promise<DentalJourneyResolution>;
  resolveInboundMedia(media: Readonly<{
    messageId: string;
    mediaType: "image" | "video" | "document";
  }>): Promise<DentalJourneyMediaResolution>;
}>;

export type DentalJourneyWritePort = Readonly<{
  start(resolution: DentalJourneyResolvedStep): Promise<DentalJourneyWriteOutcome>;
  receiveMedia(resolution: DentalJourneyResolvedMedia): Promise<DentalJourneyWriteOutcome>;
  changePendingDeposit(): Promise<DentalJourneyWriteOutcome>;
  takeDeliveryPlan(): DentalJourneyDeliveryPlan | null;
}>;

export type DentalSchedulingWriteOutcome =
  | { success: true; kind: "appointment"; appointmentId: string; label: string; evidenceRef: string }
  | { success: true; kind: "deposit_requested"; reservationId: string; label: string; requestText: string; evidenceRef: string }
  | { success: false; reason: string; evidenceRef: string };
```

Register `dental-journey` in `DentalCapabilityId`; add explicit execute actions only for writes;
add outcomes with exact subject/evidence requirements. Increment the understanding prompt version
and describe only the text requests; media requests remain deterministic runtime inputs.

- [ ] **Step 4: Run GREEN and refactor names**

Run: `npm test -- src/__tests__/DentalJourneyContract.test.ts src/__tests__/DentalUnderstandingPromptContract.test.ts src/__tests__/DentalOutcomeProvenance.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/domain-packs/dental src/__tests__/DentalJourneyContract.test.ts src/__tests__/DentalUnderstandingPromptContract.test.ts src/__tests__/DentalOutcomeProvenance.test.ts
git commit -m "feat(v2): define journey and deposit contracts"
```

### Task 2: Deterministic Structured Media Understanding

**Files:**
- Create: `src/application/conversation-v2/dental-structured-media-understanding.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Test: `src/__tests__/DentalStructuredMediaUnderstanding.test.ts`
- Test: `src/__tests__/V2LiveConversationHandler.test.ts`

**Interfaces:**
- Consumes: `LiveTurnContext.inboundMessage`, `LiveTurnSnapshot.currentState`.
- Produces: `resolveDentalStructuredMediaUnderstanding(input): Understanding<DentalRequest> | null`.

- [ ] **Step 1: Write failing routing tests**

```ts
expect(resolveDentalStructuredMediaUnderstanding({
  mediaType: "image",
  state: state("awaiting_deposit_proof"),
})).toMatchObject({ request: "submit-deposit-proof" });
expect(resolveDentalStructuredMediaUnderstanding({
  mediaType: "image",
  state: state("treatment_pipeline_active"),
})).toMatchObject({ request: "submit-journey-media" });
expect(resolveDentalStructuredMediaUnderstanding({
  mediaType: "audio",
  state: state("awaiting_deposit_proof"),
})).toBeNull();
```

Also assert that an eligible structured media turn makes zero calls to the live Understanding
provider and that ordinary text still makes exactly one.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/__tests__/DentalStructuredMediaUnderstanding.test.ts src/__tests__/V2LiveConversationHandler.test.ts`

- [ ] **Step 3: Implement the pure resolver and handler selection**

Construct a complete immutable Understanding object with confidence `1`, all unused entities
`null`, all safety flags `false`, and `dialogueMove: "answers_pending"`. In the handler:

```ts
const structured = resolveDentalStructuredMediaUnderstanding({
  mediaType: context.inboundMessage.mediaType,
  state: snapshot.currentState,
});
const result = structured ?? await this.deps.understanding.understand(...);
if (!structured) understandingCalls += 1;
```

Do not use body/caption text to choose a route.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/__tests__/DentalStructuredMediaUnderstanding.test.ts src/__tests__/V2LiveConversationHandler.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/application/conversation-v2/dental-structured-media-understanding.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/__tests__/DentalStructuredMediaUnderstanding.test.ts src/__tests__/V2LiveConversationHandler.test.ts
git commit -m "feat(v2): route journey media without model inference"
```

### Task 3: Implement The Dental Journey Capability

**Files:**
- Create: `src/domain-packs/dental/journey-capability.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/domain-packs/dental/response-conversation-brief.ts`
- Test: `src/__tests__/DentalJourneyCapability.test.ts`
- Test: `src/__tests__/DentalOperationalPipeline.test.ts`

**Interfaces:**
- Consumes: `DentalJourneyReadPort`, `DentalJourneyWritePort`, closed journey claims.
- Produces: `createDentalJourneyCapability(readPort, writePort)` and one canonical `ActionResult` per decision.

- [ ] **Step 1: Write failing capability tests**

Cover exact start, active continuation, photo request, media receipt, deposit proof, change before
proof, missing/ambiguous treatment and unsupported media. Prove each write decision contains the
resolved state identity and that `execute()` rejects a mismatched receipt.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/__tests__/DentalJourneyCapability.test.ts src/__tests__/DentalOperationalPipeline.test.ts`

- [ ] **Step 3: Implement minimal capability**

Claims are exclusive to the five journey requests. `decide()` resolves through the read port and
returns `ask`, `answer`, `execute` or `escalate`; it never embeds raw URLs or provider payloads.
`execute()` calls exactly one write method for an execute decision and maps the returned evidence
to one of the registered journey/deposit outcomes.

Use `journey_step_label`, `deposit_slot_label` and `proof_status` as the only allowed public facts.
Media IDs, pipeline indexes and reservation IDs remain internal facts/evidence.

- [ ] **Step 4: Run GREEN and provenance tests**

Run: `npm test -- src/__tests__/DentalJourneyCapability.test.ts src/__tests__/DentalOperationalPipeline.test.ts src/__tests__/DentalOutcomeProvenance.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/domain-packs/dental src/__tests__/DentalJourneyCapability.test.ts src/__tests__/DentalOperationalPipeline.test.ts src/__tests__/DentalOutcomeProvenance.test.ts
git commit -m "feat(v2): decide treatment journey transitions"
```

### Task 4: Bind Existing State And Media Owners

**Files:**
- Modify: `src/application/conversation-v2/dental-live-adapters.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Modify: `src/core/conversation/ConversationStateMachine.ts`
- Test: `src/__tests__/DentalJourneyLiveAdapters.test.ts`
- Test: `src/__tests__/PipelineTurnCommit.test.ts`
- Test: `src/__tests__/V2JourneyMediaDatabase.test.ts`

**Interfaces:**
- Consumes: tenant treatments, `MediaAssetRepository.findByIds`, current state and canonical inbound message.
- Produces: `journeyRead`, `journeyWrite` and `takeDeliveryPlan()` from `createDentalLiveAdapters()`.

- [ ] **Step 1: Write RED tests for resolution and races**

Prove exact source/variant binding, ordered text-media-text delivery, general and treatment-bound
media, rejection of cross-tenant/wrong-treatment/missing media, idempotent same-journey start,
fail-closed competing journey, once semantics and exact post-delivery CAS.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/__tests__/DentalJourneyLiveAdapters.test.ts src/__tests__/PipelineTurnCommit.test.ts`

- [ ] **Step 3: Add narrow idempotent state methods**

Add methods that operate on exact current rows rather than unconditional inserts:

```ts
startTreatmentPipelineForTurn(input): Promise<{ applied: boolean; state: ConversationStateRow }>;
markPipelinePhotoReceivedForTurn(input): Promise<{ applied: boolean; state: ConversationStateRow }>;
markDepositProofReceivedForTurn(input): Promise<{ applied: boolean; state: ConversationStateRow }>;
```

Each method verifies conversation, expected state ID/type and payload tuple, inserts with
`supersedesStateId`, and treats the already-applied exact successor as idempotent success.

- [ ] **Step 4: Implement bounded media resolution and delivery plan**

Load referenced IDs once through `findByIds(clinicId, ids)`, restore configured order, validate
every row and map only image/video to `OutboundDeliveryPart`. Keep the plan in a closure scoped to
the current adapter instance; `takeDeliveryPlan()` consumes it exactly once.

- [ ] **Step 5: Run GREEN including PostgreSQL**

Run: `npm test -- src/__tests__/DentalJourneyLiveAdapters.test.ts src/__tests__/PipelineTurnCommit.test.ts`

Run: `npm run test:db:authority -- --run src/__tests__/V2JourneyMediaDatabase.test.ts` if the command accepts a file filter; otherwise run the dedicated file with the same embedded database harness.

- [ ] **Step 6: Commit**

```bash
git add src/application/conversation-v2/dental-live-adapters.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts src/core/conversation/ConversationStateMachine.ts src/__tests__/DentalJourneyLiveAdapters.test.ts src/__tests__/PipelineTurnCommit.test.ts src/__tests__/V2JourneyMediaDatabase.test.ts
git commit -m "feat(v2): bind journey state and media safely"
```

### Task 5: Persist Ordered Journey Delivery

**Files:**
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/application/jobs/conversation-outbound-payload.ts`
- Modify: `src/application/jobs/send-message-job.ts`
- Test: `src/__tests__/V2JourneyOutbound.test.ts`
- Test: `src/__tests__/SendMessageJob.test.ts`
- Test: `src/__tests__/MediaDeliveryReliability.test.ts`

**Interfaces:**
- Consumes: consumed `DentalJourneyDeliveryPlan`, live-stream authorization.
- Produces: one `ConversationOutboundPayload` with exact ordered parts and expected pipeline advance.

- [ ] **Step 1: Write RED delivery tests**

Assert one outbox/job, ordered `text -> media -> caption/text`, no verbalizer for exact configured
content, sender preflight before provider, no advance after partial failure, one exact advance after
success and no second advance on sender retry.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/__tests__/V2JourneyOutbound.test.ts src/__tests__/SendMessageJob.test.ts src/__tests__/MediaDeliveryReliability.test.ts`

- [ ] **Step 3: Build the outbox from the delivery plan**

When a deterministic delivery plan exists, use its text/parts/pipeline advance instead of model
text, set `useVoice=false`, and preserve the ordinary `live_stream_reply` authorization and
`conversation-reply:${turnId}` dedupe. Trace only part/media counts and expected indexes.

Do not apply the pipeline advance in the handler. Keep the sender's existing post-provider CAS as
the sole commit boundary.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/__tests__/V2JourneyOutbound.test.ts src/__tests__/SendMessageJob.test.ts src/__tests__/MediaDeliveryReliability.test.ts src/__tests__/WhatsAppOutboundAuthorization.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/application/conversation-v2/v2-live-conversation-handler.ts src/application/jobs/conversation-outbound-payload.ts src/application/jobs/send-message-job.ts src/__tests__/V2JourneyOutbound.test.ts src/__tests__/SendMessageJob.test.ts src/__tests__/MediaDeliveryReliability.test.ts
git commit -m "feat(v2): deliver journey content in durable order"
```

### Task 6: Make Slot Confirmation Deposit-Aware

**Files:**
- Modify: `src/application/conversation-v2/dental-live-adapters.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Test: `src/__tests__/DentalDepositScheduling.test.ts`
- Test: `src/__tests__/DepositTemplates.test.ts`
- Test: `src/__tests__/V2SchedulingLiveAdapters.test.ts`
- Test: `src/__tests__/V2SchedulingLifecycleDatabase.test.ts`

**Interfaces:**
- Consumes: exact persisted offered slot, tenant deposit config, reservation service and state machine.
- Produces: deposit-aware `bookSlot()` outcome and deterministic deposit request outbox.

- [ ] **Step 1: Write RED deposit booking tests**

Cover enabled/complete config, disabled config, incomplete config fail-closed, slot race, exact retry,
state-write failure with release, release failure with handoff, immutable treatment/value snapshot
and tenant isolation.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/__tests__/DentalDepositScheduling.test.ts src/__tests__/V2SchedulingLiveAdapters.test.ts src/__tests__/DepositTemplates.test.ts`

- [ ] **Step 3: Implement reservation and wait state**

In `bookSlot()`, branch only on structured tenant configuration. Reserve the exact offered interval,
write `awaiting_deposit_proof`, and return:

```ts
{
  success: true,
  kind: "deposit_requested",
  reservationId,
  label: offered.slot.label,
  requestText: buildDepositRequestMessage(clinic, offered.slot.label),
  evidenceRef: `deposit-state:${stateId}`,
}
```

Direct booking continues returning `kind: "appointment"`. The capability maps the two success
kinds to different outcomes. The handler uses exact `requestText` and never verbalizes Pix data.

- [ ] **Step 4: Run GREEN including PostgreSQL**

Run: `npm test -- src/__tests__/DentalDepositScheduling.test.ts src/__tests__/V2SchedulingLiveAdapters.test.ts src/__tests__/DepositTemplates.test.ts`

Run the embedded database scheduling lifecycle suite and require zero skips.

- [ ] **Step 5: Commit**

```bash
git add src/application/conversation-v2/dental-live-adapters.ts src/domain-packs/dental/capabilities.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/__tests__/DentalDepositScheduling.test.ts src/__tests__/DepositTemplates.test.ts src/__tests__/V2SchedulingLiveAdapters.test.ts src/__tests__/V2SchedulingLifecycleDatabase.test.ts
git commit -m "feat(v2): request deposits from exact slot offers"
```

### Task 7: Receive Proofs And Preserve Human Decisions

**Files:**
- Modify: `src/application/conversation-v2/dental-live-adapters.ts`
- Modify: `src/application/conversation-v2/v2-conversation-handoff.ts`
- Modify: `src/core/conversation/ConversationStateMachine.ts`
- Test: `src/__tests__/V2DepositProofLifecycle.test.ts`
- Test: `src/__tests__/DepositProofReview.test.ts`
- Test: `src/__tests__/ConfirmDepositDecision.test.ts`
- Test: `src/__tests__/DepositExpirySweep.test.ts`
- Test: `src/__tests__/V2DepositProofDatabase.test.ts`

**Interfaces:**
- Consumes: exact proof inbound message, wait state, reservation and existing operator decision/expiry services.
- Produces: idempotent `deposit_proof_received`, deterministic acknowledgement and Inbox attention/handoff.

- [ ] **Step 1: Write RED lifecycle tests**

Prove image/document acceptance, video/audio rejection, duplicate provider delivery, stale/missing
state, exact message binding, reservation extension, no appointment creation, proof-after-review
no-op, cross-tenant rejection and unchanged approve/reject/expiry behavior.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/__tests__/V2DepositProofLifecycle.test.ts src/__tests__/DepositProofReview.test.ts src/__tests__/ConfirmDepositDecision.test.ts src/__tests__/DepositExpirySweep.test.ts`

- [ ] **Step 3: Implement exact proof transition**

Use `markDepositProofReceivedForTurn()` with expected state ID and canonical inbound message ID.
Extend only the reservation stored in the state. Persist the existing Inbox attention reason without
phone, URL or proof content. Return `buildDepositProofReceivedMessage()` as the deterministic plan.

Do not call `confirmDepositDecision()` from the model path. Existing owner/UI actions remain the
only approval or rejection entry point.

- [ ] **Step 4: Run GREEN including PostgreSQL**

Run the focused files above and the embedded `V2DepositProofDatabase.test.ts` with zero skips.

- [ ] **Step 5: Commit**

```bash
git add src/application/conversation-v2/dental-live-adapters.ts src/application/conversation-v2/v2-conversation-handoff.ts src/core/conversation/ConversationStateMachine.ts src/__tests__/V2DepositProofLifecycle.test.ts src/__tests__/DepositProofReview.test.ts src/__tests__/ConfirmDepositDecision.test.ts src/__tests__/DepositExpirySweep.test.ts src/__tests__/V2DepositProofDatabase.test.ts
git commit -m "feat(v2): route deposit proofs to human review"
```

### Task 8: Parity, Replay, Performance And Delivery Gates

**Files:**
- Modify: `docs/architecture/current.md`
- Modify: `docs/architecture/v2-capability-parity.md`
- Modify: `evals/v2-only/runtime-baseline.json` only if representative measured values require a reviewed additive fixture; never loosen existing limits.
- Test: `src/__tests__/V2JourneyParity.test.ts`
- Test: `src/__tests__/V2JourneyReplay.test.ts`
- Test: `src/__tests__/WhatsAppStreamPerformance.test.ts`
- Test: `src/__tests__/DatabaseTestCommandIsolation.test.ts` only if a new database file is added to the mandatory command.
- Modify: `package.json` only if the mandatory authority database command must include new files.

**Interfaces:**
- Consumes: complete journey/deposit behavior.
- Produces: executable parity evidence, performance measurements and release-ready documentation.

- [ ] **Step 1: Add RED parity/replay cases**

Add sanitized cases for configured content/video order, required photo, one deposit request, proof
receipt and operator-confirmed booking. Assertions enter through real webhook/queues in isolated
tests, never V1 or partial prompt harnesses.

- [ ] **Step 2: Run RED then complete missing fixtures only**

Run: `npm test -- src/__tests__/V2JourneyParity.test.ts src/__tests__/V2JourneyReplay.test.ts`

- [ ] **Step 3: Measure performance and lock isolation**

Require one inbound/event/job/outbound/send job, zero duplicate effects, no idle work, one or zero
Understanding calls, at most one verbalization, p95 turn latency <= baseline * 1.25, no more than two
additional bounded round trips, and no lock held over model/provider calls.

Run: `npm run measure:v2-only-runtime -- --baseline evals/v2-only/runtime-baseline.json`

- [ ] **Step 4: Update parity and current architecture**

Mark only the implemented journey/media/deposit rows `green`; record exact owners, retry behavior
and evidence. Leave operation/automation rows unchanged.

- [ ] **Step 5: Run complete local gates on a clean commit**

```bash
npm test -- src/__tests__/DentalJourneyContract.test.ts src/__tests__/DentalStructuredMediaUnderstanding.test.ts src/__tests__/DentalJourneyCapability.test.ts src/__tests__/DentalJourneyLiveAdapters.test.ts src/__tests__/V2JourneyOutbound.test.ts src/__tests__/DentalDepositScheduling.test.ts src/__tests__/V2DepositProofLifecycle.test.ts src/__tests__/V2JourneyParity.test.ts
npm run test:db:authority
npm run db:check
npm run lint
npm run typecheck
git diff --check
```

- [ ] **Step 6: Commit evidence and docs**

```bash
git add docs/architecture/current.md docs/architecture/v2-capability-parity.md evals/v2-only/runtime-baseline.json src/__tests__/V2JourneyParity.test.ts src/__tests__/V2JourneyReplay.test.ts src/__tests__/WhatsAppStreamPerformance.test.ts src/__tests__/DatabaseTestCommandIsolation.test.ts package.json
git commit -m "test(v2): prove journey media and deposit parity"
```

- [ ] **Step 7: Exact repository verification**

With a clean tree, run `npm run verify`. In a disposable clean clone at the same HEAD, run `npm ci`
and `npm run build`; confirm tracked files remain clean and remove only the validated disposable
directory.

- [ ] **Step 8: PR and production sequence**

Push normally, open a focused PR to `develop`, wait for Verify, embedded database, Migration CI
when present, Vercel and preview comments. Merge normally when clean; open the standard
`develop -> main` release PR, repeat all checks, merge normally, and require the production
deployment SHA to be `READY`. Do not mutate tenant configuration or send a synthetic message.

