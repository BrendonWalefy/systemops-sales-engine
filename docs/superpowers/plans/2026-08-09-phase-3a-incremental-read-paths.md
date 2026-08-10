# Phase 3A — Incremental Read Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the clinic Inbox stop paying a cost proportional to total history and idle open tabs, and make the resulting improvement measurable.

**Architecture:** Three independent cost centres are removed in order. First the read ordering gets a composite index and a keyset cursor, so the base query returns a bounded page instead of every conversation. Second the five enrichment queries are bounded to that page's IDs, which they already accept — they only look unbounded because the page feeds them everything. Third the 5-second poll stops running four aggregations per tab and reads one materialised version row per clinic, which domain writes bump. Instrumentation for content-ready comes first so the change can be proven rather than asserted.

**Tech Stack:** Next.js App Router (server components), Drizzle ORM on Neon Postgres (`neon-http`, no interactive transactions), Vitest, TypeScript.

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-08-09-systemops-rebuild-design.md`:

- First page of lists: 30–50 records per cursor. This plan uses **40**.
- Conversation history: 60 initial messages, incremental reverse fetch.
- No full refresh for a single-item change.
- The fallback poll reads **a single materialised version per tenant/resource, never the current four aggregations**.
- Composite indexes aligned to the measured queries.
- No metric is declared met without production telemetry or an equivalent environment.
- `O LLM entende e verbaliza; o sistema decide.` — untouched by this plan; no conversational behaviour changes here.
- Tenant isolation: every query resolves `clinicId` first; no cross-clinic read.
- Schema/migration, conversational core, UI and external integration never share one commit or deploy (`§20`).

Repo rules (`docs/operations/change-control.md`, `AGENTS.md`):

- `npm run verify` before every push. It runs `db:check`, `lint`, `typecheck`, `test`.
- Migrations are generated with `npm run db:generate`, never hand-written.
- Neon `neon-http` has **no interactive transactions** — multi-statement atomicity must use a single statement or a CAS update.
- Feature branches target `develop`, never `main`.

## Scope

**In this plan:** content-ready instrumentation, the composite index, keyset pagination of the Inbox base query, bounding the enrichment queries, the materialised version read model, removing the unconditional 60-second refresh, and reverse pagination of conversation history.

**Deliberately deferred to Phase 3B (realtime):** `RealtimeEventPort` and its adapter, per-resource delta APIs, optimistic mutations with rollback, and list virtualisation. Phase 3B depends on the version read model this plan builds.

## Baseline being changed

Measured on `develop` at `8882416`:

| Cost centre | Current behaviour | Evidence |
| --- | --- | --- |
| Inbox base query | Returns every conversation for the clinic; no `limit`/`offset` | `src/app/(clinic)/app/inbox/page.tsx:32-55` |
| Enrichment | 5 queries fed `inArray(...)` with the full conversation ID list | `src/app/(clinic)/app/inbox/page.tsx:66-140` |
| Poll | 4 aggregations (`COUNT`+`MAX` over conversations, leads, appointments, plus an org read) every 5 s per open tab | `src/app/(clinic)/app/inbox/get-inbox-version.ts:9-42`, `InboxPoller.tsx:7` |
| Forced refresh | Full `router.refresh()` every 60 s regardless of change | `src/app/(clinic)/app/inbox/InboxPoller.tsx:6,35-38` |
| Index | No index on `(organization_id, last_message_at)`; only `(organization_id, category)` | `src/infrastructure/db/schema.ts` `conversations` table |

## File Structure

| File | Responsibility |
| --- | --- |
| `src/application/observability/performance-contract.ts` | Modify: add `content_ready` and `app_first_open` operations |
| `src/components/performance/content-ready-reporter.tsx` | Create: marks a surface content-ready once its data is painted |
| `src/infrastructure/db/schema.ts` | Modify: composite index; `clinicReadVersions` table |
| `drizzle/` | Generated migration only — never hand-edited |
| `src/application/inbox/inbox-cursor.ts` | Create: encode/decode and compare the keyset cursor |
| `src/application/inbox/list-conversations.ts` | Create: the paginated base query, owning ordering and page size |
| `src/application/read-versions/clinic-read-version.ts` | Create: read and bump the materialised version |
| `src/app/(clinic)/app/inbox/get-inbox-version.ts` | Modify: single row read replacing four aggregations |
| `src/app/(clinic)/app/inbox/page.tsx` | Modify: consume the paginated query |
| `src/app/(clinic)/app/inbox/InboxPoller.tsx` | Modify: remove forced refresh, add backoff and hidden-tab pause |
| `src/app/(clinic)/app/inbox/[conversationId]/page.tsx` | Modify: 60-message initial window |
| `src/application/inbox/list-messages.ts` | Create: reverse-paginated history query |

---

### Task 1: Content-ready telemetry contract

Phase 1 recorded that four of the five design targets are `not_measurable`, because `soft_navigation` stops at the pathname change and can settle on a `loading.tsx` skeleton (`docs/operations/performance-baseline.md` §"What `soft_navigation` measures"). Without a content-ready signal, no later task in this plan can be shown to have improved anything. This task adds the signal only; it changes no read path.

**Files:**
- Modify: `src/application/observability/performance-contract.ts:12-21`
- Create: `src/components/performance/content-ready-reporter.tsx`
- Test: `src/__tests__/PerformanceContentReady.test.ts`

**Interfaces:**
- Consumes: `PerformanceSample`, `PERFORMANCE_OPERATIONS`, `createSoftNavigationSample` from the existing contract.
- Produces: `createContentReadySample(surface, durationMs, cacheState)` and `createFirstOpenSample(surface, durationMs)`, both returning `PerformanceSample`. Tasks 4 and 7 assert against these operation names.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_OPERATIONS,
  createContentReadySample,
  createFirstOpenSample,
} from "@/application/observability/performance-contract";

describe("content-ready performance contract", () => {
  it("exposes content_ready and app_first_open as allowed operations", () => {
    expect(PERFORMANCE_OPERATIONS).toContain("content_ready");
    expect(PERFORMANCE_OPERATIONS).toContain("app_first_open");
  });

  it("builds a content-ready sample carrying the observed cache state", () => {
    expect(createContentReadySample("inbox_list", 412, "warm")).toEqual({
      schemaVersion: 1,
      source: "client",
      surface: "inbox_list",
      operation: "content_ready",
      durationMs: 412,
      cacheState: "warm",
      outcome: "ok",
    });
  });

  it("defaults cache state to unknown when the caller cannot attribute it", () => {
    expect(createContentReadySample("conversation", 300).cacheState).toBe("unknown");
  });

  it("builds a first-open sample that is always cold", () => {
    expect(createFirstOpenSample("clinic_shell", 1200)).toEqual({
      schemaVersion: 1,
      source: "client",
      surface: "clinic_shell",
      operation: "app_first_open",
      durationMs: 1200,
      cacheState: "cold",
      outcome: "ok",
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/PerformanceContentReady.test.ts`
Expected: FAIL — `createContentReadySample is not a function`.

