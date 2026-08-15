# Agent Operating Rules

These rules are mandatory for every AI agent or human contributor working in this repository.

## Canonical Context

Before code changes, use these files as the current source of truth:

- `README.md`
- `docs/architecture/current.md`
- `docs/operations/change-control.md`

Historical prompts, handoffs, notes, or deleted roadmap files must not be treated as current requirements.

## Stable Production Rule

`main` is production. `develop` is the integration branch. Never push directly to `main` except for emergency hotfixes explicitly approved by the user.

Default workflow:

1. Create a focused branch from updated `develop`.
2. Keep the change scoped to one feature, fix, or operational concern.
3. Use small commits with clear messages.
4. Run `npm run verify` before opening a PR.
5. Push the branch and open a PR targeting `develop`.
6. Merge to `develop` after checks pass and the user approves.
7. Promote `develop` → `main` only after full validation (manual QA + CI green).

## Branch Names

Use short, descriptive branch names:

- `feat/<area>-<change>`
- `fix/<area>-<bug>`
- `chore/<area>-<maintenance>`
- `docs/<topic>`

Examples:

- `feat/scheduling-buffer`
- `fix/booking-revalidation`
- `chore/lint-cleanup`

## Commit Rules

Prefer small commits that can be reverted safely:

- Schema/migration changes in their own commit when possible.
- Core behavior changes with tests in the same commit.
- UI-only changes separate from scheduling, webhooks, or database behavior.
- Mechanical lint/doc cleanup separate from behavior changes.

Avoid large mixed commits unless the pieces must ship together.

## Required Verification

Before every push, PR, merge, or deploy, the canonical command is:

```bash
npm run verify
```

Run it exactly like that. Never wrap it in `dotenv -e .env.local` — `.env.local` carries the
production `DATABASE_URL`, and the wrapped form is what let the integration tests write to the
shared database. `npm run verify` deliberately runs with no database, so the tests that touch one
are skipped. See [`docs/operations/test-database-safety.md`](docs/operations/test-database-safety.md).

To run the database integration tests on purpose, use the separate command and its own env file:

```bash
npm run test:db   # reads .env.test.local, which must point at a Neon test branch
```

For scheduling/calendar changes, also make sure the relevant agenda tests are covered:

```bash
npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts
```

## Test Expectations

Changes must include tests when they affect:

- scheduling or Google Calendar behavior;
- WhatsApp webhook behavior;
- conversation state transitions;
- lead status changes;
- database contracts or migrations;
- AI intent/action decisions.

Do not rely on playbook text or LLM instructions to enforce business rules. Business rules must live in deterministic code and be tested.

## Sources of Truth — Where Each Type of Information Lives

Before adding a new constant, config, or rule, identify which category it fits. The rule: **if you need to change it in more than one place, the architecture is wrong.**

| Type | Canonical Owner | Access Pattern |
|------|-----------------|----------------|
| Editorial content (tone, objections, policy, playbook) | `playbook_versions` table | `resolveActiveEditorialConfig(clinicId)` |
| Clinic operational config (hours, timezone, buffer, limits) | `clinics` table | `Clinic` entity |
| Universal conversational behavior (not clinic-specific) | LLM prompt strings in `src/core/intelligence/` | Never duplicated in DB |
| Constants that *could* vary by clinic | `clinics.*` field + code fallback | `clinic.field ?? CODE_DEFAULT` |
| Time/timezone logic | `ClinicTimezone` (`src/core/scheduling/ClinicTimezone.ts`) | Always use `getTimeGreeting()`, `toLocalParts()` — never manual offsets |

**Explicit prohibitions:**

