# Final fix wave — `feat/incremental-read-paths`

Single fix wave answering the final whole-branch review. Six findings, all
addressed.

- Branch: `feat/incremental-read-paths`
- Base of this wave: `148a411` (tree clean)
- Head after this wave: `e668374` (tree clean)
- Handoff corrected: `task-8-report.md` in this directory

## Commands

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run verify` | **0** | `db:check` OK; `eslint .` clean (0 errors, 0 warnings); `tsc --noEmit` clean; **265 test files passed, 2,397 passed, 10 skipped (2,407 total)**. At `148a411` it was 257 files / 2,337 passed. |
| `npm run build` | **0** | `✓ Compiled successfully in 9.5s`. `/app/inbox`, `/app/inbox/[conversationId]` and `/api/inbox/check` all compile as dynamic routes. |
| `git diff --check 148a411..HEAD` | **0** | No whitespace errors. |

31 files changed, 2,125 insertions, 181 deletions.

## Commits

| SHA | Subject |
| --- | --- |
| `d6099a5` | fix(inbox): bump the read version on every writer the sweep missed |
| `6ac7f46` | fix(inbox): scope the four single-conversation actions by session clinic |
| `fb49696` | fix(inbox): match the ORDER BY's nulls placement to the read index |
| `c0251b6` | fix(inbox): bound staleness for transitions that have no write at all |
| `fe13e6b` | fix(observability): measure content_ready from navigation start, and emit app_first_open |
| `ba2de03` | feat(inbox): add a continuation so rows past the first 40 are reachable |
| `e668374` | docs: correct six claims in the incremental-read-paths handoff |

Grouped per cost centre so the handoff's rollback ranges stay meaningful;
`task-8-report.md`'s rollback section now lists each new SHA against the
centre it belongs to, and flags the two that must not be reverted alone
(`6ac7f46` closes a cross-tenant write; `d6099a5` is what gives the
`stuck-conversation-sweep` cron any visible effect).

---

## Finding 1 — writers with no `bumpInboxVersion`

### What changed

`src/app/api/cron/stuck-conversation-sweep/route.ts` collects
`alert.clinicId` into a `Set` inside the marking loop and bumps once per
clinic after it, matching `recovery-campaign/route.ts:330`. One bump per
execution per clinic, not one per conversation.

Sweeping again for the same class turned up two more production writers:

- `src/app/(admin)/inbox/[conversationId]/actions.ts` — `assumeConversation`
  writes `leads.status`, which decides tab membership (`won`/`lost` leave the
  live tabs). Now `.returning({ clinicId: leads.clinicId })` + bump.
- `src/infrastructure/repositories/drizzle-human-review-request-repository.ts`
  — `createPending` puts a conversation into the "Pendências" tab and
  `applyDecision` takes it out. Both now bump from the row they already
  return. Previously the only invalidation covering them was *indirect*: the
  orchestrator persisting a message afterwards. Depending on a neighbouring
  bump is the same shape of assumption that broke three times on this branch.

### TDD evidence

RED — `npx vitest run src/__tests__/StuckConversationSweepBump.test.ts`:

```
AssertionError: expected "spy" to be called with arguments: [ 'clinic-a' ]
Number of calls: 0
...
Tests  3 failed | 1 passed (4)
```

(The fourth — "não bumpa clínica nenhuma quando a varredura não marca
ninguém" — passes in both states by design; it is the guard against
over-bumping.)

RED — `npx vitest run src/__tests__/AdminAssumeConversationBump.test.ts` and
`src/__tests__/HumanReviewRequestInboxBump.test.ts`:

```
AssertionError: expected "spy" to be called once with arguments: [ 'clinic-a' ]
Number of calls: 0
...
AssertionError: expected "spy" to be called once with arguments: [ 'clinic-b' ]
Number of calls: 0
```

GREEN after the fix: `Test Files 3 passed (3)  Tests 9 passed (9)`.

---

## Finding 2 — staleness with no write to signal it

### The judgement call: N = 4 top-rung polls

`nextPollDelayMs` climbs 15 s → 30 s → 60 s and stays. I force a refresh once
the unchanged streak reaches `TOP_RUNG_INDEX + 4`, then resume the streak at
`TOP_RUNG_INDEX` rather than at zero.

**Worst case: 285 s (4 min 45 s) from mount** — 15 + 30 + 4×60 — and **240 s
(4 min) in steady state**.

Why 4 and why resume at the top rung:

- Resuming at zero would restart the ladder at 15 s and undo the whole point
  of the backoff for an idle tab, which is exactly the tab that just took a
  forced refresh. Resuming at the top rung keeps the *poll* at one indexed row
  read per minute; only the *expensive* refresh gains a frequency floor.
- 4 keeps the worst case at "a few minutes" as asked, at a cost of one
  `router.refresh()` per 4 minutes per idle visible tab. The removed behaviour
  was one per 60 s, so this is a 4× reduction in forced refreshes while
  bounding the previously unbounded case.
- The number lives in `poll-schedule.ts` as
  `TOP_RUNG_POLLS_BEFORE_FORCED_REFRESH`, and the test derives the 285 s and
  240 s figures from it by simulating the ladder rather than hardcoding them,
  so tuning it cannot silently invalidate the stated worst case.

### `visibilitychange`

While `document.hidden` the poller fetches nothing, so the streak does not
grow and the ceiling does not run. That is deliberate: staleness while nobody
is looking is not observable. What must be true is that the **first render
after returning** is fresh. So on becoming visible the poller restarts the
ladder and polls immediately instead of waiting out the current rung, and
forces a refresh outright when the tab was hidden longer than the top rung
(60 s). A quick alt-tab pays only the poll.

Each restart advances a cycle counter; a poll from a superseded cycle neither
refreshes nor reschedules. Without it, three alt-tabs would leave three loops
polling in parallel — there is a test for exactly that.

### TDD evidence

RED — `npx vitest run src/__tests__/InboxStalenessCeiling.test.ts`:

```
TypeError: (0 , shouldForceRefreshAfterUnchangedPolls) is not a function
...
Tests  6 failed (6)
```

For the component, the honest check is the reverse direction: with the fix in
place the suite is green, and restoring the pre-fix `InboxPoller.tsx`
(`git stash push src/app/(clinic)/app/inbox/InboxPoller.tsx`) turns 5 of the
9 red:

```
× mas TEM teto: depois de 4 polls seguidos no degrau de 60s sem mudança, força um refresh
× busca na hora quando a aba volta a ficar visível — sem esperar o degrau corrente vencer
× uma aba escondida por mais que o degrau de topo volta com refresh forçado
× desmontar remove o listener de visibilidade
× voltar à aba não duplica o laço de polling
Tests  5 failed | 4 passed (9)
```

Restored: `Tests 9 passed (9)`.

The pre-existing test "nunca chama router.refresh() enquanto a versão não
muda, mesmo muito além dos 60s" asserted 12 minutes of no refresh, which the
ceiling now contradicts. It was rewritten rather than deleted: it still pins
that no refresh happens at the 60 s mark where the old unconditional refresh
fired, and the ceiling test immediately after it pins where the new one does.

---

## Finding 3 — the Inbox was capped at 40 rows with no way to reach row 41

### What changed

New pure module `src/application/inbox/inbox-page-window.ts`:
`parseInboxPageParam` and `selectInboxPageWindow`. No database cursor —
`loadInboxSegmentIndex` already returns the complete ordered id list per tab,
so the continuation is arithmetic over that list.

- `page.tsx` reads `params.page`, slices the active tab's (or the search
  results') id list, and passes the window to `InboxClient`.
- `buildInboxHref` carries `page` beside `scope`/`tab`/`q`; page 1 is omitted
  so the default URL is still `/app/inbox`.
- `goToInbox` puts `page: 1` in the base target, so changing tab, scope or
  search **resets** the page. Without that, clicking "Atenção" from page 3
  would land on an apparently empty tab.
- A page past the end clamps to the last page rather than rendering empty
  under a badge promising 137 conversations.
- `InboxClient` renders a footer: "Mais recentes" / "41–80 de 137" /
  "Carregar mais antigas", hidden entirely when the tab fits on one page.

The expensive fetch stays bounded to `INBOX_PAGE_SIZE` per step, so the list
is **paged, not accumulated** — which is why the footer shows the rendered
range instead of implying infinite scroll.

### TDD evidence

RED — `npx vitest run src/__tests__/InboxPageWindow.test.ts`:

```
Error: Cannot find module '@/application/inbox/inbox-page-window'
```

RED — `npx vitest run src/__tests__/InboxContinuation.test.ts` (drives the
real `prepareInboxPage` and observes which ids reach the expensive read):

```
× página 2 pede a conversa 41 em diante — a linha que era inalcançável
  → expected 'conv-1' to be 'conv-41'
