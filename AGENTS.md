# Agent Operating Rules

These rules are mandatory for every AI agent or human contributor working in this repository.

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