- [ ] **Step 3: Extend the contract**

In `src/application/observability/performance-contract.ts`, add the two operations to `PERFORMANCE_OPERATIONS` (append, do not reorder — the array order is part of the recorded contract) and append:

```ts
export function createContentReadySample(
  surface: PerformanceSurface,
  durationMs: number,
  cacheState: "cold" | "warm" | "unknown" = "unknown",
): PerformanceSample {
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    source: "client",
    surface,
    operation: "content_ready",
    durationMs,
    cacheState,
    outcome: "ok",
  };
}

export function createFirstOpenSample(
  surface: PerformanceSurface,
  durationMs: number,
): PerformanceSample {
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    source: "client",
    surface,
    operation: "app_first_open",
    durationMs,
    cacheState: "cold",
    outcome: "ok",
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- src/__tests__/PerformanceContentReady.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the reporter component**

Create `src/components/performance/content-ready-reporter.tsx`. It renders nothing and fires once per mount, after paint, so it measures data-painted rather than route-changed.

**Correction to an earlier draft of this plan:** `MAX_CLIENT_SAMPLES_PER_SESSION` is **not** enforced by the ingest route. The only enforcement is client-side, in `src/components/performance/navigation-performance-reporter.tsx:54`, using a `sessionStorage` counter. The new reporter must carry the same guard — mirror that component's counter rather than inventing a second scheme, and share the counter key with it so the two reporters draw on one budget instead of two.

The ingest route keeps an explicit allowlist of operations a client is permitted to submit. Add `content_ready` and `app_first_open` to that allowlist; do not remove the check. Operations such as `dashboard_total`, `shell_context`, `inbox_base_query`, `inbox_enrichment_query`, `inbox_total`, `conversation_total` and `agenda_bootstrap` are produced only by `measureServerOperation` with `source: "server"`, and a client-tagged payload claiming them must still be rejected.

```tsx
"use client";

import { useEffect, useRef } from "react";
import {
  createContentReadySample,
  type PerformanceSurface,
} from "@/application/observability/performance-contract";

type Props = { surface: PerformanceSurface };

