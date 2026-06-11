# Incident Handoff - WhatsApp Pipeline Stability

Date: 2026-06-11
Branch: `main` (Phase 4 continuation executed from clean `main` at `4dbf92e`; original hotfix branch was `fix/whatsapp-incident-stability`)
Status: Phases 1, 2, 3 and 4 validated locally; ready for controlled BW/live monitoring before broader re-enable
Owner context: clinic operation degraded for about 2 weeks; AI was manually paused by clinic owner due to poor replies, delayed replies, duplicated behavior and context failures.

## Goal

Restore safe WhatsApp operation for production clinics with the smallest reversible sequence of fixes, while leaving a clear trail so another agent can continue without rediscovering the incident.

## Canonical Context Reviewed

Before preparing this incident plan, the current source of truth was re-read:

- `README.md`
- `docs/architecture/current.md`
- `docs/operations/change-control.md`

## Current Checkpoint

- Original implementation branch was `fix/whatsapp-incident-stability`; Phase 4 continuation in this session was executed from clean `main`
- `main` checkpoint used for this continuation: `4dbf92e`
- Local replay evidence now exists for the three confirmed BW loops:
  - internal attention alert suppression
  - duplicate video follow-up suppression
  - interleaved text/video echo suppression once the outbound row exists with the provider `externalId`
- Incident document should still be updated after each new validation pass or deploy checkpoint
- This document remains the authoritative handoff for the next clean session

## Phase Log

### Phase 1 - Webhook containment

Status: implemented locally on 2026-06-11

Changes applied:

- added `isInternalOperationalWhatsAppMessage()` in `src/core/whatsapp/InternalWhatsAppOperationalMessage.ts`
- added normalized phone equivalence helper in `src/core/whatsapp/WhatsAppContactIdentity.ts` so `5511...` and `(11) ...` match safely
- moved clinic resolution + clinic config fetch earlier in `src/app/api/whatsapp/zapi/route.ts`
- blocked internal operational messages before they enter either the `fromMe` branch or the lead pipeline
- current operational filters cover:
  - attention alerts containing `precisa de voce` + `Acesse o Inbox para responder`
  - media-forward context containing `Responda neste chat` + `sera encaminhada automaticamente ao lead`

Why this is safe:

- it only blocks text when both conditions are true:
  - sender phone matches the clinic receptionist phone after normalization/equivalence
  - the body matches known operational message patterns sent by the system itself
- real operator takeover messages from the receptionist number still pass through if they do not match those internal templates

Local validation completed:

- `npm test -- src/__tests__/InternalWhatsAppOperationalMessage.test.ts src/__tests__/ZApiWebhook.test.ts`
- `npx eslint src/app/api/whatsapp/zapi/route.ts src/core/whatsapp/InternalWhatsAppOperationalMessage.ts src/core/whatsapp/WhatsAppContactIdentity.ts src/__tests__/InternalWhatsAppOperationalMessage.test.ts`
- `npx tsc --noEmit`

Files touched in Phase 1:

- `src/app/api/whatsapp/zapi/route.ts`
- `src/core/whatsapp/InternalWhatsAppOperationalMessage.ts`
- `src/core/whatsapp/WhatsAppContactIdentity.ts`
- `src/__tests__/InternalWhatsAppOperationalMessage.test.ts`

Next exact action:

- start Phase 2 follow-up lifecycle control in:
  - `src/domain/repositories/follow-up-repository.ts`
  - `src/infrastructure/repositories/drizzle-follow-up-repository.ts`
  - `src/application/use-cases/leads/schedule-follow-up.ts`
  - `src/app/api/cron/follow-up-dispatcher/route.ts`

### Phase 2 - Follow-up lifecycle control

Status: implemented locally on 2026-06-11

Changes applied:

- added `cancelPendingByReason()` to the follow-up repository contract
- implemented cancellation + ordered due listing in `DrizzleFollowUpRepository`
- updated the in-memory repository to keep parity with the contract
- changed `scheduleFollowUp()` to replace an older pending record for the same `lead + reason` instead of silently keeping backlog
- added `selectOneFollowUpPerLead()` so the dispatcher handles at most one due follow-up per lead per run
- after a successful send, the dispatcher now cancels deferred duplicate `video_sent:*` follow-ups for the same lead in that run

Why this is safe:

