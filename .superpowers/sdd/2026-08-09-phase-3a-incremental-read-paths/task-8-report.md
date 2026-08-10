# Task 8 report — incremental read paths handoff

## Scope and commit context

- Branch: `feat/incremental-read-paths`.
- Merge base with `develop`: `8882416`.
- Evidence head: `76e7db1`, working tree clean.
- Plan: `docs/superpowers/plans/2026-08-09-phase-3a-incremental-read-paths.md`.
- Implements Phase 3A of `docs/superpowers/specs/2026-08-09-systemops-rebuild-design.md` §12.

Task 8 changed no production code. It adds this report and corrects
`docs/operations/performance-baseline.md`.

## What this branch actually does

The clinic Inbox paid a cost proportional to total accumulated history and to
the number of idle open tabs. Three separate cost centres caused that, and
each is removed independently.

| Cost centre | Before | After |
| --- | --- | --- |
| Inbox base query | Every conversation for the clinic, no `limit` | Keyset page of 40 |
| Enrichment | 5 queries fed `inArray` with the full conversation id list | Bounded to the page's ids |
| Poll | 4 aggregations every 5 s per open tab | 1 indexed row read, 15 s → 60 s ladder |
| Forced refresh | Full `router.refresh()` every 60 s regardless of change | Removed |
| Conversation history | Full message history | Newest 60, reverse incremental |
| Index | None on `(organization_id, last_message_at)` | Composite, matching the keyset |

## Command evidence

All commands run at `76e7db1` on a clean tree.

| Command | Exit | Exact result |
| --- | ---: | --- |
| `npm run verify` | 0 | 257 test files passed; 2,337 passed; 10 skipped (2,347 total). Covers `db:check`, `lint`, `typecheck`, `vitest`. |
| `npm run build` | 0 | Production Next.js build succeeded; `/app/inbox` and `/app/inbox/[conversationId]` both compile. |
| `git diff --check origin/develop...HEAD` | 0 | No whitespace errors. |
| `git diff --name-only origin/develop...HEAD -- src/infrastructure/db/schema.ts drizzle migrations` | 0 | `drizzle/0095_luxuriant_shocker.sql`, `drizzle/0096_little_ezekiel.sql`, `drizzle/0097_ambitious_lockheed.sql`, `drizzle/meta/_journal.json`, `src/infrastructure/db/schema.ts`. |

The production build is reported here deliberately: `npm run verify` does
**not** run `next build`, so no earlier task on this branch had build-verified
its route-file changes, and Task 4b altered `page.tsx`'s export surface. It
passes.

## Migrations and deploy risk

Three, in order:

1. **`0095_luxuriant_shocker.sql`** — `CREATE INDEX conversations_org_last_message_idx ON conversations (organization_id, last_message_at DESC NULLS LAST, id DESC NULLS LAST)`. A plain `CREATE INDEX` takes a **write lock on `conversations` for the build duration**. Sub-second at current volumes. A future clinic large enough to make that lock felt would need this re-issued as `CREATE INDEX CONCURRENTLY`, outside the migration runner.
2. **`0096_little_ezekiel.sql`** — `CREATE TABLE clinic_read_versions`, primary key `(organization_id, resource)`, plus its FK to `organizations`.
3. **`0097_ambitious_lockheed.sql`** — drops and recreates that FK with `ON DELETE cascade`. Required: nothing ever deletes a `clinic_read_versions` row, so with the original `no action` any clinic that had ever received a message could no longer be deleted or purged.

None of the three is destructive. There is no data migration and no rollback of
database state beyond dropping what these create.

## Rollback

Independent, revertible ranges per cost centre:

- content-ready telemetry — `d2e065e..37f1b0a`
- read index — `fa279be`
- keyset pagination — `66b788a`
- bounded page and server-side tab segmentation — `82568bc..2c3f55e`
- read version model — `3327d7b`
- cheap poll and bump coverage — `b306cd4..ac2fa83`
- conversation history pagination — `76e7db1`
- documentation — `e0eaa42`, `c1b3595`, `d3364e2`, `676478d`, `d563444`, and this commit