× a última página alcança a conversa 137
  → expected 'conv-40' to be 'conv-137'
× a paginação vale por ABA
  → expected 'att-1' to be 'att-41'
× a busca também pagina, e sobre os resultados dela
  → expected 'hit-1' to be 'hit-41'
Tests  7 failed | 2 passed (9)
```

RED — `npx vitest run src/__tests__/InboxNavigation.test.ts`:

```
× página > 1 entra como page, junto com filter e q
  → expected '/app/inbox?filter=hot&q=ana' to be '/app/inbox?filter=hot&q=ana&page=3'
```

GREEN, then re-verified by reverting only `page.tsx`
(`git stash push src/app/(clinic)/app/inbox/page.tsx`): `Tests 7 failed | 2
passed (9)`, restored to `Tests 9 passed (9)`.

One test deliberately covers the interaction the reviewer flagged: a clinic
with 137 conversations, where `import-calendar-events.ts` rows have a null
`lastMessageAt` and therefore sort last under `NULLS LAST` — precisely the
rows that were unreachable. Both Vitalli and Ximendes use calendar import.

---

## Finding 4 — two performance targets could not be measured

### `content_ready`

`durationMs = Math.round(deps.now())` was elapsed time since the document's
`timeOrigin`. The reporter now decides *what the measurement means* before it
decides the number:

1. **Soft navigation** (a mark exists for this surface): `now - startedAt`,
   emitted as `content_ready`. New `peekNavigationStartForSurface` reads the
   mark **without consuming it** — `NavigationPerformanceReporter` still owns
   removal when it emits `soft_navigation`. The read happens in the effect
   body, not inside the `requestAnimationFrame`: child effects run before the
   parent's, so the read beats the layout's removal, whereas the rAF (which
   runs after all effects) would arrive too late.
2. **Hard load** (no mark, first content-ready in this document): `timeOrigin`
   *is* the navigation start, so `performance.now()` is valid.
3. **Neither** (a `router.refresh()`, or a link that never wrote a mark): no
   known starting point, so **nothing is emitted** and no session budget is
   consumed. This is the case that previously produced the misleading number.

Both branches are also bounded by `MAX_NAVIGATION_DURATION_MS` (120 s), reused
from `navigation-timing.ts` so there is one owner of that sanity bound.

### The judgement call: `app_first_open` — wired, not reverted

Case 2 above **is** the "First application open" measurement: time from opening
the app cold until content is on screen, measured against a clock whose origin
genuinely is the navigation start. So the same reporter emits
`createFirstOpenSample` there. That gives `app_first_open` a real production
caller without a new component, a new listener, or a new mount point — one
branch in code this finding already required me to fix, and strictly more
correct than emitting a `content_ready` with no valid start.

I chose this over reverting the doc row to `not_measurable` because the
alternative leaves a contract operation, a telemetry-route allowlist entry and
a factory function all present with nothing producing them — dead surface area
that the next phase would have to re-litigate.

One doc correction was still required: the baseline mapped the target to
`client|clinic_shell|app_first_open|ok`, and **no reporter emits
`clinic_shell`** — `ContentReadyReporter` is mounted on `inbox_list` and
`conversation`. `docs/operations/performance-baseline.md` now says
`client|<entry surface>|app_first_open|ok` and instructs filtering on the
operation, not on a fixed surface. It also documents all three branches above.

### TDD evidence

RED — `npx vitest run src/__tests__/ContentReadyNavigationTiming.test.ts`:

```
× mede da marca de navegação até o paint, não do timeOrigin da sessão
× no carregamento duro (sem marca) emite app_first_open
× sem marca e já não é o primeiro render do documento: não emite NADA
  → expected "spy" to not be called at all, but actually been called 1 times