- no schema change or migration was needed
- the replacement behavior preserves history by cancelling old pending rows instead of deleting them
- the dispatcher cap is run-local and deterministic: it reduces burst risk without rewriting the larger cron architecture
- duplicate video follow-ups are only cancelled after one successful outbound follow-up for that lead in the same run

Local validation completed:

- `npm test -- src/__tests__/StaleConversations.test.ts src/__tests__/FollowUpReengagement.test.ts src/__tests__/FollowUpClaimBeforeSend.test.ts src/__tests__/FollowUpDispatchPolicy.test.ts src/__tests__/UpdateAppointment.test.ts`
- `npm run verify`

Files touched in Phase 2:

- `src/domain/repositories/follow-up-repository.ts`
- `src/infrastructure/repositories/drizzle-follow-up-repository.ts`
- `src/infrastructure/repositories/in-memory-demo-repositories.ts`
- `src/application/use-cases/leads/schedule-follow-up.ts`
- `src/application/use-cases/leads/follow-up-dispatch-policy.ts`
- `src/app/api/cron/follow-up-dispatcher/route.ts`
- `src/__tests__/FollowUpReengagement.test.ts`
- `src/__tests__/FollowUpDispatchPolicy.test.ts`
- `src/__tests__/UpdateAppointment.test.ts`
- `src/__tests__/StaleConversations.test.ts`

Next exact action:

- start Phase 3 exact outbound persistence in `src/core/pipeline/ConversationOrchestrator.ts`

### Phase 3 - Exact outbound persistence for echo defense

Status: implemented locally on 2026-06-11

Changes applied:

- added `buildInitialAgentMessage()` and `buildAgentMessageFromOutboundPart()` in `src/core/pipeline/outbound-message-persistence.ts`
- in interleaved deliveries, the initial persisted agent message now matches the first real outbound part instead of the combined `replyText`
- media outbound rows now persist:
  - exact `body = part.title`
  - `mediaUrl`
  - `mediaType`
  - `externalId` from the provider when available
- extended `OutboundDeliveryService` so media callbacks know when the first actual outbound part is a media item
- updated `ConversationOrchestrator` to patch the pre-saved first row when the first sent part is text or media, instead of leaving a non-deduplicable placeholder

Why this is safe:

- it keeps the existing "persist before send" protection for inbox visibility
- it does not change routing, intent selection, or scheduling behavior
- it narrows the stored outbound message shape so it resembles the provider echo more closely, which improves deterministic suppression at the webhook boundary
- media rows now carry richer structured data for the inbox instead of a synthetic emoji-prefixed text body

Local validation completed:

- `npm test -- src/__tests__/OutboundMessagePersistence.test.ts src/__tests__/OutboundDeliveryOrdering.test.ts src/__tests__/InternalWhatsAppOperationalMessage.test.ts src/__tests__/ZApiWebhook.test.ts src/__tests__/FollowUpDispatchPolicy.test.ts src/__tests__/FollowUpReengagement.test.ts`
- `npx tsc --noEmit`
- `npx eslint src/core/pipeline/ConversationOrchestrator.ts src/core/pipeline/outbound-message-persistence.ts src/infrastructure/adapters/channels/whatsapp/outbound-delivery-service.ts src/__tests__/OutboundMessagePersistence.test.ts`
- `npm run verify`

Files touched in Phase 3:

- `src/core/pipeline/ConversationOrchestrator.ts`
- `src/core/pipeline/outbound-message-persistence.ts`
- `src/infrastructure/adapters/channels/whatsapp/outbound-delivery-service.ts`
- `src/__tests__/OutboundMessagePersistence.test.ts`

Next exact action:

- start Phase 4 replay validation against the BW patterns already captured in this document
- specifically re-run QA route scenarios for:
  - internal attention alert suppression
  - duplicate video follow-up suppression
  - echo suppression for interleaved text/video outbound parts

### Phase 4 - Replay validation

Status: completed locally on 2026-06-11 from `main` at `4dbf92e`

Changes applied:

- added `scripts/bw-incident-phase4-replay.ts` to codify the three BW incident loops against the local webhook and cron routes
- added `npm run bw:incident-replay` so the replay can be repeated without reconstructing the setup
- executed the replay with local app running under `DISABLE_REAL_WHATSAPP_SEND=true` to avoid real outbound WhatsApp sends during validation

Replay scenarios executed:

- internal attention alert suppression:
  - posts the known `precisa de voce` / `Acesse o Inbox para responder` pattern from the BW receptionist number
  - verifies no BW lead, conversation or message is created
- duplicate video follow-up suppression:
  - seeds two due `video_sent:*` follow-ups for the same BW QA lead
  - runs `GET /api/cron/follow-up-dispatcher`
  - verifies one follow-up becomes `done`, the deferred duplicate becomes `cancelled`, and only one agent message is persisted
- reengagement cancels pending follow-up:
  - seeds one pending `video_sent:*` follow-up for the BW QA lead
  - replays a fresh inbound from the same lead before the follow-up is due
  - verifies the pending row becomes `cancelled` before cron dispatch and no new follow-up message is sent afterward
- interleaved echo suppression:
  - seeds exact outbound-like agent rows for a text part and a video title part, each with provider `externalId`
  - replays matching webhook payloads and verifies no extra lead/operator messages are created and the conversation stays unpaused

Local validation completed:

- `npm test -- src/__tests__/InternalWhatsAppOperationalMessage.test.ts src/__tests__/ZApiWebhook.test.ts src/__tests__/FollowUpDispatchPolicy.test.ts src/__tests__/FollowUpReengagement.test.ts src/__tests__/FollowUpClaimBeforeSend.test.ts src/__tests__/OutboundMessagePersistence.test.ts src/__tests__/OutboundDeliveryOrdering.test.ts`
- `npm run bw:incident-replay`
- `npm run verify`

Replay result:

- `16/16` checks passed in `npm run bw:incident-replay`
- full suite remained green: `569` tests passed under `npm run verify`

Why this is safe:

- the replay exercises the real local route handlers instead of helper-only logic
- it uses the BW QA phone and clinic ids already documented for incident reproduction
- outbound send is disabled during the replay, so verification does not contact real leads

Residual risk that still needs production monitoring:

- the replay validates the deterministic suppression path once the outbound part row already exists with the matching `externalId`
- it does **not** eliminate the narrower pre-commit race window where a provider echo could arrive before the part row is persisted; this still needs 48h BW monitoring after deploy

Next exact action:

- deploy the contained fix set in a controlled rollout
- keep BW on close watch for 48h using the self-conversation / duplicate follow-up queries from the stabilization program
- only then broaden production re-enable

### Follow-up after Phase 4 - Clinic kill switch for automated outbound

Status: implemented locally on 2026-06-11 after the replay pass

Changes applied:

- added `shouldSendAutomatedClinicOutbound()` in `src/application/automation/clinic-automation-policy.ts`
- `src/app/api/cron/follow-up-dispatcher/route.ts` now stops before dispatch when `clinic.autoReplyEnabled = false`
- `src/app/api/cron/appointment-reminder/route.ts` now follows the same fail-safe behavior

Why this is safe:

- it matches the operational expectation that "desligar a IA" must also stop automated outbound
- it prevents surprise follow-ups/reminders from leaving the system while the clinic believes automation is paused
- it is reversible and centralized behind one small policy helper

Local validation completed:

- `npm test -- src/__tests__/ClinicAutomationPolicy.test.ts src/__tests__/FollowUpReengagement.test.ts src/__tests__/AppointmentReminder.test.ts`
- `npm run bw:stability -- 48`
- `npm run verify`

Assumption taken in this pass:

- reminder D-1 was treated as part of automated outbound and therefore respects the same clinic kill switch
- if the product later wants reminders to remain active while conversational AI is paused, split that into a dedicated clinic flag instead of bypassing `autoReplyEnabled` ad hoc

Operational support added:

- `npm run bw:stability -- 48` now consolidates the BW post-deploy checks for:
  - health da clínica (`autoReplyEnabled`, última inbound/outbound)
  - auto-conversa por match exato
  - auto-conversa por prefixo
  - flood de follow-up

### Follow-up after Phase 4 - Cancelamento de pendentes no reengajamento/agendamento

Status: implemented locally on 2026-06-11 after commit `b7e2c5a`

Changes applied:

- added `cancelPendingByLead()` to the follow-up repository contract and implementations
- inbound lead registration now cancels pending follow-ups as soon as the lead reengages
- booking flows now cancel stale pending follow-ups before leaving the lead as `appointment_scheduled`
- `updateAppointment()` now cancels pending follow-ups when an appointment is moved back into `scheduled`/`confirmed`

Why this is safe:

- the rule is deterministic and centralized around real lead activity, not prompt text
- follow-up history is preserved by marking rows as `cancelled`, not deleting them
- the new booking behavior cancels stale pending rows first and then schedules the fresh long-tail return follow-up, so the post-consultation reminder still exists

Local validation completed:

- `npm test -- src/__tests__/RegisterIncomingMessageRace.test.ts src/__tests__/InternalBookingSaga.test.ts src/__tests__/UpdateAppointment.test.ts src/__tests__/FollowUpReengagement.test.ts`
- `npm run verify`

## Confirmed Production Findings

### 1. BW Odontologia shows self-conversation / echo loop

Confirmed in production message history on 2026-06-10 and 2026-06-11:

- Agent message returns 0.2s to 4s later as a `lead` message in the same conversation
- The AI then answers its own previous outbound content
- This happened with:
  - media titles
  - long text bodies
  - follow-up messages

Concrete examples were confirmed in conversation `c09d2898-c2e0-499b-b3ea-8fae92e9501c`.

### 2. Follow-up flood is real

Confirmed on BW on 2026-06-10 around 07:01 local time:

- 14 agent follow-ups were dispatched in about 50 seconds
- the same lead received repeated video-related follow-ups
- those follow-ups were later re-ingested as lead traffic because of the echo problem

Root cause pattern:

- video follow-ups are scheduled repeatedly
- the uniqueness key includes `dueAt`, so repeated resets/tests do not collide
- dispatcher has no cap of one follow-up per lead per run

### 3. Internal attention alerts entered the lead pipeline

Confirmed on BW:

- `clinic.receptionistPhone = 5511940617713`
- the same number appears as the lead contact in conversation `35d949a5-e9b2-4b39-bb66-d435914e50b5`
- alert text like `Fulano precisa de voce` was ingested as if it were a lead message
- AI answered the internal alert with greeting/menu text

This must be blocked at the webhook boundary.

### 4. Fixed debounce of 3s is too short for real WhatsApp bursts

Confirmed on BW test conversations:

- `Oi` then `Boa noite` 6 seconds later still produced duplicated greeting behavior
- price-related back-to-back questions 4 seconds apart produced near-duplicate replies

The current fixed debounce does not match real typing bursts.

### 5. Ximendes is effectively in manual/human mode

Confirmed in production:

- no messages on local dates 2026-06-10 and 2026-06-11
- last active messages on 2026-06-09 were mostly `clinic_user`
- recent Ximendes conversations show AI paused or human takeover behavior

This does not prove provider failure by itself, but it does confirm the clinic is not operating normally through AI right now.

## Key Code Findings

### Webhook route

File: `src/app/api/whatsapp/zapi/route.ts`

- Route already returns `200` quickly and uses `after(...)`
- It is not a fully durable inbox; work still depends on the same invocation lifecycle
- Audio transcription still happens inline before `after(...)`
- `fromMe` logic still relies on:
  - `externalId` dedupe
  - recent exact body match in 10 seconds
  - otherwise it assumes manual operator message
- QA route can allow `fromMe` traffic to enter the lead path

### Orchestrator outbound persistence

File: `src/core/pipeline/ConversationOrchestrator.ts`

- There is a pre-saved agent message using the combined `replyText`
- In interleaved sends, the first text part is not always persisted as its own exact outbound message body with provider id
- media persistence currently stores bodies like `🎥 titulo` and can leave `externalId = null`
- this mismatches the echo payload, which can come back as plain title text or a different part-level body

This is the strongest current explanation for the self-conversation loop.

### Follow-up repository and dispatcher

Files:

- `src/domain/repositories/follow-up-repository.ts`
- `src/infrastructure/repositories/drizzle-follow-up-repository.ts`
- `src/application/use-cases/leads/schedule-follow-up.ts`
- `src/app/api/cron/follow-up-dispatcher/route.ts`

Confirmed behavior:

- `scheduleFollowUp()` skips only if it finds an exact pending by `leadId + reason`
- repository uniqueness still includes `dueAt`
- dispatcher sends every due item without per-lead cap
- stale `sending` recovery exists, which is good

## Recommended Implementation Order

### Phase 1 - Containment at webhook boundary

Goal: stop the most harmful false inbounds immediately.

Changes:

- ignore internal attention alert texts before they can enter lead processing
- ignore inbound traffic whose normalized contact matches `clinic.receptionistPhone` when it is clearly an internal operational message
- keep manual operator takeover behavior intact for real operator messages