- Do not hardcode clinic-specific behavior in prompt strings (policy, hours, tone). These must come from the DB via `resolveActiveEditorialConfig` or the `Clinic` entity.
- Do not duplicate a business rule between code and an LLM prompt. If the rule is in `ClinicTimezone.ts`, the prompt must reference the value injected at runtime — not re-declare it as a string.
- Do not add a new code constant for something that should be configurable per clinic (rate limits, slot lookahead, thresholds). Add a nullable column to `clinics` with a code default instead.
- Do not use different context-window sizes in `IntentClassifier` and `ResponseComposer`. Both must use the same `.slice(-N)` value so classification and composition see the same conversation history.
- The full audit of what is and is not configurable per clinic lives in [`docs/architecture/sources-of-truth.md`](docs/architecture/sources-of-truth.md).

## Content Ownership — Cada dado tem um único dono

Every piece of information that flows through the system has exactly one owner. Adding it anywhere else creates a Frankenstein.

| What | Owner | Never put it in |
|------|-------|-----------------|
| What text to say | `ContentBlock.content` (pipeline) or LLM output | Orchestrator conditionals |
| What caption to show after a media | `ContentBlock.caption` → `ResponsePart.caption` | Orchestrator `if (voiceEnabled)` |
| When to show a caption | Presence of `caption` on the block — always shown if set | Channel-specific flags |
| Delivery format (audio/text) | `clinic.voiceResponseEnabled` in `sendReply()` | Business logic elsewhere |
| Clinic-specific behavior | `clinics` table field + code default | Hardcoded strings or prompt text |
| Prices and commercial rules | `commercialPolicy` field in `playbook_versions` | `notes`, `differentials`, treatment descriptions |
| Conversation flow triggers | `pipelineSteps` on `treatments` | `notes` inline triggers or Orchestrator conditionals |

**The rule**: if you find yourself writing `if (clinic.someFlag)` inside a content-delivery loop to change *what* is sent, the content definition is in the wrong place. Move the decision to the data (pipeline, ContentBlock, entity field) — not to the delivery layer.

Concrete example of what NOT to do:
```typescript
// ❌ Frankenstein: delivery layer deciding content based on channel flag
if (clinic.voiceResponseEnabled && mediaItem.type === "video") {
  await sendTextMessage(outboundAddress, mediaItem.title, channelConfig);
}

// ✅ Correct: content defines its own caption; delivery layer just executes
if (part.caption) {
  await sendTextMessage(outboundAddress, part.caption, channelConfig);
}
```

## Architecture Guardrails

The core rule is:

> The LLM understands and verbalizes. The system decides.

Do not regress the conversation-first scheduling architecture:

- HTTP routes in `src/app/api/` should stay thin: parse input, resolve context, call a use case or `ConversationOrchestrator`, return HTTP.
- Do not infer conversation state from message text. Use `ConversationStateMachine` and `conversation_states`.
- Do not create Google Calendar events directly outside `BookingService`.
- Do not bypass `ClinicTimezone` with manual offsets.
- Do not reintroduce global env fallbacks for clinic config. Z-API, Google Calendar, playbook, tone, hours, professionals, treatments, and clinic users live in the database.
- Do not reintroduce `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PILOT_CLINIC_ID`, global Z-API credentials, or global `GOOGLE_CALENDAR_ID`.
- New LLM behavior belongs in `src/core/intelligence/` or an isolated infrastructure adapter, with deterministic code around decisions.
- Drizzle queries should live in repositories or explicit maintenance scripts, not scattered through UI components or arbitrary routes.

## Database And Deploy Safety

- Never edit generated Drizzle migrations by hand unless explicitly correcting a broken generated migration before it has been applied anywhere.
- Any `src/infrastructure/db/schema.ts` change must include a generated migration.
- Production deploys must only happen after CI passes.
- If a migration is included, confirm the deploy order and rollback plan in the PR notes.

## If Something Goes Wrong

Stop and report:

- current branch;
- last commit hash;
- failing command and output summary;
- whether the issue is local, CI, Vercel, or production;
- safest rollback option.

Do not keep stacking unrelated fixes on top of a failing change.
