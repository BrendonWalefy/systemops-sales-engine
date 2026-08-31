# V2 Business Capability Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for each
> slice and `superpowers:verification-before-completion` before every commit/PR.

**Goal:** Restore every useful mapped V1 business behavior as a traceable V2 capability while
reusing the application's existing services, sources of truth and UI.

**Architecture:** V1 supplies only sanitized fixtures and expected business scenarios. A
tenant-scoped turn snapshot feeds small Dental Pack capabilities. Each capability decides from
authorized reads, delegates effects to an existing application service, returns a provenance-bound
`ActionResult`, and uses the current response plan, hybrid verbalizer, validator, durable outbox and
sender preflight.

**Tech Stack:** TypeScript 5.8, Next.js 16, Vitest, Drizzle/PostgreSQL, OpenAI adapters, existing
inbox/jobs/outbox workers.

**ADR:** `docs/architecture/v2-business-capability-architecture.md`

**Roadmap:** `docs/architecture/v2-capability-parity.md`

## Global execution contract

- Work from an updated `develop` in a dedicated worktree and focused branch per slice.
- Keep V1 unreachable from production; never import V1 orchestration into a V2 composition root.
- Follow RED -> GREEN -> refactor and end each independently useful slice with a commit.
- Reuse the exact table/service edited by the existing UI; do not add `v2_*` configuration.
- Do not add schema in a capability PR unless the source-of-truth audit proves a business datum is
  missing. If schema is required, stop that slice, write a narrow spec, update `schema.ts`, and use
  `drizzle-kit generate` in a separate commit.
- Keep at most one Understanding call and one verbalization call per inbound turn.
- Never execute a business effect from model text. Every effect uses a typed Decision and an
  idempotent service operation.
- Preserve authority v2, tenant-scoped live permission, global kill switch, consent, takeover,
  observe/shadow and sender safety checks.
- Record active-work time separately from local test, CI and deploy wait. Target 2–4 hours of active
  work for a simple slice. Split a slice when it crosses domains or cannot be green in that budget.

## Standard vertical-slice loop

Every task below uses this exact loop:

1. Add one or more sanitized historical cases to the V2 fixture manifest.
2. Add a unit RED for Understanding/capability and an E2E RED for webhook-to-outbox or explicit
   terminal handoff.
3. Extend the closed request/outcome/provenance registries.
4. Add the narrow read/write port and tenant-scoped adapter.
5. Implement the smallest deterministic decision and delegate effects to the canonical service.
6. Extend response-plan rendering only for the new typed result; keep the hybrid validator intact.
7. Prove trace completeness and privacy.
8. Run focused tests, lint and typecheck; refactor only while green.
9. Commit the slice; then run exact `npm run verify` from a clean tree before push.
10. Update the parity matrix line to `green` only after CI/build and replay evidence pass.

## Phase 0 — Freeze the common capability and trace contract

**Files:**

- Modify: `src/domain-packs/dental/vocabulary.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/domain-packs/dental/outcome-provenance.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Modify: `src/core/observability/DecisionTrace.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Create: `src/application/conversation-v2/turn-trace-completeness.ts`
- Create: `src/__tests__/V2CapabilityTraceContract.test.ts`
- Create: `src/__tests__/V2TurnTraceCompleteness.test.ts`
- Modify: `src/__tests__/DecisionTracePrivacy.test.ts`

**Interfaces:**

- Define closed capability families and a registry that pairs capability ID, allowed Decision kinds
  and allowed outcome types.
- Add a completeness result with the required milestones already present in `DecisionTrace`:
  understanding, decision, action result, response plan, validation, outbox and delivery/terminal.
- Reuse current trace stages; add only allowlisted closed metadata when a real investigation cannot
  identify the responsible capability/effect.
- Keep raw messages, prompts, generated text, prices, slots and external IDs out of Decision Trace.

**RED/GREEN:**

- RED: mismatched capability/outcome provenance, missing milestone and leaked dynamic metadata.
- GREEN: every existing V2 path has a structurally valid receipt and reports its first missing stage.
- Refactor: move only registry mechanics out of `capabilities.ts`; do not alter behavior.

**Commit:** `refactor(v2): standardize capability and trace receipts`

### Slice 0B: make the trace operable from the existing Inbox

**Files:**

- Use: `src/app/api/conversations/[conversationId]/decision-trace/route.ts`
- Modify: `src/app/(clinic)/app/inbox/[conversationId]/ChatWindow.tsx`
- Create: `src/app/(clinic)/app/inbox/[conversationId]/DecisionTracePanel.tsx`
- Modify: `src/__tests__/ConversationDecisionTraceRoute.test.ts`
- Create: `src/__tests__/InboxDecisionTracePanel.test.tsx`