Files likely involved:

- `src/app/api/whatsapp/zapi/route.ts`
- `src/core/whatsapp/WhatsAppContactIdentity.ts`

### Phase 2 - Follow-up lifecycle control

Goal: stop repeated follow-up accumulation and burst dispatching.

Changes:

- replace existing pending follow-up for the same `lead + reason` instead of silently leaving old pending records
- add repository method to cancel pending records for a lead/reason
- cap dispatcher to one outbound follow-up per lead per run
- optionally cancel extra same-run video follow-ups for the same lead

Files likely involved:

- `src/domain/repositories/follow-up-repository.ts`
- `src/infrastructure/repositories/drizzle-follow-up-repository.ts`
- `src/application/use-cases/leads/schedule-follow-up.ts`
- `src/app/api/cron/follow-up-dispatcher/route.ts`

### Phase 3 - Exact outbound persistence for echo defense

Goal: make outbound messages structurally deduplicable when Z-API echoes them back.

Changes:

- persist exact first text part content in interleaved delivery
- persist `externalId` for media/title rows too
- ensure stored outbound body matches what may come back from the provider closely enough for deterministic echo suppression

Primary file:

- `src/core/pipeline/ConversationOrchestrator.ts`

### Phase 4 - Tests and replay validation

Goal: verify the incident fixes against the actual failure modes.

Need tests for:

- internal alert ignored by webhook
- follow-up replacement or cancellation behavior
- dispatcher cap of one follow-up per lead
- outbound echo persistence behavior

Also replay recent BW WhatsApp patterns through QA route before re-enabling clinic automation broadly.

## Non-goals for the first incident pass

These can come after stabilization:

- full inbox/outbox durable architecture
- queue/messaging migration
- adaptive debounce redesign
- SLA dashboard and operator health panel
- deep redesign of response quality and editorial behavior

Those are valid next steps, but the first incident pass should restore stability with minimal blast radius.

## Architecture Direction After Incident

Once the clinic is stable again, the next architecture step should be:

1. durable inbound inbox table
2. explicit processing status and replay
3. outbound table with provider message ids per part
4. asynchronous worker or queue transport
5. health/lag visibility per clinic

That future direction is already aligned with:

- `docs/architecture/target-architecture.md`
- `docs/architecture/aws-target-architecture.md`

## Known Risks

- Over-blocking `fromMe` or internal numbers could hide legitimate operator behavior if the filter is too broad
- Follow-up suppression must not break genuine reengagement journeys
- Outbound persistence changes can affect existing tests around message ordering and UI rendering
- QA-route replay does not cover the tiny race window before an outbound part row is committed with `externalId`

## How To Resume In The Next Session

1. Read this document first
2. Confirm whether you are continuing from `main` after `4dbf92e` or from a later deploy/monitoring checkpoint
3. Re-open the files listed in "Key Code Findings"
4. Continue from BW deploy/monitoring, not from architecture redesign
5. After each phase:
   - run the focused tests for the touched area
   - then run `npm run verify`
   - update this incident document with what was changed and what remains

Suggested resume prompt for a clean Codex session:

`Continue from docs/operations/incidents/2026-06-11-whatsapp-pipeline-stability.md on main after commit 4dbf92e and continue with BW rollout monitoring after Phase 4 replay validation.`

## Evidence Snapshot

Production evidence already confirmed during this diagnosis:

- BW clinic id: `5a2ce07d-cfa1-4108-9a3c-3d1fae017067`
- BW receptionist phone: `5511940617713`
- Ximendes clinic id: `c9137774-e783-4461-ac2b-e2f01be739a6`
- BW self-conversation examples in conversation:
  - `c09d2898-c2e0-499b-b3ea-8fae92e9501c`
- BW internal-alert loop conversation:
  - `35d949a5-e9b2-4b39-bb66-d435914e50b5`
- BW greeting burst sample conversation:
  - `7b909d8b-f6e8-4cb4-9fe4-d78f3ed0310a`

## Last Verified Repository State

- branch: `main`
- repository commit for this continuation: `4dbf92e`
- implementation status:
  - Phase 1 complete locally
  - Phase 2 complete locally
  - Phase 3 complete locally
  - Phase 4 complete locally
- incident diagnosis: completed
- next action: controlled deploy + 48h BW monitoring before re-enabling broader production automation
