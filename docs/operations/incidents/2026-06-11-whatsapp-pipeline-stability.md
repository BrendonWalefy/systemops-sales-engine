# Incident Handoff - WhatsApp Pipeline Stability

Date: 2026-06-11
Branch: `fix/whatsapp-incident-stability`
Status: diagnosis complete, implementation not started yet
Owner context: clinic operation degraded for about 2 weeks; AI was manually paused by clinic owner due to poor replies, delayed replies, duplicated behavior and context failures.

## Goal

Restore safe WhatsApp operation for production clinics with the smallest reversible sequence of fixes, while leaving a clear trail so another agent can continue without rediscovering the incident.

## Canonical Context Reviewed

Before preparing this incident plan, the current source of truth was re-read:

- `README.md`
- `docs/architecture/current.md`
- `docs/operations/change-control.md`

## Current Checkpoint

- Branch already created: `fix/whatsapp-incident-stability`
- No implementation changes were applied yet on this branch
- `update_plan` already created for the incident execution sequence
- This document is the authoritative handoff for the next clean session

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

## How To Resume In The Next Session

1. Read this document first
2. Confirm branch is still `fix/whatsapp-incident-stability`
3. Re-open the files listed in "Key Code Findings"
4. Start with Phase 1, not with architecture redesign
5. After each phase:
   - run the focused tests for the touched area
   - then run `npm run verify`
   - update this incident document with what was changed and what remains

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

- branch: `fix/whatsapp-incident-stability`
- implementation status: not started
- incident diagnosis: completed
- next action: start Phase 1 containment changes
