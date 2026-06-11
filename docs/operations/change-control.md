# Change Control And Deploy Safety

This project has a stable production version. Every change should be easy to review, test, deploy, and roll back.

## Golden Path

1. Update local `main`.
2. Create a branch for one focused change.
3. Implement the smallest safe version.
4. Add or update tests for the changed behavior.
5. Run local verification.
6. Push branch and validate CI/preview.
7. Merge to `main` only after approval.
8. Watch the deploy and verify the affected workflow.

## Local Verification

Run before every push and before every deploy:

```bash
npm run verify
```

This runs:

- `npm run lint`
- `npm run typecheck`
- `npm test`

For agenda/scheduling changes, also run:

```bash
npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts
```

## Branching

Use a branch for each feature or fix:

```bash
git checkout main
git pull --ff-only
git checkout -b feat/scheduling-buffer
```

Recommended prefixes:

- `feat/` for new user-facing behavior.
- `fix/` for bugs.
- `chore/` for maintenance.
- `docs/` for documentation only.

Avoid doing normal feature work directly on `main`.

## Commit Size

Prefer commits that answer one sentence:

- "Add clinic scheduling buffer column."
- "Apply post-event buffer in SlotEngine."
- "Revalidate CalendarGateway before booking."
- "Clean lint warnings."

Small commits make rollback safer. If a deploy breaks, we can revert the exact commit instead of guessing inside a package of unrelated changes.

## Deploy Strategy

Deploy one feature or tightly related group at a time.

Good to deploy together:

- migration + code that reads the new column + UI for the same setting;
- bug fix + tests for that bug;
- behavior change + copy/UI needed for that behavior.

Keep separate:

- scheduling changes and inbox UI changes;
- webhook changes and owner dashboard changes;
- database changes and cosmetic cleanup;
- AI prompt behavior and billing/reporting behavior.

## Test Requirements By Area

Scheduling and agenda:

- slot generation rules;
- timezone/date preference behavior;
- CalendarGateway conflict/revalidation behavior, including Google Calendar opt-in clinics;
- booking saga failure paths;
- migrations for any clinic scheduling setting.

WhatsApp webhooks:

- duplicate message handling;
- human takeover behavior;
- media/audio fallback paths;
- idempotency and retry-safe behavior.

For regressions observed in real WhatsApp conversations, replay the lead
messages in a controlled production-safe clinic flow before enabling the change
for production leads.

Conversation and AI:

- intent/action routing when deterministic;
- conversation state transitions;
- response composer action-result handling.

Database:

- schema and generated migration;
- repository behavior when touched;
- rollback notes if the migration is not trivially reversible.

## PR Checklist

Every PR or deploy request should answer:

- What changed?
- Why is it safe?
- What tests were run?
- Does it include a migration?
- Does it affect production lead conversations, booking, WhatsApp, or billing?
- What is the rollback plan?

## Rollback Rules

If production breaks after a deploy:

1. Stop deploying new changes.
2. Identify the commit.
3. Revert the smallest possible commit or disable the feature flag/config if available.
4. Verify production returns to normal.
5. Only then investigate a forward fix.

Do not stack unrelated fixes on top of an unstable deploy.