Reverting the poll range without also reverting `0096`/`0097` is safe: the
table simply stops being read.

## No conversational behaviour changed

Nothing in this branch touches intent classification, response planning,
validation, the composer, pipelines or the outbox. The only writes added are
fire-and-forget invalidation bumps, which cannot fail their caller.

---

# What was NOT proven

This section exists because the branch's value is easy to overstate. Every
claim below is a limitation, not a caveat to be skimmed.

## Unit and integration green is not Lab green

```text
unit/integration green != approved private replay green != Lab validation green
```

This branch reaches **only the first level**. No approved private replay
dataset was run. No DB-backed Lab validation was run. Nothing here authorises
a customer or production operation.

## No performance target is proven met

`docs/operations/performance-baseline.md` requires **16 cohorts** collected in
preview/Lab. This branch collected **none**.

Improvement is expected by construction — a bounded page instead of the whole
clinic, one indexed row read instead of four aggregations, no unconditional
refresh — but it is **not measured**. No target in that document may be
described as met on the strength of this branch.

Task 1 made three previously `not_measurable` targets measurable. Measurable
is not measured.

## The Inbox is not fully sublinear

`loadInboxSegmentIndex` still issues **six clinic-wide queries per page load
and per tab click**. Tab clicks are now server navigations, so this cost is
paid on each one.

What is bounded is the expensive half: the full 17-column rows, the five
enrichment queries, and message bodies. The narrow scan deliberately excludes
message bodies, lead names, phones, profile pictures and summaries, so its
per-row payload is small — but it is still linear in conversation count.

Replacing it with a true materialised read model is Phase 3B work. Do not
describe the Inbox as "no longer scanning the clinic".

## Two user-visible ordering changes, both intentional

1. Conversations with **no messages** moved from the top of the Inbox to the bottom. The previous `ORDER BY` was a bare `DESC`, which in Postgres means `NULLS FIRST`; the keyset requires `NULLS LAST` to match the index.
2. The list now orders by **when the lead last wrote**, not by last activity from anyone. `conversations.lastMessageAt` is bumped only for lead messages (`drizzle-conversation-repository.ts`), so a conversation where only the assistant replied recently now sorts lower.

The second was a correctness fix, not a preference: the page was being
*selected* by one key and *displayed* by another, so a conversation could be
excluded from the fetched page while appearing to belong at the top.

Both are worth a look in the running app before this reaches a clinic.

## Index choice is unverified

Nothing here proves Postgres actually selects
`conversations_org_last_message_idx` for the paginated query. The `ORDER BY`
matches the index by construction and by rendered-SQL assertion, but index
*choice* is a planner decision that needs `EXPLAIN ANALYZE` against
representative data. Until that is run, the index is a reasonable expectation,
not a demonstrated one.

## The invalidation model changed its failure mode

This is the most important limitation to carry forward.

The old version was **derived** from the data — `COUNT` and `MAX` over three
tables — so it self-healed. A write that nobody remembered to signal still
changed the number.

The new version is **bump-driven**. A missed *instance* degrades to the
ladder's 60-second ceiling. A missed *category* means the version never
changes for that class of write and the Inbox never refreshes for it at all —
permanent staleness, not a delay.

Coverage was swept across `src/app`, `src/application` and
`src/infrastructure`, and every candidate was checked for a real production
caller. The model is now only as complete as that sweep. Any new write path
that changes what the Inbox shows must bump, and there is no mechanism that
enforces it.

## Untested code on this branch

- `src/application/calendar/import-calendar-events.ts`'s suite is `DATABASE_URL`-gated and did not run in this environment, so its bump site is untested here. Pre-existing gating, not introduced by this branch.
- `ConversationRepository.setAiPaused` and `setTakeover` carry bumps but have **zero production callers**. They are harmless and do not constitute coverage; the real pause and takeover writers are covered separately.