Add a read-only timeline that summarizes the first missing/failed milestone, capability, outcome,
fallback, outbox and delivery state. Preserve tenant scoping and owner-only rejection-evidence
metadata. Do not display raw message, generated text, prompt, phone or secrets; raw evidence reveal
remains a separate audited operation.

**Commit:** `feat(inbox): expose tenant-scoped V2 turn diagnostics`

## Phase 1 — Knowledge and reception

### Slice 1A: institutional answers

**Files:**

- Modify: `src/domain-packs/dental/vocabulary.ts`
- Create: `src/domain-packs/dental/institutional-knowledge-capability.ts`
- Modify: `src/domain-packs/dental/ports.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Create: `src/application/conversation-v2/dental-knowledge-adapters.ts`
- Modify: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Create: `src/__tests__/DentalInstitutionalKnowledgeCapability.test.ts`
- Create: `src/__tests__/V2InstitutionalKnowledgeE2E.test.ts`
- Modify: `src/__tests__/V2LiveConversationHandler.test.ts`

Read only `organizations` and the active `playbook_versions` already edited in Profile and
Playbook. Support address, hours, location, parking, social and institutional FAQ. Unknown or
missing facts ask one clarification or hand off; they never use a model guess.

**Commit:** `feat(v2): answer authorized institutional questions`

### Slice 1B: treatment knowledge and social turns

**Files:**

- Modify: `src/domain-packs/dental/explanation-capability.ts`
- Create: `src/domain-packs/dental/social-conversation-capability.ts`
- Modify: `src/application/conversation-v2/dental-knowledge-adapters.ts`
- Create: `src/__tests__/DentalTreatmentKnowledgeCapability.test.ts`
- Create: `src/__tests__/V2SocialConversation.test.ts`

Use treatment description, aliases, differentials and approved FAQ. Add acknowledgment and farewell
without state mutation. Comparison requires resolved treatment IDs and evidence for every stated
difference.

**Commit:** `feat(v2): complete reception and treatment knowledge`

## Phase 2 — Commercial policy and objections

### Slice 2A: authorized commercial facts

**Files:**

- Create: `src/domain-packs/dental/commercial-capability.ts`
- Modify: `src/domain-packs/dental/ports.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Create: `src/application/conversation-v2/dental-commercial-adapters.ts`
- Modify: `src/core/conversation/response-plan-builder.ts`
- Create: `src/__tests__/DentalCommercialCapability.test.ts`
- Create: `src/__tests__/V2CommercialPolicyE2E.test.ts`

Resolve price from treatment and active `price_campaigns`; resolve payment/installment facts from
the active playbook and organization config. Require structured quantity/scope clarification before
quoting when one price is not deterministically selectable.

**Commit:** `feat(v2): resolve authorized commercial facts`

### Slice 2B: objection handling

**Files:**

- Create: `src/domain-packs/dental/objection-capability.ts`
- Modify: `src/application/conversation-v2/dental-commercial-adapters.ts`
- Create: `src/__tests__/DentalObjectionCapability.test.ts`
- Create: `src/__tests__/V2ObjectionConversationE2E.test.ts`

Map a closed objection class to approved policy facts/options. The capability chooses the allowed
response acts; the model only phrases them. Unsupported objection, conflicting old price or missing
policy produces explicit handoff.

**Commit:** `feat(v2): handle objections from approved policy`

## Phase 3 — Complete scheduling lifecycle

### Slice 3A: alternatives and stale offers

**Files:**

- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/domain-packs/dental/ports.ts`
- Modify: `src/application/conversation-v2/dental-live-adapters.ts`
- Modify: `src/core/scheduling/BookingService.ts` only if a missing atomic use case is proven
- Create: `src/__tests__/DentalSchedulingAlternatives.test.ts`
- Create: `src/__tests__/V2SchedulingReofferE2E.test.ts`

Add reject-offer, expired slot, concurrently taken slot and alternative search. Revalidate at the
write boundary and return a typed reoffer result without recomposing confirmed effects.

**Commit:** `feat(v2): revalidate and reoffer scheduling slots`

### Slice 3B: list, cancel and reschedule

**Files:**

- Create: `src/domain-packs/dental/appointment-lifecycle-capability.ts`
- Modify: `src/domain-packs/dental/ports.ts`
- Create: `src/application/conversation-v2/dental-appointment-adapters.ts`
- Use/modify: `src/core/scheduling/BookingService.ts`
- Use/modify: `src/application/use-cases/calendar/update-appointment.ts`
- Create: `src/__tests__/DentalAppointmentLifecycleCapability.test.ts`
- Create: `src/__tests__/V2AppointmentLifecycleDatabase.test.ts`

Resolve exactly one tenant-owned appointment. Cancel and reschedule through existing services,
including CalendarGateway, follow-up cancellation and state updates. Ambiguous appointment never
mutates. Reschedule is an explicit coordinated use case with one idempotency key.

**Commit:** `feat(v2): support appointment lifecycle`

### Slice 3C: evaluation and professional selection

**Files:**

- Modify: `src/domain-packs/dental/appointment-lifecycle-capability.ts`
- Modify: `src/application/conversation-v2/dental-appointment-adapters.ts`
- Create: `src/__tests__/V2EvaluationRouting.test.ts`
- Modify: `src/__tests__/CalendarProfessionalSelection.test.ts`
- Modify: `src/__tests__/RemotePreEvaluationRouting.test.ts`
- Modify: `src/__tests__/SlotEngine.test.ts`

Honor treatment evaluation requirements and professional/calendar configuration maintained by
Treatments, Professionals and Agenda. Do not infer a professional from stale historical linkage.

**Commit:** `feat(v2): route evaluation and professional scheduling`

## Phase 4 — Treatment journey and media

### Slice 4A: deterministic pipeline state

**Files:**

- Create: `src/domain-packs/dental/treatment-journey-capability.ts`
- Create: `src/domain-packs/dental/journey-ports.ts`
- Create: `src/application/conversation-v2/dental-journey-adapters.ts`
- Use: `src/core/pipeline/PipelineMediaRouter.ts`
- Use: `src/core/pipeline/PipelineLimits.ts`
- Modify: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Create: `src/__tests__/DentalTreatmentJourneyCapability.test.ts`
- Create: `src/__tests__/V2TreatmentJourneyDatabase.test.ts`

Persist treatment ID, source pipeline, step index and step receipt in conversation state. A retry
reads the receipt and cannot advance or emit the same content twice. Disabled/missing steps fail
closed.

**Commit:** `feat(v2): execute deterministic treatment journeys`

### Slice 4B: inbound and outbound media

**Files:**

- Create: `src/domain-packs/dental/media-capability.ts`
- Modify: `src/application/conversation-v2/dental-journey-adapters.ts`
- Use: `src/core/pipeline/PipelineMediaRouter.ts`
- Create: `src/__tests__/DentalMediaCapability.test.ts`
- Create: `src/__tests__/V2MediaJourneyE2E.test.ts`

Route inbound media from canonical event metadata, never from guessed text. Outbound media must be
an allowlisted library or pipeline asset. Photo-review steps route to human where configured.

**Commit:** `feat(v2): route authorized journey media`

## Phase 5 — Deposit lifecycle

**Files:**

- Create: `src/domain-packs/dental/deposit-capability.ts`
- Create: `src/domain-packs/dental/deposit-ports.ts`
- Create: `src/application/conversation-v2/dental-deposit-adapters.ts`
- Use: `src/core/scheduling/SlotReservationService.ts`
- Use: `src/core/conversation/DepositTemplates.ts`
- Use: `src/application/conversations/deposit-proof-review.ts`
- Modify: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Create: `src/__tests__/DentalDepositCapability.test.ts`
- Create: `src/__tests__/V2DepositLifecycleDatabase.test.ts`

Cover reservation, instruction, proof receipt, human review result, expiry and requested change.
The model cannot approve proof. Reservation and state transition share an idempotent operation
identity; retry observes the existing result.

**Commit:** `feat(v2): support the audited deposit lifecycle`

## Phase 6 — Clinical operations and handoff

**Files:**

- Create: `src/domain-packs/dental/clinical-operations-capability.ts`
- Create: `src/domain-packs/dental/clinical-operations-ports.ts`
- Create: `src/application/conversation-v2/dental-clinical-operations-adapters.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Create: `src/__tests__/DentalClinicalOperationsCapability.test.ts`
- Create: `src/__tests__/V2ClinicalOperationsE2E.test.ts`

Use closed classes for urgency, existing-work problem, arrival and lateness. Emit operational
handoff/notification effects with dedupe. Never generate diagnosis, prognosis or treatment advice.

**Commit:** `feat(v2): route clinical operations safely`

## Phase 7 — Lifecycle automations on the V2 response boundary

### Slice 7A: reminder, confirmation and follow-up

**Files:**