× descarta uma marca do futuro (duração negativa)
× descarta uma duração absurda
Tests  5 failed | 2 passed (7)
```

GREEN, plus the two pre-existing suites updated to the new contract:
`ContentReadyReporterComponent.test.ts` now asserts a soft navigation reports
450 ms rather than 45,450 ms, that the mark survives the read, and that a mark
belonging to a different surface is not used as a starting point.

Across the five telemetry suites: `Tests 23 passed (23)`.

---

## Finding 5 — the second sort key did not match the index

### The judgement call: align the query, not the index

`drizzle/0095` builds `(organization_id, last_message_at DESC NULLS LAST, id
DESC NULLS LAST)`; the query ordered by `desc(conversations.id)`, which
Postgres reads as `DESC NULLS FIRST`.

I changed the **query** to emit `id desc nulls last`, in
`list-conversations.ts` and in `segment-index.ts` (which had the same
mismatch), because:

- `conversations.id` is NOT NULL, so the returned rows are identical either
  way. Only the plan changes.
- Changing the index instead means a new migration that drops and recreates
  it — a second plain `CREATE INDEX` write lock on `conversations`, for zero
  behavioural gain.
- The other key genuinely needs `NULLS LAST` because `last_message_at` is
  nullable. Keeping the whole index uniformly `DESC NULLS LAST` is one rule
  rather than two, and `drizzle-kit` emits `NULLS LAST` for `.desc()` by
  default — forcing `NULLS FIRST` would need an explicit `.nullsFirst()` that
  reads as a special case.

`compareInboxRecency` needed **no change**: its `RecencyOrderedRow.convId` is
`string`, never null, so nulls placement on that key is unrepresentable in the
JS comparator. Its tie-break is already `convId` descending, matching `desc`.

### TDD evidence

RED — `npx vitest run src/__tests__/ListClinicConversations.test.ts`:

```
× orders by lastMessageAt desc nulls last, id desc nulls last — matching the Task 2 index exactly
Expected: '"conversations"."id" desc nulls last'
Received: '"conversations"."id" desc'
```

`InboxReadIndex.test.ts` was strengthened to assert direction and nulls
placement per column (deferred observation 3). It passes both before and after
— the index was already correct — so I verified it actually bites by flipping
`table.id.desc()` to `table.id.asc()` in `schema.ts`:

```
× orders the index columns — direção e NULLS incluídos — to match the inbox keyset
-     "order": "desc",
+     "order": "asc",
Tests  1 failed | 1 passed (2)
```

Schema restored; `npm run db:check` exits 0 and no migration was touched.

---

## Finding 6 — four server actions updated by conversation id alone

### What changed

`pauseAi`, `resumeAi`, `clearAttention` and `setConversationCategory` in
`src/app/(clinic)/app/inbox/[conversationId]/actions.ts` now call
`requireSessionClinicId()` and put the predicate **in the `where`**, so a
foreign id cannot land a write at all rather than being detected afterwards.
`pauseAi`'s `leads` update is scoped the same way.

`setConversationCategory` loses its preliminary `select` entirely: it existed
only to discover the conversation's clinic, which the session already answers
with authority. "Conversa não encontrada" now means "does not exist *inside
this clinic*" — the right answer for both a nonexistent id and another
tenant's id.

### TDD evidence

RED — `npx vitest run src/__tests__/InboxActionsTenantScope.test.ts`:

```
AssertionError: expected '"conversations"."id" = $1' to contain '"conversations"."organization_id" = $'
...
Tests  5 failed (5)
```

The fifth test is the one that matters, and it was written to avoid passing
vacuously: its `db.update` mock **simulates Postgres** rather than returning
`[]` for free. The target row belongs to another clinic, so it matches only if
the submitted `where` lacks the session predicate. With the bug, the update
lands, `returning()` yields the foreign `clinicId`, and `bumpInboxVersion`
fires on a tenant the caller cannot see — the test fails. With the fix,
nothing matches.

GREEN: `Tests 5 passed (5)`.

---

## Found while working, not named by the review

1. **The bump gap extended past `stuck-conversation-sweep`.** Two further
   production writers had no bump — the `(admin)` `leads.status` write (which
   the review did name) and, additionally, the human-review repository's
   `createPending`/`applyDecision`, which are the sole producers of the
   "Pendências" tab's membership. Fixed under finding 1.
2. **`segment-index.ts` had the same `ORDER BY`/index mismatch** as
   `list-conversations.ts`. The review named only the latter. Fixed under
   finding 5.
3. **`InboxReadIndex.test.ts` would not have caught a direction flip**
   (deferred observation 3 in the handoff, now demonstrated rather than
   suspected — see finding 5's evidence). Strengthened.
4. **`MemoryStorage` was duplicated verbatim across two test files**
   (deferred observation 2). Folded into
   `src/__tests__/helpers/memory-storage.ts`; vitest's include is
   `src/__tests__/**/*.test.ts`, so the helper is not collected as a suite.
5. **`ContentReadyReporterComponent.test.ts` still relies on a fixed number
   of microtask hops** (deferred observation 1). I did not fix this — it is
   pre-existing and the assertion is meaningful — but I hit the same class of
   problem writing the poller tests, where `advanceTimersByTimeAsync(0)`
   yielded once and left the follow-up `setTimeout` registered 1 ms late.
   That one is handled explicitly by a commented `settle()` helper rather than
   by a magic hop count.
6. **`InboxPoller` had no re-entrancy guard.** Adding the `visibilitychange`
   restart would have left one polling loop per alt-tab. The cycle counter and
   its test exist because of that, not because the review asked.

## Not fixed, and why

1. **Deferred observation 15 — leftovers from the derived-version design.**
   `get-inbox-snapshot-signature.ts` still appears to have no callers, and
   `page.tsx` still selects `organizations.updatedAt` without reading it.
   Both are dead weight, not defects; removing them is a cleanup with no test
   that would express intent, and this wave is a fix wave. Marked still-open
   in the handoff.
2. **Index *choice* remains unverified.** Finding 5 makes the ordering
   satisfiable from the index; it does not prove the planner selects it. That
   needs `EXPLAIN ANALYZE` against representative data, which this environment
   cannot run. The handoff's "Index choice is unverified" section stands.
3. **No cohort collected.** Findings 4 makes `content_ready` and
   `app_first_open` produce honest numbers. Nobody has collected the 16
   cohorts `docs/operations/performance-baseline.md` requires, so no target
   may be described as met.
4. **`import-calendar-events.ts`'s suite is still `DATABASE_URL`-gated** and
   did not run here, so its bump site remains untested in this environment.
   Pre-existing; unchanged by this wave. It matters more now, because finding
   3's failure scenario is driven by exactly the rows that importer creates.
5. **The `(admin)` route surface was not otherwise audited.**
   `assumeConversation` is scoped by `leads.id` alone; I added the bump the
   review asked for but did not add a session-clinic predicate there, because
   that route group has no `requireSessionClinicId` convention established in
   this branch's scope and changing its auth model is not a fix-wave decision.
   Flagging it: it is the same shape as finding 6.
6. **The clinic purge route and the `src/app/api/e2e/*` routes** write
   Inbox-visible tables without bumping. The purge route deletes the
   organization itself, so an open Inbox for it is moot and
   `clinic_read_versions` cascades; the e2e routes are not production. Neither
   was changed.