## Deferred observations for the final review to triage

From the ledger, across all tasks:

1. `ContentReadyReporterComponent.test.ts` relies on exactly two microtask hops to flush the fetch.
2. `MemoryStorage` is duplicated verbatim between two test files.
3. `InboxReadIndex.test.ts` asserts index column name and order but not sort direction or nulls placement; a regression flipping `.desc()` to `.asc()` would pass while breaking the keyset contract.
4. No test asserts `nextCursor` at exactly `limit` rows or at zero rows.
5. `decodeInboxCursor` does not validate that `id` is UUID-shaped, so a corrupted cursor reaches Postgres as a type error rather than resetting to page one.
6. `router.push` defaults to `scroll: true`, so every tab click jumps the list to the top; pending feedback is only `opacity: 0.6` with the previously-active pill still highlighted.
7. A no-op navigation fires for the current non-sales scope pill, re-running the full scan for no change.
8. Typing into search while a tab navigation is still pending can schedule a debounce closure over the stale scope/tab and navigate back to the pre-click tab.
9. Search runs the clinic-wide scan twice when `q` is present — once unfiltered for counts, once filtered for the page.
10. `ilike` search does not escape user-supplied `%` and `_`; matches the existing convention in `src/app/api/leads/search/route.ts`.
11. A search matching nothing renders an empty tab with no "no results" messaging.
12. The `clinic_read_versions` table-shape test checks column names only, not `bigint` type/mode or the `default(0)`.
13. `pauseAi`, `resumeAi`, `clearAttention` and `setConversationCategory` update by conversation id alone with no session-clinic comparison. Pre-existing; the new `.returning({ clinicId })` makes the check nearly free.
14. Fire-and-forget bumps issued immediately before returning a serverless response rely on an unawaited promise completing after the response. Prescribed by the plan, but this branch moved mark-as-read onto it.
15. `get-inbox-snapshot-signature.ts` appears to have no remaining callers, and `page.tsx` selects `organizations.updatedAt` without reading it — leftovers from the derived-version design.
16. No `visibilitychange` listener, so returning to a backgrounded tab waits up to the full current rung; the immediate on-mount poll was also removed.
17. `ConversationHistoryPagination` test 3 claims to prove tenant isolation but renders only the `where` fragment; a wrong `innerJoin` predicate would pass all eight tests.
18. The conversation sidebar's "Mensagens" count renders `msgs.length` and now shows at most 60. Confirmed pre-existing — the accurate total was computed but never rendered — but user-visible.

## Plan defects found during execution

Recorded because they are the reason two tasks needed extra rounds, and
because the same mistakes are easy to repeat in Phase 3B.

1. **Task 4 assumed the enrichment queries were the only consumers of the full conversation list.** `InboxClient` also derived every tab's membership and count from it, so bounding the list silently dropped conversations out of their tabs. Task 4b was added mid-execution to fix it.
2. **Task 6's search scope omitted `src/app`**, where every operator-initiated Inbox mutation writes through `db` directly. Pause, resume, clear-attention, categorize, bulk delete, mark-as-read and the clinic auto-reply toggle were all missed on the first pass.
3. **Task 6's brief framed a missed bump as "degrades to the 60-second ladder"**, which is true only for a missed instance. That framing is what justified stopping the sweep early.

The pattern across all three: **bounding a read broke something that quietly
depended on receiving everything.** Phase 3B should treat that as the default
hypothesis rather than a surprise.

## Before any clinic sees this

- `EXPLAIN ANALYZE` the paginated query against representative data to confirm index choice.
- Collect the 16 baseline cohorts and compare against Phase 1, summing `inbox_base_query` and `inbox_segment_scan`.
- Look at the two ordering changes in the running app.
- Run `import-calendar-events.ts`'s DB-gated suite against a real branch.
- Rotate nothing, deploy nothing, and operate no paused clinic — all four clients remain paused per spec §1.
