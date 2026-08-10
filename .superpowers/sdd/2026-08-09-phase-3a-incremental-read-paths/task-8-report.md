# Task 8 report — incremental read paths handoff

## Scope and commit context

- Branch: `feat/incremental-read-paths`.
- Merge base with `develop`: `8882416`.
- Evidence head at the time of writing: `76e7db1`. Superseded by the final
  fix wave; see `final-fix-report.md` for the current head and evidence.
- Plan: `docs/superpowers/plans/2026-08-09-phase-3a-incremental-read-paths.md`.
- Implements Phase 3A of `docs/superpowers/specs/2026-08-09-systemops-rebuild-design.md` §12.

Task 8 changed no production code. It adds this report and corrects
`docs/operations/performance-baseline.md`.

## What this branch actually does

The clinic Inbox paid a cost proportional to total accumulated history and to
the number of idle open tabs. Three separate cost centres caused that, and
each is removed independently.

> **Corrected after the final whole-branch review.** Four claims below were
> wrong or incomplete; each correction is marked inline. See
> `final-fix-report.md` in this directory for what changed.

| Cost centre | Before | After |
| --- | --- | --- |
| Inbox base query | Every conversation for the clinic, no `limit` | Page of at most 40 rows, selected by `inArray` over ids chosen in JavaScript |
| Enrichment | 5 queries fed `inArray` with the full conversation id list | Bounded to the page's ids |
| Poll | 4 aggregations every 5 s per open tab | 1 indexed row read, 15 s → 60 s ladder |
| Forced refresh | Full `router.refresh()` every 60 s regardless of change | Only on a version change, on returning to a tab hidden longer than 60 s, or after 4 consecutive unchanged 60 s polls |
| Conversation history | Full message history | Newest 60, reverse incremental |
| Index | None on `(organization_id, last_message_at)` | Composite, matching the `ORDER BY` on both keys |

**Correction 1 — what "page of 40" actually means.** The row above said
"Keyset page of 40". The keyset predicate in `list-conversations.ts` is real
and tested, but **no production caller passes a cursor**: `page.tsx` bounds
the page with `inArray` over ids that `loadInboxSegmentIndex` returned from a
clinic-wide scan and that JavaScript sliced. The keyset is dormant code. What
ships is: clinic-wide narrow scan → tab's ordered id list → slice → `inArray`
fetch of at most 40 full rows.