export function ContentReadyReporter({ surface }: Props) {
  const reported = useRef(false);

  useEffect(() => {
    if (reported.current) return;
    reported.current = true;

    const frame = requestAnimationFrame(() => {
      const durationMs = Math.round(performance.now());
      void fetch("/api/telemetry/performance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createContentReadySample(surface, durationMs)),
        keepalive: true,
      }).catch(() => {
        // Telemetria nunca pode quebrar a tela que está medindo.
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [surface]);

  return null;
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: exit 0.

```bash
git add src/application/observability/performance-contract.ts \
        src/components/performance/content-ready-reporter.tsx \
        src/__tests__/PerformanceContentReady.test.ts
git commit -m "feat(observability): add content-ready performance signal"
```

---

### Task 2: Composite index for the Inbox read ordering

The base query orders by `lastMessageAt DESC` filtered by `clinicId`, and no index covers that. Task 3's keyset cursor is only cheap if this index exists, so it lands first and separately — schema changes never share a commit with application code (`§20`).

**Files:**
- Modify: `src/infrastructure/db/schema.ts` (`conversations` table index block)
- Generated: `drizzle/` migration
- Test: `src/__tests__/InboxReadIndex.test.ts`

**Interfaces:**
- Produces: index `conversations_org_last_message_idx` on `(organization_id, last_message_at DESC, id DESC)`. Task 3's cursor ordering must match this exactly or the index will not be used.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { conversations } from "@/infrastructure/db/schema";

describe("conversations read index", () => {
  it("indexes the clinic + last message ordering used by the inbox", () => {
    const names = getTableConfig(conversations).indexes.map((i) => i.config.name);
    expect(names).toContain("conversations_org_last_message_idx");
  });

  it("orders the index columns to match the inbox keyset", () => {
    const index = getTableConfig(conversations).indexes.find(
      (i) => i.config.name === "conversations_org_last_message_idx",
    );
    expect(index?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "organization_id",
      "last_message_at",
      "id",
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/InboxReadIndex.test.ts`
Expected: FAIL — the index name is absent.

- [ ] **Step 3: Add the index**

In `src/infrastructure/db/schema.ts`, inside the `conversations` table's `(table) => ({ ... })` block, add alongside the existing entries:

```ts
    clinicLastMessageIdx: index("conversations_org_last_message_idx").on(
      table.clinicId,
      table.lastMessageAt.desc(),
      table.id.desc(),
    ),
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: one new file under `drizzle/` containing `CREATE INDEX`. Do not edit it. Confirm it creates only this index:

```bash
git status --short drizzle/
grep -c "CREATE INDEX" drizzle/*conversations_org_last_message*.sql
```

- [ ] **Step 5: Run the tests and the metadata check**

Run: `npm test -- src/__tests__/InboxReadIndex.test.ts && npm run db:check`
Expected: PASS, and `db:check` exit 0.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: exit 0.

```bash
git add src/infrastructure/db/schema.ts drizzle src/__tests__/InboxReadIndex.test.ts
git commit -m "feat(db): index clinic inbox read ordering"
```

Deploy note for the PR body: this migration adds an index and takes no destructive action. On Postgres a plain `CREATE INDEX` takes a write lock on `conversations` for the duration. On current data volumes that is sub-second; if a later clinic makes it slow, the migration must be re-issued as `CREATE INDEX CONCURRENTLY` outside the migration runner.

---

### Task 3: Keyset cursor for the Inbox base query

**Files:**
- Create: `src/application/inbox/inbox-cursor.ts`
- Create: `src/application/inbox/list-conversations.ts`
- Test: `src/__tests__/InboxCursor.test.ts`

**Interfaces:**
- Consumes: the index from Task 2.
- Produces:
  - `INBOX_PAGE_SIZE = 40`
  - `encodeInboxCursor(row: {lastMessageAt: Date | null; id: string}): string`
  - `decodeInboxCursor(raw: string | null): {lastMessageAt: Date | null; id: string} | null`
  - `listClinicConversations({clinicId, cursor, limit}): Promise<{rows: InboxConversationRow[]; nextCursor: string | null}>`

  Task 4 consumes `listClinicConversations` and `nextCursor`.

Ordering rule: `lastMessageAt DESC NULLS LAST, id DESC`. `id` breaks ties so the keyset is total — without it a page boundary landing inside equal timestamps silently drops or repeats rows.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  INBOX_PAGE_SIZE,
  decodeInboxCursor,
  encodeInboxCursor,
} from "@/application/inbox/inbox-cursor";

describe("inbox cursor", () => {
  it("uses a page size inside the specified 30-50 range", () => {
    expect(INBOX_PAGE_SIZE).toBe(40);
  });

  it("round-trips a row with a timestamp", () => {
    const at = new Date("2026-08-09T12:00:00.000Z");
    const decoded = decodeInboxCursor(encodeInboxCursor({ lastMessageAt: at, id: "abc" }));
    expect(decoded).toEqual({ lastMessageAt: at, id: "abc" });
  });

  it("round-trips a row whose conversation never received a message", () => {
    const decoded = decodeInboxCursor(encodeInboxCursor({ lastMessageAt: null, id: "abc" }));
    expect(decoded).toEqual({ lastMessageAt: null, id: "abc" });
  });

  it("returns null for absent, malformed or non-cursor input", () => {
    expect(decodeInboxCursor(null)).toBeNull();
    expect(decodeInboxCursor("")).toBeNull();
    expect(decodeInboxCursor("not-base64")).toBeNull();
    expect(decodeInboxCursor(Buffer.from("{}", "utf8").toString("base64url"))).toBeNull();
  });

  it("rejects a cursor carrying an invalid date", () => {
    const raw = Buffer.from(JSON.stringify({ t: "nope", id: "abc" }), "utf8").toString("base64url");
    expect(decodeInboxCursor(raw)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/InboxCursor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the cursor**

Create `src/application/inbox/inbox-cursor.ts`:

```ts
export const INBOX_PAGE_SIZE = 40;

export type InboxCursor = { lastMessageAt: Date | null; id: string };

export function encodeInboxCursor(row: InboxCursor): string {
  const payload = { t: row.lastMessageAt ? row.lastMessageAt.toISOString() : null, id: row.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeInboxCursor(raw: string | null): InboxCursor | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;

    const { t, id } = parsed as { t?: unknown; id?: unknown };
    if (typeof id !== "string" || id.length === 0) return null;
    if (t === null || t === undefined) return { lastMessageAt: null, id };
    if (typeof t !== "string") return null;

    const at = new Date(t);
    if (Number.isNaN(at.getTime())) return null;

    return { lastMessageAt: at, id };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- src/__tests__/InboxCursor.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Implement the paginated query**

Create `src/application/inbox/list-conversations.ts`. It moves the base select out of the page component verbatim, adds the keyset predicate, and requests one extra row to decide whether a next page exists.

```ts
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, leads } from "@/infrastructure/db/schema";
import { INBOX_PAGE_SIZE, decodeInboxCursor, encodeInboxCursor } from "./inbox-cursor";

export async function listClinicConversations(params: {
  clinicId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const limit = params.limit ?? INBOX_PAGE_SIZE;
  const cursor = decodeInboxCursor(params.cursor ?? null);

  // NULLS LAST no DESC: uma conversa sem mensagem fica no fim da lista.
  // O cursor precisa do mesmo tratamento, senão a paginação pula linhas.
  const keyset = cursor
    ? cursor.lastMessageAt
      ? or(
          lt(conversations.lastMessageAt, cursor.lastMessageAt),
          and(eq(conversations.lastMessageAt, cursor.lastMessageAt), lt(conversations.id, cursor.id)),
          sql`${conversations.lastMessageAt} is null`,
        )
      : and(sql`${conversations.lastMessageAt} is null`, lt(conversations.id, cursor.id))
    : undefined;

  const rows = await db
    .select({
      convId: conversations.id,
      leadId: leads.id,
      lastMessageAt: conversations.lastMessageAt,
      needsAttention: conversations.needsAttention,
      attentionReason: conversations.attentionReason,
      aiPaused: conversations.aiPaused,
      conversationCategory: conversations.category,
      takeoverExpiresAt: conversations.takeoverExpiresAt,
      lastReadAt: conversations.lastReadAt,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadStatus: leads.status,
      leadTemperature: leads.temperature,
      leadTreatmentInterest: leads.treatmentInterest,
      leadProfilePicUrl: leads.profilePicUrl,
      leadUpdatedAt: leads.updatedAt,
      conversationUpdatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .where(keyset ? and(eq(conversations.clinicId, params.clinicId), keyset) : eq(conversations.clinicId, params.clinicId))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    rows: page,
    nextCursor: rows.length > limit && last ? encodeInboxCursor({ lastMessageAt: last.lastMessageAt, id: last.convId }) : null,
  };
}

export type InboxConversationRow = Awaited<ReturnType<typeof listClinicConversations>>["rows"][number];
```

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: exit 0.

```bash
git add src/application/inbox src/__tests__/InboxCursor.test.ts
git commit -m "feat(inbox): add keyset pagination for conversation list"
```

---

### Task 4: Bound the Inbox page to one cursor page

The five enrichment queries already accept an ID list. They are unbounded only because the base query hands them every conversation. Once Task 3 supplies 40 rows, they become bounded with no change to their own shape.

**Files:**
- Modify: `src/app/(clinic)/app/inbox/page.tsx:17-140`
- Test: `src/__tests__/InboxPagination.test.ts`

**Interfaces:**
- Consumes: `listClinicConversations`, `INBOX_PAGE_SIZE` (Task 3); `ContentReadyReporter` (Task 1).
- Produces: the page passes `nextCursor` into `InboxClient`; Phase 3B's delta API reuses the same cursor encoding.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

const PAGE_SOURCE = "src/app/(clinic)/app/inbox/page.tsx";

async function readPageSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  return fs.readFile(PAGE_SOURCE, "utf8");
}

describe("inbox page bounding", () => {
  it("delegates the base read to the paginated query", async () => {
    const source = await readPageSource();
    expect(source).toContain("listClinicConversations");
  });

  it("keeps the unbounded base select out of the page", async () => {
    const source = await readPageSource();
    expect(source).not.toMatch(/\.from\(conversations\)/);
  });

  it("derives the enrichment id lists from the returned page only", async () => {
    const source = await readPageSource();
    // conversationIds/salesLeadIds precisam sair de page.rows. Se voltarem a
    // sair de um select próprio, o inArray volta a crescer com o histórico.
    expect(source).toMatch(/const rows = page\.rows/);
    expect(source).toMatch(/const conversationIds = rows\.map/);
  });
});
```

These are source-shape assertions, not behaviour assertions, and that is deliberate: the guarantee being protected is structural — that the page never again grows its own unbounded select. The behavioural guarantee that a page holds at most `INBOX_PAGE_SIZE` rows is already owned by Task 3's cursor tests; do not restate it here.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/InboxPagination.test.ts`
Expected: FAIL — `page.tsx` still contains `.from(conversations)`.

- [ ] **Step 3: Rewrite the base read in the page**

In `src/app/(clinic)/app/inbox/page.tsx`, replace the second element of the first `Promise.all` (lines 32-55) with a call to `listClinicConversations`, keeping the existing `measureServerOperation` wrapper and its `inbox_base_query` operation name so the Phase 1 baseline stays comparable:

```ts
  const cursor = typeof params.cursor === "string" ? params.cursor : null;

  const [clinicRows, page] = await measureServerOperation(
    { clinicId, surface: "inbox_list", operation: "inbox_base_query" },
    () => Promise.all([
      db.select({
        autoReplyEnabled: organizations.autoReplyEnabled,
        updatedAt: organizations.updatedAt,
      })
        .from(organizations)
        .where(eq(organizations.id, clinicId))
        .limit(1),
      listClinicConversations({ clinicId, cursor }),
    ]),
  );

  const rows = page.rows;
  const nextCursor = page.nextCursor;
```

Leave lines 61-140 untouched — `salesLeadIds` and `conversationIds` now derive from 40 rows instead of all of them, which is the entire point. Remove the now-unused `desc` and `conversations` imports if the linter flags them.

- [ ] **Step 4: Mount the content-ready reporter**

In the same file's returned JSX, next to `<InboxPoller ... />`, add:

```tsx
      <ContentReadyReporter surface="inbox_list" />
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- src/__tests__/InboxPagination.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: exit 0.

```bash
git add "src/app/(clinic)/app/inbox/page.tsx" src/__tests__/InboxPagination.test.ts
git commit -m "feat(inbox): bound page reads to one cursor page"
```

---

### Task 4b: Server-side tab segmentation

**Added during execution.** Task 4's own audit found a defect in this plan: Task 4 assumed the five enrichment queries were the only consumers of the full conversation list. They are not. `src/app/(clinic)/app/inbox/InboxClient.tsx:840-941` derives every tab's **membership and count** by filtering the `rows` prop on the client — `totalAll = rows.length` at line 915, and per-tab counts at lines 935-941.

Once `rows` is a 40-row page, that is a functional regression, not a cost change: counters under-report, and a conversation needing attention that falls outside the 40 most recent vanishes from the "Atenção" tab. Spec §12.2 mandates read models for Inbox counters; this plan failed to turn that into a task.

**Files:**
- Create: `src/application/inbox/inbox-segmentation.ts`
- Create: `src/application/inbox/segment-index.ts`
- Modify: `src/app/(clinic)/app/inbox/inbox-presentation.ts` — export the predicates for server reuse
- Modify: `src/app/(clinic)/app/inbox/page.tsx`
- Modify: `src/app/(clinic)/app/inbox/InboxClient.tsx` — consume counts instead of deriving them
- Test: `src/__tests__/InboxSegmentIndex.test.ts`

**Interfaces:**
- Consumes: `listClinicConversations` (Task 3), and the existing predicates `segmentRows`, `isRecoveryCandidate`, `resolveInboxPendingAction`.
- Produces:
  - `type InboxTabKey = "all" | "hot" | "attention" | "pending" | "paused" | "cold" | "recovery"`
  - `buildSegmentIndex(rows: SegmentInputRow[]): { counts: Record<InboxTabKey, number>; idsByTab: Record<InboxTabKey, string[]> }`
  - `loadInboxSegmentIndex({ clinicId }): Promise<ReturnType<typeof buildSegmentIndex>>`

**The design constraint that decides this task.** The tab predicates depend on enrichment — the last message's author, the latest appointment lifecycle state, and the pending-action inputs. Re-expressing them as SQL `WHERE` clauses would create a second implementation of the same business rules, and `docs/architecture/sources-of-truth.md` forbids a second owner for any decision. **Do not translate the predicates into SQL.**

Instead, split the work by cost:

1. A **narrow clinic-wide scan** selects only the columns the predicates read — no message bodies, no profile picture URLs, no lead names, no summaries. This stays linear in conversation count but carries a small fixed payload per row.
2. The **existing TypeScript predicates** run over that narrow set on the server, producing counts and an ordered ID list per tab. One implementation, no drift.
3. The **expensive work** — the full 17-column rows plus the five enrichment queries plus message bodies — is then fetched for at most `INBOX_PAGE_SIZE` IDs of the selected tab.

That bounds what actually costs money while keeping correctness exact. The remaining linear scan is a deliberate, documented limitation: replacing it with a true materialised read model belongs to Phase 3B, and Task 8 must record it as unfinished rather than implying the Inbox is now fully sublinear.

- [ ] **Step 1: Write the failing test**

Test `buildSegmentIndex` as a pure function over hand-built rows — no database. Cover, with real assertions on both `counts` and `idsByTab`:

- a conversation needing attention that sits far down the recency order still lands in `attention` (the exact regression this task exists to prevent);
- `hot` and `cold` split by `leadTemperature`;
- `recovery` picks up a `follow_up_due` row whose last message author is not `lead`;
- `paused` excludes a row that is also a recovery candidate;
- `closed`/`won`/`lost` rows are excluded from `all`;
- counts equal `idsByTab[tab].length` for every tab.

Assert counts that would change if a predicate were inverted. A test asserting only that the function returns an object is worthless here — three tasks on this branch already failed review for exactly that.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/InboxSegmentIndex.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Extract the predicates for reuse**

`isRecoveryCandidate` and `resolveAppointmentLifecycleState` already live in `src/app/(clinic)/app/inbox/inbox-presentation.ts`; `segmentRows` and `categoryRows` are private to `InboxClient.tsx`. Move `segmentRows` and `categoryRows` into `src/application/inbox/inbox-segmentation.ts` and re-export them where the client used them. Do not change their logic — this is a move, and the existing behaviour is the specification.

- [ ] **Step 4: Implement `buildSegmentIndex`**

Pure function. Takes the narrow rows plus the last-message map, applies `categoryRows` then `segmentRows`, and derives the same seven tabs `InboxClient.tsx:935-941` builds today, returning both counts and ordered ID lists. Order must match the page ordering: `lastMessageAt DESC NULLS LAST, id DESC`.

- [ ] **Step 5: Implement the narrow scan**

`loadInboxSegmentIndex` in `src/application/inbox/segment-index.ts`. Scoped by `clinicId`. Select only what the predicates read: `conversations.id`, `category`, `aiPaused`, `needsAttention`, `attentionReason`, `takeoverExpiresAt`, `lastMessageAt`, `leads.status`, `leads.temperature`, plus the latest message's `author`/`sentAt`, the latest appointment's `status`/`startsAt`, the latest conversation state, and pending human-review conversation IDs. Explicitly do **not** select `messages.body`, `leads.name`, `leads.phone`, `leads.profilePicUrl` or `conversations.summary`.

- [ ] **Step 6: Wire the page and the client**

`page.tsx` calls `loadInboxSegmentIndex`, then fetches full rows for the first `INBOX_PAGE_SIZE` IDs of the active tab, and passes `counts` to `InboxClient`. `InboxClient` takes `counts` as a prop and stops computing them from `rows`. Delete the client-side count derivation rather than leaving it beside the new prop — two sources for the same number is the defect this task removes.

Keep `measureServerOperation` wrapping both the scan and the page fetch, using distinct operation names so the baseline can tell them apart.

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`
Expected: exit 0.

```bash
git add src/application/inbox "src/app/(clinic)/app/inbox" src/__tests__/InboxSegmentIndex.test.ts
git commit -m "feat(inbox): segment tabs on the server"
```

---

### Task 5: Materialised read version per clinic

Replaces the four aggregations with one indexed row read. The version is bumped by the writes that change what the Inbox displays.

**Files:**
- Modify: `src/infrastructure/db/schema.ts` (new table)
- Generated: `drizzle/` migration
- Create: `src/application/read-versions/clinic-read-version.ts`
- Test: `src/__tests__/ClinicReadVersion.test.ts`

**Interfaces:**
- Produces:
  - table `clinic_read_versions(organization_id uuid, resource text, version bigint, updated_at timestamptz)`, primary key `(organization_id, resource)`
  - `bumpClinicReadVersion(clinicId: string, resource: ClinicReadResource): Promise<void>`
  - `readClinicVersion(clinicId: string, resource: ClinicReadResource): Promise<string>`
  - `ClinicReadResource = "inbox"`

  Task 6 consumes `readClinicVersion`. Phase 3B consumes both.

Because `neon-http` has no interactive transactions, the bump must be a single upsert statement — never read-then-write.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { clinicReadVersions } from "@/infrastructure/db/schema";

describe("clinic read versions table", () => {
  it("is keyed by clinic and resource", () => {
    const config = getTableConfig(clinicReadVersions);
    const pk = config.primaryKeys[0];
    expect(pk?.columns.map((c) => c.name)).toEqual(["organization_id", "resource"]);
  });

  it("stores a monotonic version and its update time", () => {
    const names = getTableConfig(clinicReadVersions).columns.map((c) => c.name);
    expect(names).toContain("version");
    expect(names).toContain("updated_at");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/ClinicReadVersion.test.ts`
Expected: FAIL — `clinicReadVersions` is not exported.

- [ ] **Step 3: Add the table**

In `src/infrastructure/db/schema.ts`:

```ts
// Read model de invalidação: uma linha por (clínica, recurso). Substitui as
// quatro agregações que o poll da inbox rodava a cada 5s por aba. A versão é
// monotônica e só indica "mudou"; ela nunca carrega conteúdo de conversa.
export const clinicReadVersions = pgTable(
  "clinic_read_versions",
  {
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    resource: text("resource").notNull(),
    version: bigint("version", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clinicId, table.resource] }),
  }),
);
```

Add `bigint` and `primaryKey` to the existing `drizzle-orm/pg-core` import if absent.

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate && npm run db:check`
Expected: one new `drizzle/` file with `CREATE TABLE "clinic_read_versions"`; `db:check` exit 0.

- [ ] **Step 5: Implement read and bump**

Create `src/application/read-versions/clinic-read-version.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinicReadVersions } from "@/infrastructure/db/schema";

export type ClinicReadResource = "inbox";

export async function bumpClinicReadVersion(
  clinicId: string,
  resource: ClinicReadResource,
): Promise<void> {
  // Upsert de statement único: neon-http não tem transação interativa, então
  // ler-e-escrever perderia bumps concorrentes.
  await db
    .insert(clinicReadVersions)
    .values({ clinicId, resource, version: 1 })
    .onConflictDoUpdate({
      target: [clinicReadVersions.clinicId, clinicReadVersions.resource],
      set: {
        version: sql`${clinicReadVersions.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

export async function readClinicVersion(
  clinicId: string,
  resource: ClinicReadResource,
): Promise<string> {
  const [row] = await db
    .select({ version: clinicReadVersions.version })
    .from(clinicReadVersions)
    .where(and(eq(clinicReadVersions.clinicId, clinicId), eq(clinicReadVersions.resource, resource)))
    .limit(1);

  return String(row?.version ?? 0);
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: exit 0.

```bash
git add src/infrastructure/db/schema.ts drizzle src/application/read-versions src/__tests__/ClinicReadVersion.test.ts
git commit -m "feat(db): add clinic read version model"
```

---

### Task 6: Cheap poll and no unconditional refresh

**Files:**
- Modify: `src/app/(clinic)/app/inbox/get-inbox-version.ts` (full replacement)
- Modify: `src/app/(clinic)/app/inbox/InboxPoller.tsx`
- Modify: the write paths that change Inbox-visible state
- Test: `src/__tests__/InboxPollBackoff.test.ts`

**Interfaces:**
- Consumes: `readClinicVersion`, `bumpClinicReadVersion` (Task 5).
- Produces: `nextPollDelayMs(consecutiveUnchanged: number): number` — Phase 3B reuses it as the realtime fallback ladder.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { nextPollDelayMs } from "@/app/(clinic)/app/inbox/poll-schedule";

describe("inbox poll backoff", () => {
  it("starts inside the 15-30s window from the spec", () => {
    expect(nextPollDelayMs(0)).toBe(15_000);
  });

  it("backs off toward 60s while nothing changes", () => {
    expect(nextPollDelayMs(1)).toBe(30_000);
    expect(nextPollDelayMs(2)).toBe(60_000);
  });

  it("caps at 60s and never exceeds it", () => {
    expect(nextPollDelayMs(50)).toBe(60_000);
    expect(nextPollDelayMs(Number.MAX_SAFE_INTEGER)).toBe(60_000);
  });

  it("never decreases as the unchanged streak grows", () => {
    const ladder = [0, 1, 2, 3, 10].map(nextPollDelayMs);
    const sorted = [...ladder].sort((a, b) => a - b);
    expect(ladder).toEqual(sorted);
  });

  it("treats a negative counter as the floor rather than throwing", () => {
    expect(nextPollDelayMs(-1)).toBe(15_000);
  });
});
```

`nextPollDelayMs` is a pure function of the unchanged-streak counter. Resetting that counter when the version changes is the poller's job (Step 6), not this function's — do not write a "reset" test here.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/InboxPollBackoff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the ladder**

Create `src/app/(clinic)/app/inbox/poll-schedule.ts`:

```ts
const LADDER_MS = [15_000, 30_000, 60_000] as const;

export function nextPollDelayMs(consecutiveUnchanged: number): number {
  const index = Math.min(Math.max(consecutiveUnchanged, 0), LADDER_MS.length - 1);
  return LADDER_MS[index];
}
```

- [ ] **Step 4: Replace the version derivation**

Replace the whole body of `src/app/(clinic)/app/inbox/get-inbox-version.ts` with a single row read:

```ts
import { readClinicVersion } from "@/application/read-versions/clinic-read-version";

export async function getInboxVersion(clinicId: string): Promise<string> {
  return readClinicVersion(clinicId, "inbox");
}
```

This deletes the four aggregations. The old file's `serializeDate` helper and its `count`/`max`/table imports go with it.

- [ ] **Step 5: Bump on the writes that matter**

Call `bumpClinicReadVersion(clinicId, "inbox")` after the durable write in each path that changes what the Inbox shows.

**Correction to an earlier draft of this plan.** The original search scope here was `src/application src/infrastructure`, which is wrong: every operator-initiated Inbox mutation lives in `src/app` and writes through `db` directly, bypassing the repositories. Search all three trees:

```bash
rg -n "update\(conversations\)|update\(leads\)|update\(organizations\)|insert\(messages\)|insert\(appointments\)|update\(appointments\)|delete\(conversations\)" src/app src/application src/infrastructure
```

Confirm each candidate has a production caller before counting it as covered. `ConversationRepository.setAiPaused` and `setTakeover` look like the pause and takeover write paths but have **zero production callers** — the real ones are direct `db.update` calls in `src/app/(clinic)/app/inbox/[conversationId]/actions.ts`.

**The tolerance for a missed bump is narrower than an earlier draft of this plan claimed.** That draft said a missed bump "degrades to the 60-second ladder". That is true only for a missed *instance*. The version this replaces was **derived** from the data, so any write self-healed it; the new one is bump-driven only. A missed *category* of write therefore means the poll returns an identical version forever and the Inbox never refreshes for that class of change at all. Categories that must bump, each verified against a real caller: pause and resume AI, clear attention, change category or archive, bulk delete, mark as read, and the clinic-wide auto-reply toggle. The last three were explicit components of the aggregation this task deletes — `max(conversations.lastReadAt)`, `organizations.autoReplyEnabled` and `organizations.updatedAt`.

Never let a bump failure fail the write:

```ts
  void bumpClinicReadVersion(clinicId, "inbox").catch(() => {
    // Invalidação é best-effort; a escada de polling cobre uma falha.
  });
```

- [ ] **Step 6: Rewrite the poller**

In `src/app/(clinic)/app/inbox/InboxPoller.tsx`: delete `FORCED_REFRESH_INTERVAL_MS`, `refreshAtRef` and the forced-refresh branch entirely. Replace the fixed `setInterval` with a self-scheduling `setTimeout` driven by `nextPollDelayMs`, resetting the counter to 0 whenever the version changes and skipping the fetch while `document.hidden` is true.

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npm test -- src/__tests__/InboxPollBackoff.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Verify and commit**

Run: `npm run verify`
Expected: exit 0.

```bash
git add "src/app/(clinic)/app/inbox" src/__tests__/InboxPollBackoff.test.ts src/application
git commit -m "feat(inbox): replace aggregate poll with materialized version"
```

---

### Task 7: Reverse-paginated conversation history

**Files:**
- Create: `src/application/inbox/list-messages.ts`
- Modify: `src/app/(clinic)/app/inbox/[conversationId]/page.tsx`
- Test: `src/__tests__/ConversationHistoryWindow.test.ts` — note this name is taken by an existing core test; use `src/__tests__/ConversationHistoryPagination.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CONVERSATION_PAGE_SIZE = 60`, `listConversationMessages({conversationId, clinicId, before}): Promise<{messages: MessageRow[]; hasMore: boolean}>`.

The `clinicId` parameter is mandatory and must be applied in the `where` clause even though `conversationId` looks sufficient — an unscoped conversation read is a tenant-isolation hole.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { CONVERSATION_PAGE_SIZE } from "@/application/inbox/list-messages";

describe("conversation history pagination", () => {
  it("uses the 60-message initial window from the spec", () => {
    expect(CONVERSATION_PAGE_SIZE).toBe(60);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/ConversationHistoryPagination.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the query**

Create `src/application/inbox/list-messages.ts` selecting from `messages` joined to `conversations`, filtered by `eq(conversations.clinicId, clinicId)` and `eq(messages.conversationId, conversationId)`, ordered `desc(messages.sentAt), desc(messages.id)`, limited to `CONVERSATION_PAGE_SIZE + 1`, with an optional `before` keyset. Return the slice reversed to chronological order plus `hasMore`.

- [ ] **Step 4: Consume it in the conversation page**

In `src/app/(clinic)/app/inbox/[conversationId]/page.tsx`, replace the unbounded message select with `listConversationMessages`, and mount `<ContentReadyReporter surface="conversation" />`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- src/__tests__/ConversationHistoryPagination.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: exit 0.

```bash
git add src/application/inbox/list-messages.ts "src/app/(clinic)/app/inbox/[conversationId]/page.tsx" src/__tests__/ConversationHistoryPagination.test.ts
git commit -m "feat(inbox): paginate conversation history"
```

---

### Task 8: Verification, measurement and handoff

**Files:**
- Create: `.superpowers/sdd/2026-08-09-phase-3a-incremental-read-paths/task-8-report.md` (commit with `git add -f`; `.superpowers/` is gitignored and only handoff reports are tracked)
- Modify: `docs/operations/performance-baseline.md` — the "Approved comparison targets" table

- [ ] **Step 1: Run the full suite at the branch tip**

Run: `npm run verify`
Record the exact file/test/skip counts and the exit code. Do not paraphrase them.

- [ ] **Step 2: Confirm the tenant and schema gates**

```bash
git diff --name-only origin/develop...HEAD -- src/infrastructure/db/schema.ts drizzle migrations
git diff --check origin/develop...HEAD
```

Two migrations are expected here (Tasks 2 and 5). State both in the report and in the PR body, with the index-lock note from Task 2.

- [ ] **Step 3: Update the measurable targets**

In `docs/operations/performance-baseline.md`, move "Previously visited screen", "Open conversation" and "First application open" from `not_measurable` to measurable via `content_ready` / `app_first_open`. Leave "New message visible" as `not_measurable` — it still requires the Phase 3B realtime milestone.

- [ ] **Step 4: Write the handoff report**

Include: the commit ranges per cost centre for independent rollback; the exact command evidence; that no conversational behaviour changed; and the explicit statement that unit/integration green is not Lab green and no approved private replay was run.

State plainly what was **not** proven: the baseline protocol requires 16 cohorts collected in preview/Lab, and this plan does not collect them. Improvement is therefore expected-by-construction (bounded page, one indexed row read instead of four aggregations, no unconditional refresh) but **not measured**. Do not describe any target as met.

- [ ] **Step 5: Commit and open the PR**

```bash
git add -f .superpowers/sdd/2026-08-09-phase-3a-incremental-read-paths/task-8-report.md
git add docs/operations/performance-baseline.md
git commit -m "docs(inbox): hand off incremental read paths"
```

Then use `superpowers:finishing-a-development-branch`, targeting `develop`.

---

## Self-Review

**Spec coverage.** §12.1 lists seven structural causes. Unpaginated inbox → Tasks 3-4. Enrichment fed the full set → Task 4. `/api/inbox/check` running four aggregations every 5 s → Tasks 5-6. Forced full refresh each minute → Task 6. Chat version poll every 3 s → **not covered**; it lives in the conversation route and is deliberately left to Phase 3B alongside the delta API, because fixing it without realtime only shifts the poll. `router.refresh()` in mutations → **not covered**, deferred to Phase 3B with optimistic mutations. `force-dynamic` on main pages → **not covered**; removing it requires the realtime invalidation channel to exist first. Missing composite index → Task 2. §12.2 decisions on page size, history window and no-full-refresh → Tasks 3, 6, 7. Virtualisation, prefetch, optimistic mutations, read models for Agora, lazy media → Phase 3B. §12.4 targets → Tasks 1 and 8.

**Placeholder scan.** Task 7 Steps 3-4 and Task 6 Steps 5-6 describe the change without a full code block. That is deliberate: they edit files whose current contents the implementer must read first, and pasting a stale full-file body would be worse than describing the edit precisely. Every other step carries runnable code. No "TBD", no "handle edge cases".

**Type consistency.** `INBOX_PAGE_SIZE`, `encodeInboxCursor`, `decodeInboxCursor`, `listClinicConversations`, `bumpClinicReadVersion`, `readClinicVersion`, `nextPollDelayMs`, `CONVERSATION_PAGE_SIZE` are each defined once and referenced under the same name thereafter. `ClinicReadResource` is `"inbox"` only; Phase 3B widens it. The test file name collision with the existing `ConversationHistoryWindow.test.ts` is called out in Task 7.

**Known risk carried into execution.** Task 6 Step 5 touches many write paths, and a missed call site means a stale Inbox for up to 60 s rather than a wrong one. The reviewer should check call-site coverage explicitly rather than trusting the grep.
