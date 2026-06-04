# Agent Operating Rules

These rules are mandatory for every AI agent or human contributor working in this repository.

## Canonical Context

Before code changes, use these files as the current source of truth:

- `README.md`
- `docs/architecture/current.md`
- `docs/operations/change-control.md`

Historical prompts, handoffs, notes, or deleted roadmap files must not be treated as current requirements.

## Stable Production Rule

`main` is treated as production-ready. Do not push directly to `main` for new work unless the user explicitly asks for an emergency hotfix and accepts the risk.

Default workflow:

1. Create a focused branch from updated `main`.
2. Keep the change scoped to one feature, fix, or operational concern.
3. Use small commits with clear messages.
4. Run `npm run verify` before asking for review or deploy.
5. Push the branch and use a PR or preview deployment for validation.
6. Merge to `main` only after checks pass and the user approves.

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

Before every push, PR, merge, or deploy:

```bash
npm run verify
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