**Correction 2 — the continuation now exists.** As shipped for review, that
slice took the first 40 ids and there was no way to reach row 41: `nextCursor`
had been removed from the page (correctly — a clinic-wide keyset cannot resume
a *tab's* list) and nothing replaced it. A clinic with 137 live conversations
displayed "137" and rendered 40. This is fixed: a `page` param travels in the
URL beside `scope`/`tab`/`q`, `inbox-page-window.ts` slices the tab's complete
id list, and the footer offers "Carregar mais antigas". Each step still fetches
at most `INBOX_PAGE_SIZE` rows — the page is paged, not accumulated.

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

- content-ready telemetry — `d2e065e..37f1b0a`, plus `fe13e6b` (navigation-relative timing and `app_first_open`)
- read index — `fa279be`, plus `fb49696` (nulls placement alignment)
- keyset pagination — `66b788a` (dormant: no production caller passes a cursor)
- bounded page and server-side tab segmentation — `82568bc..2c3f55e`, plus `ba2de03` (the continuation)
- read version model — `3327d7b`
- cheap poll and bump coverage — `b306cd4..ac2fa83`, plus `d6099a5` (writers the sweep missed) and `c0251b6` (staleness ceiling and `visibilitychange`)
- tenant scoping of the single-conversation Inbox actions — `6ac7f46`
- conversation history pagination — `76e7db1`
- documentation — `e0eaa42`, `c1b3595`, `d3364e2`, `676478d`, `d563444`, this commit, and the final fix wave's report commit

Two of the final-wave commits are **not** safe to revert on their own:
`6ac7f46` closes a cross-tenant write, and `d6099a5` is what makes the
`stuck-conversation-sweep` cron have any visible effect at all.

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

Task 1 made three previously `not_measurable` targets measurable, on paper.
It is now two. Measurable is not measured.

**Correction 6 — two of those three were not measurable as shipped for
review, and one of the two still is not.** `createFirstOpenSample` had **zero
production callers** while `docs/operations/performance-baseline.md` mapped
"First application open" to it, and `content_ready` reported
`Math.round(performance.now())` — elapsed time since the document's
`timeOrigin`, not since the navigation that produced the content, so a
conversation opened 45 s into a session reported ~45,000 ms against an 800 ms
target. `content_ready` is fixed in the final fix wave: it now measures from
the navigation mark. The final fix wave also wired `app_first_open` from the
same reporter, on the discriminator "first `ContentReadyReporter` mount in
this document" — but that discriminator cannot tell a genuine cold start from
a soft navigation into an instrumented surface (Inbox, a conversation) from a
page that carries no reporter of its own, such as the Dashboard. Both look
identical to the reporter, so it reported the elapsed session time — tens of
seconds for a Dashboard read before the click — as a false first-open sample.
That emission was reverted in a follow-up fix; see the "Untrustworthy
`app_first_open` emitter reverted" addendum in `final-fix-report.md`.
`app_first_open` is `not_measurable` again, and a correct first-open
discriminator is deliberately out of scope for this phase. The claim in this
section stands unchanged in substance — measurable is still not measured, and
no cohort has been collected.

First-open readiness remains unmeasurable end to end: no reporter mounted anywhere in this branch can tell a cold start apart from a soft navigation into an instrumented surface from an un-instrumented one, so none may emit `app_first_open` without lying about what it measured.

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
`conversations_org_last_message_idx` for the paginated query. Index *choice*
is a planner decision that needs `EXPLAIN ANALYZE` against representative
data. Until that is run, the index is a reasonable expectation, not a
demonstrated one.

**Correction 3 — the `ORDER BY` did not match the index.** This section
originally claimed the ordering matched "by construction and by rendered-SQL
assertion". That was true of the **first** key only. The index is
`(organization_id, last_message_at DESC NULLS LAST, id DESC NULLS LAST)`, and
the query's second key was `desc(conversations.id)` — plain `desc()`, which
Postgres reads as `DESC NULLS FIRST`. The pathkeys differed on that key, so
the planner could not satisfy the full ordering from the index and had to add
a Sort. The rendered-SQL assertion in `ListClinicConversations.test.ts` pinned
the mismatched form rather than catching it, and `InboxReadIndex.test.ts`
asserted column names and order but neither direction nor nulls placement.
Both queries now emit `id desc nulls last` and both tests assert direction and
nulls placement. `conversations.id` is NOT NULL, so no result changed.

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
`src/infrastructure`. The model is now only as complete as that sweep. Any new
write path that changes what the Inbox shows must bump, and there is no
mechanism that enforces it.

**Correction 4 — the sweep was not complete, and this section claimed it
was.** The original text said "every candidate was checked for a real
production caller". `src/app/api/cron/stuck-conversation-sweep/route.ts` was
missed: it runs every 5 minutes in production, sets `needsAttention` and
`attentionReason`, and had no bump — so the "Atenção" badge never updated and
the conversation never entered the tab, which is the entire purpose of that
cron. Two more of the same class were found sweeping again:
`(admin)/inbox/[conversationId]/actions.ts` writing `leads.status`, and
`DrizzleHumanReviewRequestRepository.createPending`/`applyDecision`, which
move a row into and out of the "Pendências" tab. All three now bump.

**Correction 5 — a whole class of staleness has no write to signal.** This
section framed the risk purely as "a missed category of *write*". Some Inbox
transitions involve **no write at all** and therefore can never change a
bump-driven version:

- `isRecoveryCandidate` turns true once `hoursWaiting >= 2`;
- a `conversationStates.expiresAt` passing removes a row from "Pendências";
- a `humanReviewRequests.expiresAt` passing does the same;
- `appointments.endsAt` passing reclassifies an appointment as past;
- `hoursWaiting` is computed at render, so "aguardando há 1h" freezes.

The removed unconditional 60-second refresh was what covered these. They
self-heal on the next write anywhere in the clinic, so a busy clinic barely
notices and a quiet one froze without bound. The poller now has a ceiling —
one forced refresh after 4 consecutive unchanged 60 s polls, worst case 285 s
from mount and 240 s in steady state — plus a `visibilitychange` listener that
polls immediately on return and forces a refresh when the tab was hidden
longer than the top rung.

## Untested code on this branch

- `src/application/calendar/import-calendar-events.ts`'s suite is `DATABASE_URL`-gated and did not run in this environment, so its bump site is untested here. Pre-existing gating, not introduced by this branch.
- `ConversationRepository.setAiPaused` and `setTakeover` carry bumps but have **zero production callers**. They are harmless and do not constitute coverage; the real pause and takeover writers are covered separately.

## Deferred observations for the final review to triage

From the ledger, across all tasks:

1. `ContentReadyReporterComponent.test.ts` relies on exactly two microtask hops to flush the fetch.
2. ~~`MemoryStorage` is duplicated verbatim between two test files.~~ **Resolved** in the final fix wave — one helper in `src/__tests__/helpers/memory-storage.ts`.
3. ~~`InboxReadIndex.test.ts` asserts index column name and order but not sort direction or nulls placement; a regression flipping `.desc()` to `.asc()` would pass while breaking the keyset contract.~~ **Resolved** in the final fix wave, and it was not hypothetical: see correction 3 above.
4. No test asserts `nextCursor` at exactly `limit` rows or at zero rows.
5. `decodeInboxCursor` does not validate that `id` is UUID-shaped, so a corrupted cursor reaches Postgres as a type error rather than resetting to page one.
6. `router.push` defaults to `scroll: true`, so every tab click jumps the list to the top; pending feedback is only `opacity: 0.6` with the previously-active pill still highlighted.
7. A no-op navigation fires for the current non-sales scope pill, re-running the full scan for no change.
8. Typing into search while a tab navigation is still pending can schedule a debounce closure over the stale scope/tab and navigate back to the pre-click tab.
9. Search runs the clinic-wide scan twice when `q` is present — once unfiltered for counts, once filtered for the page.
10. `ilike` search does not escape user-supplied `%` and `_`; matches the existing convention in `src/app/api/leads/search/route.ts`.
11. A search matching nothing renders an empty tab with no "no results" messaging.
12. The `clinic_read_versions` table-shape test checks column names only, not `bigint` type/mode or the `default(0)`.
13. ~~`pauseAi`, `resumeAi`, `clearAttention` and `setConversationCategory` update by conversation id alone with no session-clinic comparison.~~ **Resolved** in the final fix wave. Not merely a missing comparison: these are `"use server"` actions taking a client-supplied id, so an operator of clinic A could pause clinic B's AI, and the stray call bumped clinic B's read version. The clinic predicate is now in the `where`.
14. Fire-and-forget bumps issued immediately before returning a serverless response rely on an unawaited promise completing after the response. Prescribed by the plan, but this branch moved mark-as-read onto it.
15. `get-inbox-snapshot-signature.ts` appears to have no remaining callers, and `page.tsx` selects `organizations.updatedAt` without reading it — leftovers from the derived-version design. Still open after the final fix wave.
16. ~~No `visibilitychange` listener, so returning to a backgrounded tab waits up to the full current rung.~~ **Resolved** in the final fix wave; see correction 5 above.
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