- Modify: `src/core/conversation/automation-response-trace.ts`
- Modify: `src/app/api/cron/follow-up-dispatcher/follow-up-response.ts`
- Modify: `src/app/api/cron/follow-up-dispatcher/route.ts`
- Modify: `src/app/api/cron/appointment-reminder/reminder-response.ts`
- Modify: `src/app/api/cron/appointment-reminder/route.ts`
- Create: `src/application/conversation-v2/automation-response-planner.ts`
- Create: `src/__tests__/V2LifecycleAutomationResponse.test.ts`
- Modify: `src/__tests__/SendMessageJob.test.ts`

Convert deterministic producer output to `ActionResult` and `AuthorizedResponsePlan` before outbox.
Keep existing schedules, idempotency, consent and authorization kinds. Do not invoke Understanding
when there is no inbound text to understand.

**Commit:** `feat(v2): authorize lifecycle automation responses`

### Slice 7B: recovery, post-appointment and campaigns

**Files:**

- Modify: `src/app/api/cron/recovery-campaign/recovery-response.ts`
- Modify: `src/app/api/cron/recovery-campaign/route.ts`
- Modify: `src/app/api/cron/post-appointment-followup/route.ts`
- Modify: `src/application/conversations/enqueue-no-show-recovery.ts`
- Modify: `src/application/reactivation/dispatch-campaign.ts`
- Use: `src/core/intelligence/ReactivationMessageComposer.ts`
- Modify: `src/application/conversation-v2/automation-response-planner.ts`
- Create: `src/__tests__/V2RecoveryAndCampaignResponse.test.ts`
- Modify: `src/__tests__/OutboundSafetyGate.test.ts`
- Modify: `src/__tests__/SendMessageJob.test.ts`

Preserve audience, offer, cooldown, quiet-hour and opt-out ownership. The model may verbalize a
resolved offer but cannot choose audience, campaign, price or deadline.

**Commit:** `feat(v2): unify recovery and campaign responses`

## Phase 8 — Parity evidence and historical retirement gate

**Files:**

- Modify: `src/application/conversation-v2/decision-fixture-manifest.ts`
- Modify: `src/application/conversation-v2/corpus-comparison-runner.ts`
- Create: `src/__tests__/V2BusinessParityReplay.test.ts`
- Create: `src/__tests__/V2BusinessParityPerformance.test.ts`
- Modify: `docs/architecture/v2-capability-parity.md`
- Modify: `docs/architecture/current.md`

Build a sanitized corpus covering every matrix row, including negative, ambiguous, duplicate,
retry and cross-tenant cases. V1 expected behavior is copied into fixture labels; V1 code is not
executed. Add a source scan proving productive composition cannot import or construct V1.

Performance gates per representative inbound turn:

- Understanding calls `<= 1`; verbalization calls `<= 1`;
- jobs created `<= 1` message process and `<= 1` send per response;
- outbounds created `<= 1` per settled turn;
- no polling/heartbeat and no increase in idle query rate;
- all authority/capability reads bounded by tenant/conversation/primary keys;
- report p50/p95 turn latency, DB round trips, lock duration, input/output tokens and Neon
  compute-active time against the frozen current V2 baseline;
- fail the slice for >10% p95 latency, >10% tokens, any extra model call, table scan in ingress/claim
  or measurable idle compute increase unless a separate reviewed exception explains it.

**Commit:** `test(v2): prove business capability parity`

## Verification commands per slice

Use the exact focused files named by the slice, then:

```bash
npx eslint <changed TypeScript test and source files>
npm run typecheck
git diff --check
```

For database behavior, add the file to the repository's dedicated isolated PostgreSQL command and
run it with zero skips. Before push, commit first so the tree is clean, then run:

```bash
npm run verify
npm run build
```

For Turbopack, use a disposable clean clone with repository-local `node_modules` when the worktree
uses an external symlink. Never copy `.env.local`, `.env.test.local` or credentials. Delivery still
requires CI, migration check, Vercel preview and explicit release controls; a capability PR never
activates a tenant.

## Self-review result

- [x] Every non-obsolete row in the parity matrix maps to one phase/slice or to an explicitly
  preserved shared service.
- [x] Every family names its source of truth and existing UI owner.
- [x] No capability owns response delivery or reaches the provider.
- [x] No model output can authorize facts or effects.
- [x] Scheduling and deposit mutate only through canonical services.
- [x] Retry cannot re-run a confirmed effect or create a second outbound.
- [x] Trace locates the first missing/failed stage without recording content.
- [x] Unsupported behavior ends in clarification, handoff or another explicit terminal state.
- [x] V1 has no productive import, selection or fallback.
- [x] No deploy or migration silently activates a tenant.
- [x] Performance gates compare against the current V2 baseline.
- [x] The diagnostic UI extends the existing Inbox and consumes the existing tenant-scoped API;
  it does not introduce a parallel conversation or configuration surface.
