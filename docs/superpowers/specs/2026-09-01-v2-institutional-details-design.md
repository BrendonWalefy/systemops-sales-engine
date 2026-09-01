# V2 Institutional Details and Social Reception Design

**Status:** approved implementation slice of
`docs/architecture/v2-business-capability-architecture.md`.

## Outcome

Complete the remaining low-risk institutional questions in V2 and make social turns end naturally.
The slice answers parking and registered social channels from tenant-scoped structured data, and
distinguishes opening, acknowledgement and farewell without adding a model call or a new runtime.

## Ownership

- `organizations.parking_information` owns the clinic-authored parking guidance.
- `organizations.social_channels` owns a bounded list of `{ label, url }` entries.
- The existing Knowledge settings tab edits these fields through a session-scoped server action.
- `DentalKnowledgeReadPort` remains the only capability read boundary. It is closed over the
  already-claimed `Organization`; no method accepts a tenant identifier.
- `dental-reception` owns social acknowledgements and farewells. It does not read clinic facts or
  perform effects.

Parking guidance is free text because the system only displays it; it does not calculate from it.
Social channels are structured because URLs need validation, deterministic ordering and explicit
authorization. No playbook notes or other prose is mined as a fallback.

## Contracts

`Organization` gains:

```ts
type SocialChannel = Readonly<{ label: string; url: string }>;
parkingInformation: string | null;
socialChannels: SocialChannel[] | null;
```

The database stores `parking_information` as nullable text and `social_channels` as nullable JSONB.
Application validation accepts at most five channels, unique normalized labels, labels of 1-40
characters and HTTPS URLs of at most 240 characters. Empty submitted values normalize to `null`.

The institutional fact union gains `parking_information` and `social_channels`. A registered value
must fit the existing safe display surface (trimmed, no control characters, at most 240 characters).
Invalid source data fails closed as missing; it is never partly exposed. Social channels are sorted
by normalized label and rendered once as `Label: URL`, separated by ` · `.

Reception uses the existing `dialogueMove`:

- `new_topic` with `greeting`/`other`: invite the lead to say what they need;
- `acknowledges`: acknowledge without introducing an unrelated question;
- `closes`: close politely without a question;
- `repeats`: preserve the existing human handoff.

The outcome remains `reception_answered`; the response plan differentiates the social act through a
closed fact key, not through arbitrary text in the orchestrator.

## Safety and isolation

- V2-only: no V1 import, engine selector or fallback.
- The settings action requires `requireSessionClinicId()` and updates exactly that organization.
- The runtime adapter uses only `deps.clinic`; no database lookup or tenant ID supplied by the model.
- Missing or malformed data returns the existing topic-specific unavailable result.
- No scheduling, pipeline, notification, job, outbox or sender behavior changes.
- No new query, lock, model call, worker, polling or background activity is introduced per turn.
- The migration is generated from `schema.ts`; generated SQL is reviewed but never hand-edited.

## Rollout and rollback

This is an expand-only nullable schema change. Existing tenants keep `null` and therefore preserve
the honest unavailable response. The deploy never populates or activates another tenant. Rollback
is a code rollback that leaves inert nullable columns in place; physical contraction is deferred.

SystemOpsLab configuration is not mutated by the release. Its values can be entered later through
the same canonical UI or reviewed tenant-scoped configuration command.

## Acceptance evidence

- RED/GREEN unit tests for schema validation, server-action tenant scope, knowledge reads and social
  reception semantics.
- Generated migration and schema contract checks.
- Live-handler tests prove one Understanding call, at most one verbalization, no business effect and
  one authorized answer.
- Performance contract proves no new query/lock/job/outbox cardinality relative to current
  institutional knowledge turns.
- Exact `npm run verify`, production build, CI and preview are green before normal promotion.

## Explicitly deferred to the next slice

Treatment comparison, structured FAQ answers and clinic differentials are separate because they
change the Understanding/catalog contract rather than organization profile data. They will reuse
the same `Decision -> ActionResult -> AuthorizedResponsePlan` path immediately after this release.
