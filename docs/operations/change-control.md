# Change Control And Deploy Safety

This project has a stable production version. Every change should be easy to
review, test, deploy, and roll back.

## Golden Path

1. Update local `develop`.
2. Create a branch for one focused change.
3. Implement the smallest safe version.
4. Add or update tests for the changed behavior.
5. Run local verification.
6. Push branch and validate CI/preview.
7. Merge to `develop` after approval and green checks.
8. Promote `develop` to `main` only after full validation.

`main` is production. `develop` is the integration branch. Do not push normal
feature work directly to `main`.

## Local Verification

Run before every push and before every deploy:

```bash
npm run verify
```

This runs:

- `npm run db:check`
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
git checkout develop
git pull --ff-only
git checkout -b feat/scheduling-buffer
```

Recommended prefixes:

- `feat/` for new user-facing behavior
- `fix/` for bugs
- `chore/` for maintenance
- `docs/` for documentation only

Emergency hotfixes may branch from `main`, but only with explicit approval.

## Commit Size

Prefer commits that answer one sentence:

- "Add clinic scheduling buffer column."
- "Apply post-event buffer in SlotEngine."
- "Revalidate CalendarGateway before booking."
- "Clean lint warnings."

Small commits make rollback safer. If a deploy breaks, we can revert the exact
commit instead of guessing inside a package of unrelated changes.

## Deploy Strategy

Deploy one feature or tightly related group at a time.

Good to deploy together:

- migration + code that reads the new column + UI for the same setting
- bug fix + tests for that bug
- behavior change + copy/UI needed for that behavior

Keep separate:

- scheduling changes and inbox UI changes
- webhook changes and owner dashboard changes
- database changes and cosmetic cleanup
- AI prompt behavior and billing/reporting behavior

## Test Requirements By Area

Scheduling and agenda:

- slot generation rules
- timezone/date preference behavior
- CalendarGateway conflict/revalidation behavior, including Google Calendar
  opt-in clinics
- booking saga failure paths
- migrations for any clinic scheduling setting

WhatsApp webhooks:

- duplicate message handling
- human takeover behavior
- media/audio fallback paths
- idempotency and retry-safe behavior

For regressions observed in real WhatsApp conversations, use only a sanitized,
human-reviewed and signed dataset against an isolated replay database. The
scenario must enter through the real webhook and traverse the durable queues,
V2 live handler, deterministic capability/Decision boundaries and sender capture described in
[`replay-fidelity-contract.md`](../architecture/replay-fidelity-contract.md).
Partial Understanding/verbalizer harnesses do not satisfy this gate.

Conversation and AI:

- Understanding/capability/Decision routing when deterministic
- conversation state transitions
- AuthorizedResponsePlan and ActionResult handling

Database:

- schema and generated migration
- repository behavior when touched
- rollback notes if the migration is not trivially reversible
- if the migration adds a column with a FK to `organizations`, `conversations`,
  or `leads` (or a new table that references one of those), run
  `npx dotenv -e .env.local -- npx tsx scripts/check-purge-coverage.ts`
  afterwards — it fails loudly if the new table isn't covered by the
  permanent-delete route (`/api/owner/clinics/[clinicId]/purge`). This exists
  because that route does manual per-table deletes (Postgres FKs here aren't
  all `onDelete: cascade`), and a table silently left out only surfaces as a
  500 in production the first time someone tries to purge a clinic with real
  data in that table.

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
3. Revert the smallest possible commit or disable the feature flag/config if
   available.
4. Verify production returns to normal.
5. Only then investigate a forward fix.

Do not stack unrelated fixes on top of an unstable deploy.

## V2-Only Conversation Runtime

V1 is historical reference, not a deploy target or rollback. Every live conversation requires
authority version 2, the exact tenant `live_automation_enabled` permit and the global live-outbound control explicitly open. Missing state is closed.
The sender revalidates the exact claim authority and current tenant/safety state at delivery.

For the first V2-only release, follow
[`v2-only-runtime-rollout.md`](v2-only-runtime-rollout.md): audit the live set, pause only
SystemOpsLab by compare-and-set, close the global switch, drain jobs/outbounds, deploy, prove old
workers cannot process the new flow, validate while closed, open the switch and atomically reactivate
only the Lab plus its tenant-scoped permit, then perform one real smoke. If a gate fails, close the switch, pause the Lab, preserve durable
work and correct forward. There is no V1 redeploy.

Future tenant activations are independently reviewed, tenant-scoped operations. They require clean
authority validation and monotonic compare-and-set. A deployment never changes or activates a
paused, disabled, demo, prospect or non-V2 tenant.
